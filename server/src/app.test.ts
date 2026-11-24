import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { MAX_PAYLOAD_BYTES } from '../../shared/messages.ts';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const ORIGIN = 'http://localhost:5173';
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({}), { logger: false });
  await app.ready();
});
afterAll(async () => { await app.close(); });

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
    ws.once('error', reject);
  });
}

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

describe('HTTP', () => {
  it('GET /healthz returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('does not serve static files outside production', async () => {
    const res = await app.inject({ method: 'GET', url: '/index.html' });
    expect(res.statusCode).toBe(404);
  });
});

describe('WebSocket /ws', () => {
  it('echoes a valid message', async () => {
    const ws = await app.injectWS('/ws', { headers: { origin: ORIGIN } });
    const reply = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'echo.request', id: 'm1', ts: 1, text: 'hello' }));
    expect(await reply).toMatchObject({ type: 'echo', id: 'm1', text: 'hello' });
    ws.terminate();
  });

  it('answers invalid JSON with bad_request and keeps the connection open', async () => {
    const ws = await app.injectWS('/ws', { headers: { origin: ORIGIN } });
    let reply = nextMessage(ws);
    ws.send('{not json');
    expect(await reply).toMatchObject({ type: 'error', code: 'bad_request', retryable: false });
    reply = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'echo.request', id: 'm2', ts: 1, text: 'still here' }));
    expect(await reply).toMatchObject({ type: 'echo', text: 'still here' });
    ws.terminate();
  });

  it('does not log user-supplied content from invalid messages', async () => {
    const lines: string[] = [];
    const logged = await buildApp(loadConfig({}), { logStream: { write: (line) => lines.push(line) } });
    await logged.ready();
    const ws = await logged.injectWS('/ws', { headers: { origin: ORIGIN } });
    for (const raw of [
      '{"secret-key-in-json": oops',
      JSON.stringify({ type: 'echo.request', id: 'm', ts: 1, text: 'x', 'secret-extra-key': 1 }),
      JSON.stringify({ type: 'secret-type-value', id: 'm', ts: 1 }),
    ]) {
      const reply = nextMessage(ws);
      ws.send(raw);
      await reply;
    }
    ws.terminate();
    await logged.close();
    const log = lines.join('');
    expect(log).toContain('invalid ws message');
    expect(log).not.toMatch(/secret/);
  });

  it('rejects schema violations and binary frames', async () => {
    const ws = await app.injectWS('/ws', { headers: { origin: ORIGIN } });
    let reply = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'echo.request', id: 'm3', ts: 1, text: '' }));
    expect(await reply).toMatchObject({ type: 'error', code: 'bad_request' });
    reply = nextMessage(ws);
    ws.send(Buffer.from([1, 2, 3]));
    expect(await reply).toMatchObject({ type: 'error', code: 'bad_request', message: expect.stringContaining('binary') });
    ws.terminate();
  });

  it('closes the connection when a frame exceeds the max payload', async () => {
    const ws = await app.injectWS('/ws', { headers: { origin: ORIGIN } });
    const code = closed(ws);
    ws.send('x'.repeat(MAX_PAYLOAD_BYTES + 1));
    expect(await code).toBe(1009); // Message Too Big
  });

  it.each([
    ['a disallowed origin', { origin: 'https://evil.example' }],
    ['no origin', {}],
  ])('rejects the upgrade with %s', async (_label, headers) => {
    await expect(app.injectWS('/ws', { headers })).rejects.toThrow(/403/);
  });
});
