import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_AUTH_ENDED } from '../../../shared/messages.ts';
import { CONNECT_TIMEOUT_MS, MAX_RECONNECT_ATTEMPTS, WsClient, sameOriginWsUrl, type ConnectionStatus } from './wsClient.ts';

// Minimal stand-in for the browser WebSocket, installed as the global.
class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  sent: unknown[] = [];
  closeCode: number | undefined;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: unknown) { this.sent.push(data); }
  close(code?: number) { this.closeCode = code ?? 1005; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
  receive(data: unknown) { this.onmessage?.({ data }); }
}

const latest = () => FakeSocket.instances.at(-1)!;

let statuses: ConnectionStatus[];
let events: string[];
let client: WsClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(Math, 'random').mockReturnValue(0.999999); // jitter at the ceiling
  FakeSocket.instances = [];
  statuses = [];
  events = [];
  client = new WsClient({
    url: 'ws://test/ws',
    onStatus: (s) => statuses.push(s),
    onOpen: () => events.push('open'),
    onMessage: (m) => events.push(`message:${m.type}`),
    onInvalid: (e) => events.push(`invalid:${e}`),
    onAuthEnded: () => events.push('auth-ended'),
  });
});

afterEach(() => {
  client.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Advances time until the next socket is created; returns the elapsed ms. */
function waitForReconnect(): number {
  const before = FakeSocket.instances.length;
  let elapsed = 0;
  while (FakeSocket.instances.length === before) {
    vi.advanceTimersByTime(100);
    elapsed += 100;
    if (elapsed > 60_000) throw new Error('no reconnect');
  }
  return elapsed;
}

describe('sameOriginWsUrl', () => {
  it('uses wss on https pages, ws on http, with no credentials in the URL', () => {
    expect(sameOriginWsUrl({ protocol: 'https:', host: 'x-5173.app.github.dev' })).toBe('wss://x-5173.app.github.dev/ws');
    expect(sameOriginWsUrl({ protocol: 'http:', host: '127.0.0.1:8787' })).toBe('ws://127.0.0.1:8787/ws');
  });
});

describe('WsClient', () => {
  it('connects, receives binary as ArrayBuffer, and calls onOpen', () => {
    client.start();
    expect(latest().binaryType).toBe('arraybuffer');
    latest().open();
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(events).toEqual(['open']);
  });

  it('reconnects with growing delays and resets after a successful connection', () => {
    client.start();
    latest().open();
    latest().drop();
    expect(waitForReconnect()).toBe(500);
    latest().drop();
    expect(waitForReconnect()).toBe(1000);
    latest().open();
    latest().drop();
    expect(waitForReconnect()).toBe(500);
  });

  it(`gives up after ${MAX_RECONNECT_ATTEMPTS} failed attempts`, () => {
    client.start();
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
      latest().drop();
      waitForReconnect();
    }
    latest().drop();
    expect(client.status).toBe('failed');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(MAX_RECONNECT_ATTEMPTS + 1);

    client.start(); // manual retry starts fresh
    latest().open();
    expect(client.status).toBe('connected');
  });

  it('stops and reports auth-ended when the server closes with 4401', () => {
    client.start();
    latest().open();
    latest().drop(CLOSE_AUTH_ENDED);
    expect(events).toContain('auth-ended');
    expect(client.status).toBe('disconnected');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('abandons a socket that never finishes connecting and retries', () => {
    client.start();
    const stuck = latest();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(stuck.closeCode).toBe(4000);
    expect(waitForReconnect()).toBe(500);
  });

  it('does not time out a socket that connected', () => {
    client.start();
    latest().open();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS * 3);
    expect(latest().closeCode).toBeUndefined();
  });

  it('stop() closes the socket and cancels a pending reconnect', () => {
    client.start();
    latest().open();
    latest().drop();
    client.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('adds id and ts to JSON messages, sends binary as is, and refuses while disconnected', () => {
    client.start();
    expect(client.send({ type: 'session.stop' })).toBe(false);
    latest().open();
    expect(client.send({ type: 'session.stop' })).toBe(true);
    const frame = new ArrayBuffer(8);
    expect(client.sendBinary(frame)).toBe(true);
    const [json, binary] = latest().sent;
    expect(JSON.parse(json as string)).toMatchObject({ type: 'session.stop', id: expect.any(String), ts: expect.any(Number) });
    expect(binary).toBe(frame);
  });

  it('passes on valid server messages and reports invalid ones', () => {
    client.start();
    latest().open();
    latest().receive(JSON.stringify({ type: 'audio.ack', id: '1', ts: 2, seq: 4 }));
    latest().receive('{bad');
    latest().receive(new ArrayBuffer(4));
    expect(events.slice(1)).toEqual(['message:audio.ack', 'invalid:invalid JSON', 'invalid:non-text frame']);
  });

  it('ignores a late close event from a socket it already replaced', () => {
    client.start();
    const first = latest();
    first.drop();
    waitForReconnect();
    latest().open();
    first.onclose?.({ code: 1006 });
    expect(client.status).toBe('connected');
  });
});
