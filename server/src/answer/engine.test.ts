import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerMessageBody } from '../../../shared/messages.ts';
import { UsageLedger } from '../limits/usageLedger.ts';
import { AnswerSession } from './engine.ts';
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
    expect(text()).toBe(answer);
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
