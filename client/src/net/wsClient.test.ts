import { beforeEach, describe, expect, it } from 'vitest';
import { WsClient, sameOriginWsUrl, type ConnectionStatus, type SocketLike } from './wsClient.ts';

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike['onopen'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  onmessage: SocketLike['onmessage'] = null;
  sent: string[] = [];
  closed = false;
  readonly url: string;
  constructor(url: string) { this.url = url; }
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({}); }
  drop() { this.readyState = 3; this.onclose?.({}); }
  receive(data: unknown) { this.onmessage?.({ data }); }
}

interface Timer { fn: () => void; ms: number }

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: Timer[] = [];
  const statuses: ConnectionStatus[] = [];
  const messages: unknown[] = [];
  const invalid: string[] = [];
  const client = new WsClient({
    url: 'ws://test/ws',
    createSocket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
    random: () => 0.999999,
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (h) => { const i = timers.indexOf(h as Timer); if (i >= 0) timers.splice(i, 1); },
    onStatus: (s) => statuses.push(s),
    onMessage: (m) => messages.push(m),
    onInvalid: (e) => invalid.push(e),
  });
  const fireTimer = () => { const t = timers.shift(); if (!t) throw new Error('no timer'); t.fn(); return t.ms; };
  return { client, sockets, timers, statuses, messages, invalid, fireTimer };
}

describe('sameOriginWsUrl', () => {
  it('uses wss for https pages and ws for http, with no query string', () => {
    expect(sameOriginWsUrl({ protocol: 'https:', host: 'x-5173.app.github.dev' })).toBe('wss://x-5173.app.github.dev/ws');
    expect(sameOriginWsUrl({ protocol: 'http:', host: '127.0.0.1:8787' })).toBe('ws://127.0.0.1:8787/ws');
  });
});

describe('WsClient', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup(); });

  it('connects and reports status', () => {
    t.client.start();
    expect(t.statuses).toEqual(['connecting']);
    t.sockets[0]!.open();
    expect(t.client.status).toBe('connected');
  });

  it('reconnects with growing backoff after drops, and resets after success', () => {
    t.client.start();
    t.sockets[0]!.open();
    t.sockets[0]!.drop();
    expect(t.client.status).toBe('disconnected');
    expect(t.fireTimer()).toBe(500);
    t.sockets[1]!.drop(); // failed attempt
    expect(t.fireTimer()).toBe(1000);
    t.sockets[2]!.drop();
    expect(t.fireTimer()).toBe(2000);
    expect(t.client.failedAttempts).toBe(3);
    t.sockets[3]!.open();
    expect(t.client.status).toBe('connected');
    expect(t.client.failedAttempts).toBe(0);
    t.sockets[3]!.drop();
    expect(t.fireTimer()).toBe(500);
  });

  it('keeps retrying at the 8 s cap', () => {
    t.client.start();
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) { t.sockets.at(-1)!.drop(); delays.push(t.fireTimer()); }
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000, 8000]);
  });

  it('stop() closes the socket and cancels pending reconnects', () => {
    t.client.start();
    t.sockets[0]!.open();
    t.sockets[0]!.drop();
    expect(t.timers).toHaveLength(1);
    t.client.stop();
    expect(t.timers).toHaveLength(0);
    expect(t.client.status).toBe('disconnected');

    t.client.start();
    t.sockets[1]!.open();
    t.client.stop();
    expect(t.sockets[1]!.closed).toBe(true);
    expect(t.timers).toHaveLength(0);
  });

  it('sends only while connected', () => {
    t.client.start();
    const msg = { type: 'echo.request', id: '1', ts: 1, text: 'hi' } as const;
    expect(t.client.send(msg)).toBe(false);
    t.sockets[0]!.open();
    expect(t.client.send(msg)).toBe(true);
    expect(JSON.parse(t.sockets[0]!.sent[0]!)).toEqual(msg);
  });

  it('delivers valid server messages and reports invalid ones', () => {
    t.client.start();
    t.sockets[0]!.open();
    t.sockets[0]!.receive(JSON.stringify({ type: 'echo', id: '1', ts: 2, text: 'hi' }));
    t.sockets[0]!.receive('{bad');
    t.sockets[0]!.receive(new ArrayBuffer(4));
    expect(t.messages).toEqual([{ type: 'echo', id: '1', ts: 2, text: 'hi' }]);
    expect(t.invalid).toEqual(['invalid JSON', 'non-text frame']);
  });

  it('ignores close events from a socket it already replaced', () => {
    t.client.start();
    const first = t.sockets[0]!;
    first.drop();
    t.fireTimer();
    t.sockets[1]!.open();
    first.onclose?.({}); // stale event
    expect(t.client.status).toBe('connected');
    expect(t.timers).toHaveLength(0);
  });
});
