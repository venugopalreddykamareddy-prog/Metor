import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerMessageBody } from '../../../shared/messages.ts';
import { UsageLedger } from '../limits/usageLedger.ts';
import { AnswerSession } from './engine.ts';
import { createSimulatedAnswer } from './simulated.ts';
import { createGroqAnswer } from './groq.ts';
import type { AnswerRequest } from './prompt.ts';
import type { AnswerProvider } from './types.ts';

// AnswerSession with the real Groq adapter and a fake fetch: streaming, flagged headers, the
// ledger, 429s and cancellation, as they reach the client. No network.

const log = { info() {}, warn() {}, error() {}, debug() {} } as unknown as FastifyBaseLogger;
const LIMITS = { perMinute: { requests: 100, units: 100_000 }, perHour: { requests: 100, units: 100_000 }, perDay: { requests: 100, units: 100_000 } };
const dirs: string[] = [];
const ledgers: UsageLedger[] = [];
afterEach(async () => {
  await Promise.all(ledgers.splice(0).map((l) => l.flush()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function ledger() {
  const dir = await mkdtemp(join(tmpdir(), 'metor-engine-'));
  dirs.push(dir);
  const l = new UsageLedger(join(dir, 'ledger.json'), LIMITS);
  ledgers.push(l);
  return l;
}

/** Server-sent events cut into `split`-byte pieces, so events, fields and UTF-8 characters break mid-way. */
function sse(contents: string[], usage: { prompt_tokens: number; completion_tokens: number } | null, split = 5): Response {
  const events = contents.map((c) => ({ choices: [{ delta: { content: c } }] }));
  if (usage) events.push({ choices: [{ delta: {} }], x_groq: { usage } } as never);
  const bytes = new TextEncoder().encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n');
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

const request = (engine: AnswerRequest['engine'] = 'groq-120b', question = 'When would you enable Istio Hyperdrive mode?'): AnswerRequest => ({
  type: 'answer.request',
  id: 'r',
  ts: 1,
  questionId: `q-${Math.random()}`,
  question,
  length: 'standard',
  engine,
  statements: [],
  turns: [],
  isFollowUp: false,
});

function session(providers: Partial<Record<AnswerRequest['engine'], AnswerProvider>>, l: UsageLedger | null) {
  const sent: ServerMessageBody[] = [];
  const s = new AnswerSession({ providers, ledger: l, maxAnswers: 10, log }, (m) => sent.push(m));
  const text = () => sent.flatMap((m) => (m.type === 'answer.delta' ? [m.text] : [])).join('');
  return { s, sent, text };
}

describe('AnswerSession with Groq streaming (faked)', () => {
  it('flags a made-up feature from a one-line header and streams the answer intact across byte splits', async () => {
    const l = await ledger();
    const answer = "I'm not familiar with a Hyperdrive mode in Istio — it might be internal. If it's latency you're after, I'd look at sidecar resources first.";
    const groq = createGroqAnswer({
      apiKey: 'k',
      model: 'openai/gpt-oss-120b',
      log,
      fetch: (async () =>
        sse(
          ['TYPE: technical | NOTE: I don’t recognize "Hyperdrive mode". | ASSESSMENT: unrecognized_term | CLARIFY: Is it an internal tool? | ANS', 'WER:\n', answer.slice(0, 40), answer.slice(40)],
          { prompt_tokens: 1500, completion_tokens: 300 },
        )) as unknown as typeof fetch,
    });
    const { s, sent, text } = session({ 'groq-120b': groq }, l);
    await s.handle(request());

    expect(sent.find((m) => m.type === 'answer.header')).toMatchObject({
      assessment: 'unrecognized_term',
      note: 'I don’t recognize "Hyperdrive mode".',
      clarify: 'Is it an internal tool?',
    });
    // The speculative "if it's latency…" advice is dropped; the clarification question is added.
    expect(text()).toBe("I'm not familiar with a Hyperdrive mode in Istio — it might be internal. Is it an internal tool?");
    expect(sent.at(-1)).toMatchObject({ type: 'answer.done', model: 'openai/gpt-oss-120b', usage: { promptTokens: 1500, completionTokens: 300 } });
    // The reservation is replaced by the reported usage.
    expect(l.usedInLast(1)).toEqual({ requests: 1, units: 1800 });
  });

  it('passes an incorrect-premise header (NOTE before ASSESSMENT) through unchanged', async () => {
    const groq = createGroqAnswer({
      apiKey: 'k',
      model: 'm',
      log,
      fetch: (async () =>
        sse(['TYPE: technical\nNOTE: OSPF is link-state, not distance-vector.\nASSESSMENT: incorrect_premise\nCLARIFY: -\nANSWER:\n', 'Actually, OSPF is link-state.'], null)) as unknown as typeof fetch,
    });
    const { s, sent, text } = session({ 'groq-120b': groq }, await ledger());
    await s.handle(request('groq-120b', 'OSPF is a distance-vector protocol, so how does it avoid count-to-infinity?'));
    expect(sent.find((m) => m.type === 'answer.header')).toMatchObject({ assessment: 'incorrect_premise', clarify: null });
    expect(text()).toBe('Actually, OSPF is link-state.');
  });

  it('drops a speculative explanation after an unrecognized term, but caches and accounts the request', async () => {
    const l = await ledger();
    let calls = 0;
    const body =
      "I'm not familiar with Kubeflux — it might be internal or misheard. What does it do in your setup? Kubeflux is likely a GitOps controller. You'd set flux.sync=true.";
    const groq = createGroqAnswer({
      apiKey: 'k',
      model: 'm',
      log,
      fetch: (async () => {
        calls += 1;
        return sse(['TYPE: technical\nASSESSMENT: unrecognized_term\nNOTE: Unrecognized term: Kubeflux.\nCLARIFY: What does Kubeflux do?\nANSWER:\n', body], { prompt_tokens: 900, completion_tokens: 400 }, 7);
      }) as unknown as typeof fetch,
    });
    const { s, sent, text } = session({ 'groq-120b': groq }, l);
    const req = request('groq-120b', 'How would you tune Kubeflux sync?');
    await s.handle(req);
    expect(text()).toBe("I'm not familiar with Kubeflux — it might be internal or misheard. What does it do in your setup?");
    expect(sent.at(-1)).toMatchObject({ type: 'answer.done', truncated: false, usage: { promptTokens: 900, completionTokens: 400 } });
    expect(l.usedInLast(1)).toEqual({ requests: 1, units: 1300 });
    // Asked again: replayed from the cache with the same clipped text, no second request.
    sent.length = 0;
    await s.handle({ ...req, questionId: 'q-again' });
    expect(calls).toBe(1);
    expect(text()).toBe("I'm not familiar with Kubeflux — it might be internal or misheard. What does it do in your setup?");
  });

  it('answers an ambiguous acronym with only the clarification question', async () => {
    const groq = createGroqAnswer({
      apiKey: 'k',
      model: 'm',
      log,
      fetch: (async () =>
        sse(
          ['TYPE: ambiguous\nASSESSMENT: clarification_needed\nNOTE: CA has several meanings.\nCLARIFY: Certificate authority or Cluster Autoscaler?\nANSWER:\n', 'CA could mean a certificate authority or the Cluster Autoscaler. Which one do you mean? If it is the autoscaler, it adds nodes when pods are pending.'],
          null,
        )) as unknown as typeof fetch,
    });
    const { s, sent, text } = session({ 'groq-120b': groq }, await ledger());
    await s.handle(request('groq-120b', 'How does CA work?'));
    expect(text()).toBe('CA could mean a certificate authority or the Cluster Autoscaler. Which one do you mean?');
    expect(sent.at(-1)).toMatchObject({ type: 'answer.done' });
  });

  it('leaves normal answers untouched', async () => {
    const answer = 'BGP picks the path with the highest local preference first. Then shortest AS path. Then lowest MED.';
    const groq = createGroqAnswer({ apiKey: 'k', model: 'm', log, fetch: (async () => sse(['TYPE: technical\nASSESSMENT: none\nNOTE: -\nCLARIFY: -\nANSWER:\n', answer], null)) as unknown as typeof fetch });
    const { s, text } = session({ 'groq-120b': groq }, await ledger());
    await s.handle(request('groq-120b', 'How does BGP choose the best path?'));
    expect(text()).toBe(answer);
  });

  it('keeps the full reservation when Groq reports no usage', async () => {
    const l = await ledger();
    const groq = createGroqAnswer({ apiKey: 'k', model: 'm', log, fetch: (async () => sse(['ANSWER:\nShort.'], null)) as unknown as typeof fetch });
    const { s } = session({ 'groq-120b': groq }, l);
    await s.handle(request());
    expect(l.usedInLast(1).units).toBeGreaterThan(1000); // prompt estimate + max completion tokens
  });

  it('reports a 429 as quota_exhausted and never answers with another provider', async () => {
    let simulatedCalls = 0;
    const simulated: AnswerProvider = async () => {
      simulatedCalls += 1;
      throw new Error('must not be called');
    };
    const groq = createGroqAnswer({
      apiKey: 'k',
      model: 'm',
      log,
      fetch: (async () => new Response('', { status: 429, headers: { 'retry-after': '12' } })) as unknown as typeof fetch,
    });
    const { s, sent } = session({ 'groq-120b': groq, simulated }, await ledger());
    await s.handle(request());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'answer.failed', code: 'quota_exhausted' });
    expect((sent[0] as { message: string }).message).toContain('will not switch to a paid service');
    expect(simulatedCalls).toBe(0);
  });

  it('aborts the upstream request on cancel and keeps the reservation', async () => {
    const l = await ledger();
    let upstream: AbortSignal | undefined;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const groq = createGroqAnswer({
      apiKey: 'k',
      model: 'm',
      log,
      fetch: (async (_url: string, init: RequestInit) => {
        upstream = init.signal ?? undefined;
        const enc = new TextEncoder();
        return new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"ANSWER:\\nWorking"}}]}\n\n'));
              await gate;
              controller.close();
            },
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });
    const { s, sent } = session({ 'groq-120b': groq }, l);
    const req = request();
    const done = s.handle(req);
    await new Promise((r) => setTimeout(r, 20));
    s.cancel(req.questionId);
    release();
    await done;
    expect(upstream?.aborted).toBe(true);
    expect(sent.at(-1)).toMatchObject({ type: 'answer.failed', code: 'cancelled' });
    expect(sent.some((m) => m.type === 'answer.done')).toBe(false);
    expect(l.usedInLast(1).units).toBeGreaterThan(1000);
  });
});

