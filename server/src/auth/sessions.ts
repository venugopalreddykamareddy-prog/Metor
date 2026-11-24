import { randomBytes } from 'node:crypto';
import type { WebSocket } from '@fastify/websocket';
import { CLOSE_AUTH_ENDED } from '../../../shared/messages.ts';

interface AuthSession {
  expiresAt: number;
  timer: NodeJS.Timeout;
  sockets: Set<WebSocket>;
}

/** In-memory login sessions. A restart logs everyone out, which is fine for a single user. */
export class AuthSessions {
  private readonly sessions = new Map<string, AuthSession>();
  private readonly ttlMs: number;
  private readonly onEnd: (sessionId: string) => void;

  /** `onEnd` runs after a session's sockets are closed, on logout or expiry. */
  constructor(ttlMs: number, onEnd: (sessionId: string) => void = () => {}) {
    this.ttlMs = ttlMs;
    this.onEnd = onEnd;
  }

  create(): string {
    const id = randomBytes(32).toString('base64url');
    // A timer, not a check on the next request: an idle socket must still be closed on time.
    const timer = setTimeout(() => this.end(id), this.ttlMs);
    timer.unref();
    this.sessions.set(id, { expiresAt: Date.now() + this.ttlMs, timer, sockets: new Set() });
    return id;
  }

  isValid(id: string | undefined): id is string {
    if (!id) return false;
    const session = this.sessions.get(id);
    return session !== undefined && session.expiresAt > Date.now();
  }

  addSocket(id: string, socket: WebSocket): void {
    const session = this.sessions.get(id);
    if (!session) {
      socket.close(CLOSE_AUTH_ENDED, 'auth ended');
      return;
    }
    session.sockets.add(socket);
    socket.once('close', () => session.sockets.delete(socket));
  }

  /** Logout or expiry: forget the session and close its sockets. */
  end(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    clearTimeout(session.timer);
    for (const socket of session.sockets) socket.close(CLOSE_AUTH_ENDED, 'auth ended');
    this.onEnd(id);
  }
}
