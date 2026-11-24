import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CLOSE_AUTH_ENDED, FRAME_SAMPLES, MAX_PAYLOAD_BYTES, encodeAudioFrame } from '../../shared/messages.ts';
import { buildApp } from './app.ts';
import { hashPassphrase } from './auth/passphrase.ts';
import { loadConfig, type ServerConfig } from './config.ts';

const ORIGIN = 'http://localhost:5173';
const PASSPHRASE = 'test passphrase 123';
const WORDS_IN_FIRST_LINE = 15;
const FRAMES_PER_WORD = 3;

type Msg = Record<string, unknown> & { type: string };

let passphraseHash: string;
const apps: FastifyInstance[] = [];

beforeAll(async () => {
  passphraseHash = await hashPassphrase(PASSPHRASE);
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp(
  overrides: Partial<ServerConfig> = {},
  logStream?: { write(line: string): void },
  groqFetch?: typeof fetch,
) {
  const config = { ...loadConfig({ APP_PASSPHRASE_HASH: passphraseHash }), ...overrides };
  const app = await buildApp(config, {
    ...(logStream ? { logStream } : { logger: false }),
    ...(groqFetch ? { groqFetch } : {}),
    simulatedAnswerDelayMs: 0,
  });
  await app.ready();
  apps.push(app);
  return app;
}

function login(app: FastifyInstance, passphrase = PASSPHRASE, origin = ORIGIN) {
  return app.inject({ method: 'POST', url: '/api/login', headers: { origin }, payload: { passphrase } });
}

async function loginCookie(app: FastifyInstance): Promise<string> {
  const res = await login(app);
  expect(res.statusCode).toBe(200);
  return String(res.headers['set-cookie']).split(';')[0] ?? '';
}

/** Socket plus every message it has received, with a helper to wait for one. */
async function connect(app: FastifyInstance, cookie: string) {
  const ws = await app.injectWS('/ws', { headers: { origin: ORIGIN, cookie } });
  const messages: Msg[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as Msg));
  const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
  const waitFor = async (match: (m: Msg) => boolean, timeoutMs = 3000): Promise<Msg> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = messages.find(match);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(`timed out; got ${messages.map((m) => (m.type === 'error' ? `error:${m.code}` : m.type)).join(', ')}`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const sendJson = (body: object) => ws.send(JSON.stringify({ id: crypto.randomUUID(), ts: Date.now(), ...body }));
  const sendFrames = (from: number, count: number) => {
    for (let seq = from; seq < from + count; seq++) {
      ws.send(Buffer.from(encodeAudioFrame(seq, new Int16Array(FRAME_SAMPLES))));
    }
  };
  return { ws, messages, closed, waitFor, sendJson, sendFrames };
}

async function startRecording(app: FastifyInstance, cookie: string) {
  const conn = await connect(app, cookie);
  conn.sendJson({ type: 'session.start', mode: 'simulated', source: 'mic' });
  const started = await conn.waitFor((m) => m.type === 'session.started');
  return { ...conn, sessionId: started.sessionId as string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('HTTP auth', () => {
  it('GET /healthz is open', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('logs in with the right passphrase and sets a locked-down cookie', async () => {
    const app = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    const res = await login(app);
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^metor_session=[\w-]{43};/);
    expect(cookie).toContain('HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200');
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookie.split(';')[0] } });
    expect(me.statusCode).toBe(200);
  });

  it('rejects a wrong passphrase, a bad origin, and a malformed body', async () => {
    const app = await makeApp();
    expect((await login(app, 'wrong passphrase')).statusCode).toBe(401);
    expect((await login(app, PASSPHRASE, 'https://evil.example')).statusCode).toBe(403);
    const res = await app.inject({ method: 'POST', url: '/api/login', headers: { origin: ORIGIN }, payload: { pass: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('blocks login after 5 failures, even with the right passphrase', async () => {
    const app = await makeApp();
    for (let i = 0; i < 5; i++) expect((await login(app, `wrong ${i}`)).statusCode).toBe(401);
    const res = await login(app);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('/api/me reports whether Groq is configured', async () => {
    const plain = await makeApp();
    const me = await plain.inject({ method: 'GET', url: '/api/me', headers: { cookie: await loginCookie(plain) } });
    expect(me.json()).toEqual({ authenticated: true, providers: { groq: false } });
  });

  it('logout ends the session', async () => {
    const app = await makeApp();
    const cookie = await loginCookie(app);
    const out = await app.inject({ method: 'POST', url: '/api/logout', headers: { origin: ORIGIN, cookie } });
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('WebSocket auth', () => {
  it('rejects upgrades without a session, with a bad origin, or after logout', async () => {
    const app = await makeApp();
    await expect(app.injectWS('/ws', { headers: { origin: ORIGIN } })).rejects.toThrow(/401/);
    const cookie = await loginCookie(app);
    await expect(app.injectWS('/ws', { headers: { origin: 'https://evil.example', cookie } })).rejects.toThrow(/403/);
    await app.inject({ method: 'POST', url: '/api/logout', headers: { origin: ORIGIN, cookie } });
    await expect(app.injectWS('/ws', { headers: { origin: ORIGIN, cookie } })).rejects.toThrow(/401/);
  });

  it('logout closes open sockets with 4401 and drops the recording', async () => {
    const app = await makeApp();
    const cookie = await loginCookie(app);
    const rec = await startRecording(app, cookie);
    await app.inject({ method: 'POST', url: '/api/logout', headers: { origin: ORIGIN, cookie } });
    expect(await rec.closed).toBe(CLOSE_AUTH_ENDED);

    const cookie2 = await loginCookie(app);
    const again = await connect(app, cookie2);
    again.sendJson({ type: 'session.resume', sessionId: rec.sessionId, lastFinalSeq: 0 });
    await again.waitFor((m) => m.type === 'error' && m.code === 'session_expired');
    again.ws.terminate();
  });

  it('session expiry closes open sockets with 4401, even when idle', async () => {
    const app = await makeApp({ sessionTtlMs: 300 });
    const cookie = await loginCookie(app);
    const conn = await connect(app, cookie);
    expect(await conn.closed).toBe(CLOSE_AUTH_ENDED);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('recording', () => {
  it('turns audio frames into simulated partials, acks, and a final', async () => {
    const app = await makeApp();
    const rec = await startRecording(app, await loginCookie(app));
    rec.sendFrames(0, FRAMES_PER_WORD * WORDS_IN_FIRST_LINE);
    const final = await rec.waitFor((m) => m.type === 'transcript.final');
    expect(final).toMatchObject({ finalSeq: 1, startMs: 0, endMs: 4500 });
    expect(rec.messages.filter((m) => m.type === 'transcript.partial').map((m) => m.text).slice(0, 2)).toEqual([
      'Can',
      'Can you',
    ]);
    expect(rec.messages.some((m) => m.type === 'audio.ack')).toBe(true);
    rec.ws.terminate();
  });

  it('reports frames, bytes, and level received each second', async () => {
    const app = await makeApp();
    const rec = await startRecording(app, await loginCookie(app));
    const loud = new Int16Array(FRAME_SAMPLES).fill(16384); // half scale, about -6 dB
    for (let seq = 0; seq < 5; seq++) rec.ws.send(Buffer.from(encodeAudioFrame(seq, loud)));
    const stats = await rec.waitFor((m) => m.type === 'audio.stats' && (m.frames as number) > 0, 2500);
    expect(stats).toMatchObject({ frames: 5, bytes: 5 * (4 + FRAME_SAMPLES * 2), levelDb: -6 });
    // With no audio the next report is zeros, not a repeat of the last one.
    const idle = await rec.waitFor((m) => m.type === 'audio.stats' && m !== stats, 2500);
    expect(idle).toMatchObject({ frames: 0, bytes: 0, levelDb: -100 });
    rec.ws.terminate();
  });

  it('finalizes the partial after a second without audio (pause or end of speech)', async () => {
    const app = await makeApp();
    const rec = await startRecording(app, await loginCookie(app));
    rec.sendFrames(0, FRAMES_PER_WORD * 2);
    const final = await rec.waitFor((m) => m.type === 'transcript.final', 2500);
    expect(final.text).toBe('Can you');
    const ack = await rec.waitFor((m) => m.type === 'audio.ack' && m.seq === FRAMES_PER_WORD * 2 - 1);
    expect(ack).toBeDefined();
    rec.ws.terminate();
  });

  it('ignores duplicate frames and reports missing ones as a gap', async () => {
    const app = await makeApp();
    const rec = await startRecording(app, await loginCookie(app));
    rec.sendFrames(0, 3);
    rec.sendFrames(0, 3); // duplicates, as after a reconnect
    rec.sendFrames(10, 1);
    const gap = await rec.waitFor((m) => m.type === 'transcript.gap');
    expect(gap).toMatchObject({ fromMs: 300, toMs: 1000 });
    expect(rec.messages.filter((m) => m.type === 'transcript.partial')).toHaveLength(1);
    rec.ws.terminate();
  });

  it('resumes after a disconnect and replays missed finals', async () => {
    const app = await makeApp();
    const cookie = await loginCookie(app);
    const rec = await startRecording(app, cookie);
    const frames = FRAMES_PER_WORD * WORDS_IN_FIRST_LINE;
    rec.sendFrames(0, frames);
    await rec.waitFor((m) => m.type === 'transcript.final');
    rec.ws.terminate();
    await rec.closed;

    const back = await connect(app, cookie);
    back.sendJson({ type: 'session.resume', sessionId: rec.sessionId, lastFinalSeq: 0 });
    const resumed = await back.waitFor((m) => m.type === 'session.resumed');
    expect(resumed).toMatchObject({ sessionId: rec.sessionId, nextAudioSeq: frames });
    expect(await back.waitFor((m) => m.type === 'transcript.final')).toMatchObject({ finalSeq: 1 });
    back.ws.terminate();
  });

  it('lets a resume take over when the server has not noticed the old socket died', async () => {
    const app = await makeApp();
    const cookie = await loginCookie(app);
    const rec = await startRecording(app, cookie);
    rec.sendFrames(0, 3);
    await rec.waitFor((m) => m.type === 'transcript.partial');

    const back = await connect(app, cookie);
    back.sendJson({ type: 'session.resume', sessionId: rec.sessionId, lastFinalSeq: 0 });
    expect(await back.waitFor((m) => m.type === 'session.resumed')).toMatchObject({ nextAudioSeq: 3 });
    expect(await rec.closed).toBe(4000);

    // The old socket closing must not detach the new one.
    back.sendFrames(3, 3);
    await back.waitFor((m) => m.type === 'transcript.partial');
    back.ws.terminate();
  });

  it('refuses to resume from another login session or after the grace period', async () => {
    const app = await makeApp({ resumeGraceMs: 150 });
    const cookie = await loginCookie(app);
    const rec = await startRecording(app, cookie);
    rec.ws.terminate();
    await rec.closed;

    const other = await connect(app, await loginCookie(app));
    other.sendJson({ type: 'session.resume', sessionId: rec.sessionId, lastFinalSeq: 0 });
    await other.waitFor((m) => m.type === 'error' && m.code === 'session_expired');
    other.ws.terminate();

    await sleep(250);
    const late = await connect(app, cookie);
    late.sendJson({ type: 'session.resume', sessionId: rec.sessionId, lastFinalSeq: 0 });
    await late.waitFor((m) => m.type === 'error' && m.code === 'session_expired');
    late.ws.terminate();
  });

  it('refuses Groq mode when GROQ_API_KEY is not set', async () => {
    const app = await makeApp();
    const conn = await connect(app, await loginCookie(app));
    conn.sendJson({ type: 'session.start', mode: 'groq', source: 'mic' });
    await conn.waitFor((m) => m.type === 'error' && m.code === 'provider_unavailable');
    conn.ws.terminate();
  });

  it('transcribes speech through Groq (faked) and stops at the length limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'metor-app-'));
    try {
      const uploads: FormData[] = [];
      const fakeGroq = (async (_url: string, init: RequestInit) => {
        uploads.push(init.body as FormData);
        return Response.json({ segments: [{ text: ' check b g p on the router', no_speech_prob: 0.02 }] });
      }) as unknown as typeof fetch;
      const app = await makeApp(
        { groq: { apiKey: 'test', model: 'whisper-large-v3-turbo' }, usageLedgerPath: join(dir, 'l.json'), maxTranscriptionMs: 4000 },
        undefined,
        fakeGroq,
      );
      const cookie = await loginCookie(app);
      const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
      expect(me.json().providers).toEqual({ groq: true });

      const conn = await connect(app, cookie);
      conn.sendJson({ type: 'session.start', mode: 'groq', source: 'mic' });
      await conn.waitFor((m) => m.type === 'session.started');
      const tone = Int16Array.from({ length: FRAME_SAMPLES }, (_, i) => Math.round(8000 * Math.sin(i / 5)));
      const silence = new Int16Array(FRAME_SAMPLES);
      let seq = 0;
      for (let i = 0; i < 15; i++) conn.ws.send(Buffer.from(encodeAudioFrame(seq++, tone)));
      for (let i = 0; i < 15; i++) conn.ws.send(Buffer.from(encodeAudioFrame(seq++, silence)));
      const final = await conn.waitFor((m) => m.type === 'transcript.final');
      // Raw Whisper text; the client's cleaned view turns "b g p" into BGP.
      expect(final).toMatchObject({ text: 'check b g p on the router', finalSeq: 1, latencyMs: expect.any(Number) });
      expect(uploads).toHaveLength(1);

      // 45 frames in total stays under the rate limiter's 60-frame burst; the 4 s limit hits at frame 40.
      for (let i = 0; i < 15; i++) conn.ws.send(Buffer.from(encodeAudioFrame(seq++, silence)));
      await conn.waitFor((m) => m.type === 'error' && m.code === 'limit_reached');
      conn.ws.terminate();
    } finally {
      await Promise.all(apps.splice(0).map((a) => a.close()));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects audio before session.start and malformed frames', async () => {
    const app = await makeApp();
    const conn = await connect(app, await loginCookie(app));
    conn.sendFrames(0, 1);
    await conn.waitFor((m) => m.type === 'error' && m.code === 'no_session');
    conn.sendJson({ type: 'session.start', mode: 'simulated', source: 'mic' });
    await conn.waitFor((m) => m.type === 'session.started');
    conn.ws.send(Buffer.alloc(7));
    await conn.waitFor((m) => m.type === 'error' && m.code === 'bad_request');
    conn.ws.terminate();
  });

  it('closes a connection that sends audio far faster than real time', async () => {
    const app = await makeApp();
    const rec = await startRecording(app, await loginCookie(app));
    rec.sendFrames(0, 100);
    await rec.waitFor((m) => m.type === 'error' && m.code === 'rate_limited');
    expect(await rec.closed).toBe(1008);
  });
});

describe('message validation', () => {
  it('answers invalid JSON with bad_request and keeps the connection open', async () => {
    const app = await makeApp();
    const conn = await connect(app, await loginCookie(app));
    conn.ws.send('{not json');
    await conn.waitFor((m) => m.type === 'error' && m.code === 'bad_request');
    conn.sendJson({ type: 'session.start', mode: 'simulated', source: 'mic' });
    await conn.waitFor((m) => m.type === 'session.started');
    conn.ws.terminate();
  });

  it('closes the connection when a frame exceeds the max payload', async () => {
    const app = await makeApp();
    const conn = await connect(app, await loginCookie(app));
    conn.ws.send('x'.repeat(MAX_PAYLOAD_BYTES + 1));
    expect(await conn.closed).toBe(1009);
  });

  it('does not log user-supplied content or the passphrase', async () => {
    const lines: string[] = [];
    const app = await makeApp({}, { write: (line) => lines.push(line) });
    await login(app, 'secret-wrong-passphrase');
    const conn = await connect(app, await loginCookie(app));
    for (const raw of [
      '{"secret-key-in-json": oops',
      JSON.stringify({ type: 'session.stop', id: 'm', ts: 1, 'secret-extra-key': 1 }),
      JSON.stringify({ type: 'secret-type-value', id: 'm', ts: 1 }),
    ]) {
      const before = conn.messages.length;
      conn.ws.send(raw);
      await conn.waitFor(() => conn.messages.length > before);
    }
    conn.ws.terminate();
    const log = lines.join('');
    expect(log).toContain('invalid ws message');
    expect(log).toContain('login failed');
    expect(log).not.toMatch(/secret|test passphrase|metor_session=/);
  });
});

describe('answers', () => {
  const ask = (overrides: Record<string, unknown> = {}) => ({
    type: 'answer.request',
    questionId: crypto.randomUUID(),
    question: 'How does BGP choose the best path?',
    length: 'short',
    engine: 'simulated',
    statements: [],
    turns: [],
    isFollowUp: false,
    ...overrides,
  });

  it('streams a header, answer text, and done with timings', async () => {
    const app = await makeApp();
    const conn = await connect(app, await loginCookie(app));
    const req = ask();
    conn.sendJson(req);
    const done = await conn.waitFor((m) => m.type === 'answer.done' && m.questionId === req.questionId);
    expect(done).toMatchObject({ model: 'simulated', firstTokenMs: expect.any(Number), totalMs: expect.any(Number) });
    const header = conn.messages.find((m) => m.type === 'answer.header');
    expect(header).toMatchObject({ questionId: req.questionId, questionType: 'technical', assessment: 'none' });
    const text = conn.messages.filter((m) => m.type === 'answer.delta').map((m) => m.text).join('');
    expect(text).toContain('(Simulated answer.)');
    expect(conn.messages.findIndex((m) => m.type === 'answer.header')).toBeLessThan(conn.messages.findIndex((m) => m.type === 'answer.delta'));
    conn.ws.terminate();
  });

  it('rejects a repeated questionId, an unconfigured engine, and too many answers', async () => {
    const app = await makeApp({ maxAnswersPerSession: 2 });
    const conn = await connect(app, await loginCookie(app));
    const first = ask();
    conn.sendJson(first);
    await conn.waitFor((m) => m.type === 'answer.done');
    conn.sendJson({ ...first, id: 'again' });
    await conn.waitFor((m) => m.type === 'answer.failed' && m.code === 'duplicate');
    conn.sendJson(ask({ engine: 'groq-120b' }));
    await conn.waitFor((m) => m.type === 'answer.failed' && m.code === 'provider_unavailable');
    conn.sendJson(ask());
    await conn.waitFor((m) => m.type === 'answer.done' && m !== conn.messages.find((x) => x.type === 'answer.done'));
    conn.sendJson(ask());
    await conn.waitFor((m) => m.type === 'answer.failed' && m.code === 'limit_reached');
    conn.ws.terminate();
  });

  it('cancels on request, and a new question replaces the one in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slowGroq = (async () => {
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"ANSWER:\\nThinking"}}]}\n\n'));
          await gate;
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const dir = await mkdtemp(join(tmpdir(), 'metor-answers-'));
    try {
      const app = await makeApp({ groq: { apiKey: 'k', model: 'whisper-large-v3-turbo' }, usageLedgerPath: join(dir, 'l.json') }, undefined, slowGroq);
      const conn = await connect(app, await loginCookie(app));
      const a = ask({ engine: 'groq-20b' });
      conn.sendJson(a);
      await conn.waitFor((m) => m.type === 'answer.delta' && m.questionId === a.questionId);
      conn.sendJson({ type: 'answer.cancel', questionId: a.questionId });
      await conn.waitFor((m) => m.type === 'answer.failed' && m.questionId === a.questionId && m.code === 'cancelled');

      const b = ask({ engine: 'groq-120b' });
      conn.sendJson(b);
      await conn.waitFor((m) => m.type === 'answer.delta' && m.questionId === b.questionId);
      const c = ask();
      conn.sendJson(c);
      await conn.waitFor((m) => m.type === 'answer.failed' && m.questionId === b.questionId && m.code === 'cancelled');
      await conn.waitFor((m) => m.type === 'answer.done' && m.questionId === c.questionId);

      const usage = await app.inject({ method: 'GET', url: '/api/usage', headers: { cookie: (await loginCookie(app)) } });
      expect(usage.json().groq.answers.lastMinute.requests).toBe(2);
      conn.ws.terminate();
    } finally {
      release();
      await Promise.all(apps.splice(0).map((x) => x.close()));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a Groq answer when the local free-tier token budget is used up', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'metor-answers-'));
    try {
      const app = await makeApp(
        { groq: { apiKey: 'k', model: 'whisper-large-v3-turbo' }, usageLedgerPath: join(dir, 'l.json'), freeQuotaRatio: 0.1 },
        undefined,
        (async () => new Response('should not be called', { status: 500 })) as unknown as typeof fetch,
      );
      const conn = await connect(app, await loginCookie(app));
      conn.sendJson(ask({ engine: 'groq-120b', length: 'detailed' })); // ~1,900 tokens > 800 allowed per minute
      await conn.waitFor((m) => m.type === 'answer.failed' && m.code === 'quota_exhausted');
      conn.ws.terminate();
    } finally {
      await Promise.all(apps.splice(0).map((x) => x.close()));
      await rm(dir, { recursive: true, force: true });
    }
  });
});

