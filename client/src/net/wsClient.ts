import { CLOSE_AUTH_ENDED, parseServerMessage, type ClientMessageBody, type ServerMessage } from '../../../shared/messages.ts';
import { backoffDelay } from './backoff.ts';

/** A socket still connecting after this long is abandoned and retried. */
export const CONNECT_TIMEOUT_MS = 10_000;
/** 0.5 + 1 + 2 + 4 + 8 + 8 s ≈ 24 s of retries, inside the server's 30 s resume window. */
export const MAX_RECONNECT_ATTEMPTS = 6;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface WsClientOptions {
  url: string;
  onStatus?: (status: ConnectionStatus) => void;
  onOpen?: () => void;
  onMessage?: (message: ServerMessage) => void;
  onInvalid?: (error: string) => void;
  /** The server closed the socket because the login session ended. The client stops. */
  onAuthEnded?: () => void;
}

export function sameOriginWsUrl(loc: Pick<Location, 'protocol' | 'host'>): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

/** WebSocket that reconnects with backoff until stop(), auth ends, or retries run out. */
export class WsClient {
  private readonly opts: WsClientOptions;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private failedAttempts = 0;
  private running = false;
  private _status: ConnectionStatus = 'disconnected';

  constructor(opts: WsClientOptions) {
    this.opts = opts;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.failedAttempts = 0;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.clearReconnectTimer();
    this.dropSocket(1000, 'client stopped');
    this.setStatus('disconnected');
  }

  /** Returns false when not connected. Messages are not queued. */
  send(message: ClientMessageBody): boolean {
    if (!this.isOpen) return false;
    this.socket?.send(JSON.stringify({ ...message, id: crypto.randomUUID(), ts: Date.now() }));
    return true;
  }

  sendBinary(data: ArrayBuffer): boolean {
    if (!this.isOpen) return false;
    this.socket?.send(data);
    return true;
  }

  private connect(): void {
    this.reconnectTimer = null;
    this.setStatus('connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    // A blackholed network can leave the handshake pending for minutes.
    this.connectTimer = setTimeout(() => {
      this.dropSocket(4000, 'connect timeout');
      this.scheduleReconnect();
    }, CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      this.clearConnectTimer();
      this.failedAttempts = 0;
      this.setStatus('connected');
      this.opts.onOpen?.();
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        this.opts.onInvalid?.('non-text frame');
        return;
      }
      const parsed = parseServerMessage(event.data);
      if (parsed.ok) this.opts.onMessage?.(parsed.value);
      else this.opts.onInvalid?.(parsed.error);
    };
    // Browsers always fire close after error, so reconnect is handled only here.
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.clearConnectTimer();
      this.socket = null;
      if (event.code === CLOSE_AUTH_ENDED) {
        this.running = false;
        this.setStatus('disconnected');
        this.opts.onAuthEnded?.();
        return;
      }
      this.scheduleReconnect();
    };
  }

  /** Closes the current socket without triggering its close handler's reconnect. */
  private dropSocket(code: number, reason: string): void {
    this.clearConnectTimer();
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onclose = socket.onmessage = null;
    socket.close(code, reason);
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    if (this.failedAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.running = false;
      this.setStatus('failed');
      return;
    }
    this.setStatus('disconnected');
    const delay = backoffDelay(this.failedAttempts);
    this.failedAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this._status) return;
    this._status = status;
    this.opts.onStatus?.(status);
  }
}