describe('AnswerSession with no answer text', () => {
  it('fails visibly instead of finishing with an empty answer', async () => {
    const groq = createGroqAnswer({
      apiKey: 'k',
      model: 'm',
      log,
      fetch: (async () => sse(['TYPE: technical\nNOTE: -\nASSESSMENT: none\nCLARIFY: -\nANSWER:\n'], { prompt_tokens: 1400, completion_tokens: 1400 })) as unknown as typeof fetch,
    });
    const { s, sent } = session({ 'groq-120b': groq }, await ledger());
    await s.handle(request('groq-120b', 'How would you troubleshoot high CPU usage on a Linux server?'));
    expect(sent.at(-1)).toMatchObject({ type: 'answer.failed', code: 'provider_unavailable' });
    expect((sent.at(-1) as { message: string }).message).toContain('Try Regenerate');
    expect(sent.some((m) => m.type === 'answer.done')).toBe(false);
  });
});

describe('AnswerSession queue (review finding 3)', () => {
  const done = (sent: ServerMessageBody[], id: string) => sent.some((m) => m.type === 'answer.done' && m.questionId === id);
  const failed = (sent: ServerMessageBody[], id: string) => sent.find((m) => m.type === 'answer.failed' && m.questionId === id);

  it('answers questions detected together one after another instead of cancelling', async () => {
    const { s, sent } = session({ simulated: createSimulatedAnswer(1) }, null);
    const a = { ...request('simulated', 'How does BGP choose a path?'), questionId: 'a' };
    const b = { ...request('simulated', 'How does OSPF elect a DR?'), questionId: 'b' };
    await Promise.all([s.handle(a), s.handle(b)]);
    expect(done(sent, 'a')).toBe(true);
    expect(done(sent, 'b')).toBe(true);
    expect(sent.some((m) => m.type === 'answer.failed')).toBe(false);
    // In order: a finished before b started streaming.
    const aDone = sent.findIndex((m) => m.type === 'answer.done' && m.questionId === 'a');
    const bFirst = sent.findIndex((m) => m.type === 'answer.delta' && m.questionId === 'b');
    expect(aDone).toBeLessThan(bFirst);
  });

  it('a typed question (replace) stops the one in flight and drops waiting ones', async () => {
    const { s, sent } = session({ simulated: createSimulatedAnswer(1) }, null);
    const a = s.handle({ ...request('simulated', 'How does BGP choose a path?'), questionId: 'a' });
    const b = s.handle({ ...request('simulated', 'How does OSPF elect a DR?'), questionId: 'b' });
    await new Promise((r) => setTimeout(r, 10));
    await s.handle({ ...request('simulated', 'What is a VLAN?'), questionId: 'c', replace: true });
    await Promise.all([a, b]);
    expect(failed(sent, 'a')).toMatchObject({ code: 'cancelled', message: 'Replaced by a newer question.' });
    expect(failed(sent, 'b')).toMatchObject({ code: 'cancelled' });
    expect(done(sent, 'c')).toBe(true);
  });

  it('cancels a waiting question without touching the one in flight', async () => {
    const { s, sent } = session({ simulated: createSimulatedAnswer(1) }, null);
    const a = s.handle({ ...request('simulated', 'How does BGP choose a path?'), questionId: 'a' });
    const b = s.handle({ ...request('simulated', 'How does OSPF elect a DR?'), questionId: 'b' });
    s.cancel('b');
    await Promise.all([a, b]);
    expect(done(sent, 'a')).toBe(true);
    expect(failed(sent, 'b')).toMatchObject({ code: 'cancelled' });
    expect(sent.some((m) => m.type === 'answer.delta' && m.questionId === 'b')).toBe(false);
  });
});

