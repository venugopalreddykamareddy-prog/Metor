import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_TIMEOUT_MS, WsClient, sameOriginWsUrl, type ConnectionStatus } from './wsClient.ts';

// Minimal stand-in for the browser WebSocket, installed as the global.
class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  closeCode: number | undefined;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: string) { this.sent.push(data); }
  close(code?: number) { this.closed = true; this.closeCode = code; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  drop() { this.readyState = 3; this.onclose?.(); }
  receive(data: unknown) { this.onmessage?.({ data }); }
}

const latest = () => FakeSocket.instances.at(-1)!;

let statuses: ConnectionStatus[];
let messages: unknown[];
let invalid: string[];
let client: WsClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(Math, 'random').mockReturnValue(0.999999); // jitter at the ceiling
  FakeSocket.instances = [];
  statuses = [];
  messages = [];
  invalid = [];
  client = new WsClient({
    url: 'ws://test/ws',
    onStatus: (s) => statuses.push(s),
    onMessage: (m) => messages.push(m),
    onInvalid: (e) => invalid.push(e),
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
  it('reports connecting, then connected', () => {
    client.start();
    latest().open();
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(latest().url).toBe('ws://test/ws');
  });

  it('reconnects with growing delays and resets after a successful connection', () => {
    client.start();
    latest().open();
    latest().drop();
    expect(client.status).toBe('disconnected');
    expect(waitForReconnect()).toBe(500);
    latest().drop();
    expect(waitForReconnect()).toBe(1000);
    latest().drop();
    expect(waitForReconnect()).toBe(2000);
    latest().open();
    expect(client.status).toBe('connected');
    latest().drop();
    expect(waitForReconnect()).toBe(500);
  });

  it('keeps retrying at the 8 s cap while the server is down', () => {
    client.start();
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      latest().drop();
      delays.push(waitForReconnect());
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it('stop() closes the socket and cancels a pending reconnect', () => {
    client.start();
    latest().open();
    latest().drop();
    client.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.status).toBe('disconnected');

    client.start();
    const socket = latest();
    socket.open();
    client.stop();
    expect(socket.closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('sends only while connected', () => {
    const msg = { type: 'echo.request', id: '1', ts: 1, text: 'hi' } as const;
    client.start();
    expect(client.send(msg)).toBe(false);
    latest().open();
    expect(client.send(msg)).toBe(true);
    expect(JSON.parse(latest().sent[0]!)).toEqual(msg);
  });

  it('passes on valid server messages and reports invalid ones', () => {
    client.start();
    latest().open();
    latest().receive(JSON.stringify({ type: 'echo', id: '1', ts: 2, text: 'hi' }));
    latest().receive('{bad');
    latest().receive(new ArrayBuffer(4));
    expect(messages).toEqual([{ type: 'echo', id: '1', ts: 2, text: 'hi' }]);
    expect(invalid).toEqual(['invalid JSON', 'non-text frame']);
  });

  it('abandons a socket that never finishes connecting and retries', () => {
    client.start();
    const stuck = latest();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
    expect(stuck.closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(stuck.closed).toBe(true);
    expect(stuck.closeCode).toBe(4000);
    expect(client.status).toBe('disconnected');
    expect(waitForReconnect()).toBe(500);
    latest().open();
    expect(client.status).toBe('connected');
  });

  it('does not time out a socket that connected', () => {
    client.start();
    latest().open();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS * 3);
    expect(latest().closed).toBe(false);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('ignores a late close event from a socket it already replaced', () => {
    client.start();
    const first = latest();
    first.drop();
    waitForReconnect();
    latest().open();
    first.onclose?.();
    expect(client.status).toBe('connected');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
