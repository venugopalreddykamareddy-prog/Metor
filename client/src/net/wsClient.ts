import { parseServerMessage, type ClientMessage, type ServerMessage } from '../../../shared/messages.ts';
import { backoffDelay } from './backoff.ts';

/** A socket still connecting after this long is abandoned and retried. */
export const CONNECT_TIMEOUT_MS = 10_000;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface WsClientOptions {
  url: string;
  onStatus?: (status: ConnectionStatus) => void;
  onMessage?: (message: ServerMessage) => void;
  onInvalid?: (error: string) => void;
}

export function sameOriginWsUrl(loc: Pick<Location, 'protocol' | 'host'>): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

/** WebSocket that reconnects with backoff until stop() is called. */
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

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.dropSocket(1000, 'client stopped');
    this.setStatus('disconnected');
  }

  /** Returns false when not connected. Messages are not queued. */
  send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
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
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.clearConnectTimer();
      this.socket = null;
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

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    this.setStatus('disconnected');
    const delay = backoffDelay(this.failedAttempts);
    this.failedAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this._status) return;
    this._status = status;
    this.opts.onStatus?.(status);
  }
}
