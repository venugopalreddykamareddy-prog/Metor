import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyPassphrase, type ParsedHash } from './passphrase.ts';
import type { AuthSessions } from './sessions.ts';

export const SESSION_COOKIE = 'metor_session';
const MAX_FAILED_LOGINS = 5;
const FAILED_LOGIN_WINDOW_MS = 15 * 60_000;

export function readSessionCookie(request: FastifyRequest): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return undefined;
}

function sessionCookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

interface AuthRouteOptions {
  passphraseHash: ParsedHash;
  sessions: AuthSessions;
  sessionTtlMs: number;
  allowedOrigins: ReadonlySet<string>;
}

export async function registerAuthRoutes(app: FastifyInstance, opts: AuthRouteOptions): Promise<void> {
  const failedLogins = new Map<string, number[]>();

  // Cookies are SameSite=Strict already; checking Origin on writes also covers older browsers.
  const checkOrigin = async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin;
    if (!origin || !opts.allowedOrigins.has(origin)) {
      await reply.code(403).send({ error: 'origin not allowed' });
    }
  };

  const requireSession = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!opts.sessions.isValid(readSessionCookie(request))) {
      await reply.code(401).send({ error: 'not logged in' });
    }
  };

  app.post<{ Body: { passphrase: string } }>(
    '/api/login',
    {
      preHandler: checkOrigin,
      schema: {
        body: {
          type: 'object',
          required: ['passphrase'],
          additionalProperties: false,
          properties: { passphrase: { type: 'string', minLength: 1, maxLength: 256 } },
        },
      },
    },
    async (request, reply) => {
      const now = Date.now();
      const recent = (failedLogins.get(request.ip) ?? []).filter((t) => now - t < FAILED_LOGIN_WINDOW_MS);
      if (recent.length >= MAX_FAILED_LOGINS) {
        const retryAfter = Math.ceil(((recent[0] ?? now) + FAILED_LOGIN_WINDOW_MS - now) / 1000);
        return reply.code(429).header('retry-after', retryAfter).send({ error: 'too many attempts' });
      }
      if (!(await verifyPassphrase(request.body.passphrase, opts.passphraseHash))) {
        failedLogins.set(request.ip, [...recent, now]);
        request.log.warn('login failed');
        return reply.code(401).send({ error: 'wrong passphrase' });
      }
      failedLogins.delete(request.ip);
      const id = opts.sessions.create();
      request.log.info('login succeeded');
      return reply
        .header('set-cookie', sessionCookie(id, Math.floor(opts.sessionTtlMs / 1000)))
        .send({ authenticated: true });
    },
  );

  app.post('/api/logout', { preHandler: checkOrigin }, async (request, reply) => {
    const id = readSessionCookie(request);
    if (id) opts.sessions.end(id);
    return reply.header('set-cookie', sessionCookie('', 0)).send({ authenticated: false });
  });

  app.get('/api/me', { preHandler: requireSession }, async () => ({ authenticated: true }));
}
