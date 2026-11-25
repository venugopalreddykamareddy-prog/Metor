import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { FRAME_MS, FRAME_SAMPLES } from '../../../shared/audio.ts';
import { UsageLedger, type QuotaLimits } from '../limits/usageLedger.ts';
import { GROQ_TRANSCRIPTIONS_URL, MAX_SEGMENT_MS, createGroqStt } from './groq.ts';

const ROOMY: QuotaLimits = {
  perMinute: { requests: 100, units: 10_000 },
  perHour: { requests: 100, units: 10_000 },
  perDay: { requests: 100, units: 10_000 },
};
const silentLog = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger;

const tone = Int16Array.from({ length: FRAME_SAMPLES }, (_, i) => Math.round(8000 * Math.sin(i / 5)));
const silence = new Int16Array(FRAME_SAMPLES);

interface Call {
  url: string;
  form: FormData;
  signal?: AbortSignal | null;
}

let dir: string;
let ledgers: UsageLedger[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'metor-groq-'));
});
afterEach(async () => {
  await Promise.all(ledgers.map((l) => l.flush()));
  ledgers = [];
  await rm(dir, { recursive: true, force: true });
});

function setup(opts: { respond?: (call: Call) => Response | Promise<Response>; limits?: QuotaLimits; ledgerPath?: string } = {}) {
  const calls: Call[] = [];
  const events: { type: string; text?: string; latencyMs?: number; code?: string }[] = [];
  const respond =
    opts.respond ??
    (() => Response.json({ text: 'x', segments: [{ text: ' run cube cuddle get pods', no_speech_prob: 0.01 }] }));
  const fakeFetch = (async (url: string, init: RequestInit) => {
    const call = { url, form: init.body as FormData, signal: init.signal };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  const ledger = new UsageLedger(opts.ledgerPath ?? join(dir, 'ledger.json'), opts.limits ?? ROOMY);
  ledgers.push(ledger);
  const stt = createGroqStt({ apiKey: 'test-key', model: 'whisper-large-v3-turbo', ledger, log: silentLog, fetch: fakeFetch })({
    partial: (text) => events.push({ type: 'partial', text }),
    final: (text, _s, _e, latencyMs) => events.push({ type: 'final', text, latencyMs }),
    error: (code) => events.push({ type: 'error', code }),
  });
  let atMs = 0;
  const feed = (frame: Int16Array, ms: number) => {
    for (let i = 0; i < ms / FRAME_MS; i++, atMs += FRAME_MS) stt.push(frame, atMs);
  };
  const finals = () => events.filter((e) => e.type === 'final').map((e) => e.text);
  // Waits for queued uploads (each now waits for its ledger write), bounded for streams that never finish.
  const settle = async () => {
    await Promise.race([stt.flush?.(), new Promise((r) => setTimeout(r, 500))]);
    await new Promise((r) => setTimeout(r, 5));
  };
  return { stt, calls, events, feed, finals, settle, ledger };
}

describe('Groq STT', () => {
  it('uploads a WAV with model, language, prompt and verbose_json, and returns raw text', async () => {
    const t = setup();
    t.feed(tone, 2000);
    t.feed(silence, 1500); // a short answer closes after a 1.5 s pause
    await t.settle();
    expect(t.calls).toHaveLength(1);
    const { url, form } = t.calls[0]!;
    expect(url).toBe(GROQ_TRANSCRIPTIONS_URL);
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('language')).toBe('en');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(String(form.get('prompt'))).toContain('kubectl');
    const file = form.get('file') as File;
    expect(file.type).toBe('audio/wav');
    // 300 ms pre-roll is only kept when it exists; here speech starts at once: 3.5 s of audio.
    expect(file.size).toBe(44 + 35 * FRAME_SAMPLES * 2);
    expect(t.events[0]).toEqual({ type: 'partial', text: '…' });
    expect(t.finals()).toEqual(['run cube cuddle get pods']); // raw; cleaned on the client
    expect(t.events.find((e) => e.type === 'final')?.latencyMs).toBeTypeOf('number');
  });

  it('allows two short segments a minute; after that waits for 8 s before closing at a pause', async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) {
      t.feed(tone, 1000);
      t.feed(silence, 1500);
    }
    await t.settle();
    expect(t.calls).toHaveLength(2);
    t.feed(tone, 3000); // third segment is now 1 + 1.5 + 3 = 5.5 s long
    t.feed(silence, 1000);
    await t.settle();
    expect(t.calls).toHaveLength(2);
    t.feed(tone, 2000);
    t.feed(silence, 700); // over 8 s and a 0.7 s pause
    await t.settle();
    expect(t.calls).toHaveLength(3);
  });

  it('closes long speech at the 30 s cap', async () => {
    const t = setup();
    t.feed(tone, MAX_SEGMENT_MS);
    await t.settle();
    expect(t.calls).toHaveLength(1);
  });

  it('never uploads silence or a blip shorter than 300 ms', async () => {
    const t = setup();
    t.feed(silence, 5000);
    t.feed(tone, 200);
    t.feed(silence, 2000);
    await t.settle();
    expect(t.calls).toHaveLength(0);
    expect(t.events.at(-1)).toEqual({ type: 'partial', text: '' }); // clears the "…" placeholder
  });

  it('drops segments Whisper marks as non-speech and short "thank you" hallucinations', async () => {
    const t = setup({
      respond: () =>
        Response.json({
          segments: [
            { text: ' Thank you.', no_speech_prob: 0.1 },
            { text: ' background noise words', no_speech_prob: 0.9 },
          ],
        }),
    });
    t.feed(tone, 1000);
    t.feed(silence, 1500);
    await t.settle();
    expect(t.finals()).toEqual([]);
  });

  it('pauses uploads after a 429 until retry-after passes, without switching providers', async () => {
    const t = setup({ respond: () => new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }) });
    t.feed(tone, 1000);
    t.feed(silence, 1500);
    await t.settle();
    t.feed(tone, 1000);
    t.feed(silence, 1500);
    await t.settle();
    expect(t.calls).toHaveLength(1);
    expect(t.events.filter((e) => e.type === 'error')).toEqual([{ type: 'error', code: 'quota_exhausted' }]);
  });

  it('reports network failures and HTTP errors as provider_unavailable', async () => {
    let n = 0;
    const t = setup({
      respond: () => {
        n += 1;
        if (n === 1) throw new TypeError('fetch failed');
        return new Response('boom', { status: 500 });
      },
    });
    for (let i = 0; i < 2; i++) {
      t.feed(tone, 1000);
      t.feed(silence, 1500);
      await t.settle();
    }
    expect(t.events.filter((e) => e.type === 'error').map((e) => e.code)).toEqual([
      'provider_unavailable',
      'provider_unavailable',
    ]);
  });

  it('refuses to call Groq when the local free-tier budget is used up', async () => {
    const t = setup({ limits: { ...ROOMY, perHour: { requests: 100, units: 15 } } });
    for (let i = 0; i < 2; i++) {
      t.feed(tone, 1000);
      t.feed(silence, 1500);
      await t.settle();
    }
    expect(t.calls).toHaveLength(1); // each request counts as at least 10 s
    expect(t.events.filter((e) => e.type === 'error').map((e) => e.code)).toEqual(['quota_exhausted']);
  });

  it('finalizeNow uploads what was said so far; discardPartial drops it', async () => {
    const t = setup();
    t.feed(tone, 1000);
    t.stt.discardPartial();
    t.stt.finalizeNow();
    await t.settle();
    expect(t.calls).toHaveLength(0);
    t.feed(tone, 1000);
    t.stt.finalizeNow();
    await t.settle();
    expect(t.calls).toHaveLength(1);
  });

  it('keeps finals in order when an earlier request is slower', async () => {
    let n = 0;
    const t = setup({
      respond: async () => {
        n += 1;
        const text = n === 1 ? 'first' : 'second';
        if (n === 1) await new Promise((r) => setTimeout(r, 50));
        return Response.json({ segments: [{ text, no_speech_prob: 0 }] });
      },
    });
    t.feed(tone, 1000);
    t.feed(silence, 1500);
    t.feed(tone, 1000);
    t.feed(silence, 1500);
    await new Promise((r) => setTimeout(r, 120));
    expect(t.finals()).toEqual(['first', 'second']);
  });
});