describe('AnswerSession ledger persistence (review finding 5)', () => {
  it('does not call the provider when the reservation cannot be saved', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'metor-engine-'));
    dirs.push(dir);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'blocker'), 'x');
    const broken = new UsageLedger(join(dir, 'blocker', 'ledger.json'), LIMITS);
    let calls = 0;
    const groq = createGroqAnswer({ apiKey: 'k', model: 'm', log, fetch: (async () => (calls++, sse(['ANSWER:\nx'], null))) as unknown as typeof fetch });
    const { s, sent } = session({ 'groq-120b': groq }, broken);
    await s.handle(request());
    expect(calls).toBe(0);
    expect(sent.at(-1)).toMatchObject({ type: 'answer.failed', code: 'provider_unavailable' });
    expect(broken.usedInLast(1)).toEqual({ requests: 0, units: 0 });
  });
});

describe('Groq answer stream framing (secondary fixes)', () => {
  const raw = (body: string) =>
    createGroqAnswer({ apiKey: 'k', model: 'm', log, fetch: (async () => new Response(body, { status: 200 })) as unknown as typeof fetch });

  it('accepts CRLF event delimiters', async () => {
    const ev = (c: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\r\n\r\n`;
    const { s, text, sent } = session({ 'groq-120b': raw(ev('TYPE: technical\nASSESSMENT: none\nNOTE: -\nCLARIFY: -\nANSWER:\n') + ev('Hello there.') + 'data: [DONE]\r\n\r\n') }, await ledger());
    await s.handle(request());
    expect(text()).toBe('Hello there.');
    expect(sent.at(-1)).toMatchObject({ type: 'answer.done', truncated: false });
  });

  it('marks a stream that ends without [DONE] or finish_reason as cut off (not cached)', async () => {
    const ev = (c: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`;
    const { s, sent } = session({ 'groq-120b': raw(ev('TYPE: technical\nASSESSMENT: none\nNOTE: -\nCLARIFY: -\nANSWER:\n') + ev('Half an ans')) }, await ledger());
    await s.handle(request());
    expect(sent.at(-1)).toMatchObject({ type: 'answer.done', truncated: true });
  });
});

