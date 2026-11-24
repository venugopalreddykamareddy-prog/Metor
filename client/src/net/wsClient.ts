// Typed WebSocket client with automatic reconnect (exponential backoff + jitter).
import {
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '../../../shared/messages.ts';
import { backoffDelay } from './backoff.ts';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/** Minimal socket surface used by the client, so tests can inject a fake. */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const OPEN = 1;

export interface WsClientOptions {
  url: string;
  onStatus?: (status: ConnectionStatus) => void;
  onMessage?: (message: ServerMessage) => void;
  /** Called for frames that fail schema validation. */
  onInvalid?: (error: string) => void;
  createSocket?: (url: string) => SocketLike;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Same-origin WebSocket URL for the current page. No credentials in the URL. */
export function sameOriginWsUrl(loc: Pick<Location, 'protocol' | 'host'>, path = '/ws'): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${path}`;
}

export class WsClient {
  private readonly opts: Required<Omit<WsClientOptions, 'onStatus' | 'onMessage' | 'onInvalid'>> &
    Pick<WsClientOptions, 'onStatus' | 'onMessage' | 'onInvalid'>;
  private socket: SocketLike | null = null;
  private attempt = 0;
  private timer: unknown = null;
  private stopped = true;
  private _status: ConnectionStatus = 'disconnected';

  constructor(options: WsClientOptions) {
    this.opts = {
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      random: Math.random,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...options,
    };
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  /** Number of consecutive failed connection attempts since the last successful open. */
  get failedAttempts(): number {
    return this.attempt;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      this.opts.clearTimer(this.timer);
      this.timer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = null;
      socket.onmessage = null;
      socket.close(1000, 'client stopped');
    }
    this.setStatus('disconnected');
  }

  /** Sends a message if connected. Returns false (message not queued) when disconnected. */
  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private connect(): void {
    this.timer = null;
    this.setStatus('connecting');
    let socket: SocketLike;
    try {
      socket = this.opts.createSocket(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus('connected');
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        this.opts.onInvalid?.('non-text frame');
        return;
      }
      const parsed = parseServerMessage(ev.data);
      if (parsed.ok) this.opts.onMessage?.(parsed.value);
      else this.opts.onInvalid?.(parsed.error);
    };
    socket.onerror = () => {
      // A close event always follows; reconnect is handled there.
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.setStatus('disconnected');
    const delay = backoffDelay(this.attempt, this.opts.random);
    this.attempt += 1;
    this.timer = this.opts.setTimer(() => this.connect(), delay);
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this._status) return;
    this._status = status;
    this.opts.onStatus?.(status);
  }
}