describe('Groq STT robustness (review fixes)', () => {
  it('keeps transcribing after a malformed response', async () => {
    let n = 0;
    const t = setup({
      respond: () => (++n === 1 ? new Response('<html>bad gateway</html>', { status: 200 }) : Response.json({ text: 'second segment' })),
    });
    t.feed(tone, 2000);
    t.stt.finalizeNow();
    await t.settle();
    expect(t.events.some((e) => e.type === 'error' && e.code === 'provider_unavailable')).toBe(true);
    t.feed(tone, 2000);
    t.stt.finalizeNow();
    await t.settle();
    expect(t.finals()).toEqual(['second segment']);
  });

  it('treats a JSON body of the wrong shape as malformed', async () => {
    const t = setup({ respond: () => Response.json({ segments: 'nope' }) });
    t.feed(tone, 2000);
    t.stt.finalizeNow();
    await t.settle();
    expect(t.finals()).toEqual([]);
    expect(t.events.at(-1)).toMatchObject({ type: 'error', code: 'provider_unavailable' });
  });

  it('flush() resolves once queued segments are transcribed', async () => {
    const t = setup();
    t.feed(tone, 2000);
    t.stt.finalizeNow();
    await t.stt.flush?.();
    expect(t.finals()).toHaveLength(1);
  });

  it('dispose() aborts the request in flight and skips queued segments: no Groq call after logout', async () => {
    const t = setup({ respond: () => new Promise<Response>(() => undefined) }); // never answers on its own
    t.feed(tone, 2000);
    t.stt.finalizeNow(); // segment 1: in flight
    t.feed(tone, 2000);
    t.stt.finalizeNow(); // segment 2: queued
    await t.settle();
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]?.signal?.aborted).toBe(false);
    t.stt.dispose?.();
    await t.settle();
    expect(t.calls[0]?.signal?.aborted).toBe(true);
    expect(t.calls).toHaveLength(1); // the queued segment never reached Groq
    expect(t.finals()).toEqual([]);
  });

  it('fails closed when the quota ledger cannot be written: no Groq call', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'blocker'), 'x'); // a path under a regular file can't be created
    const t = setup({ ledgerPath: join(dir, 'blocker', 'ledger.json') });
    t.feed(tone, 2000);
    t.stt.finalizeNow();
    await t.settle();
    expect(t.calls).toHaveLength(0);
    expect(t.events.at(-1)).toMatchObject({ type: 'error', code: 'provider_unavailable' });
    expect(t.ledger.usedInLast(1)).toEqual({ requests: 0, units: 0 }); // reservation rolled back
  });
});
