// Separate from index.ts so tests can build the app without listening on a port.
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { MAX_PAYLOAD_BYTES } from '../../shared/messages.ts';
import type { ServerConfig } from './config.ts';
import { registerAuthRoutes } from './auth/routes.ts';
import { AuthSessions } from './auth/sessions.ts';
import { UsageLedger, type QuotaLimits } from './limits/usageLedger.ts';
import { createGroqStt } from './stt/groq.ts';
import { createSimulatedStt } from './stt/simulated.ts';
import { registerGateway } from './ws/gateway.ts';
import { Recordings } from './ws/recording.ts';

interface BuildOptions {
  logger?: boolean;
  /** Where log lines go (default stdout). Tests use it to inspect logs. */
  logStream?: { write(line: string): void };
  /** Replaces global fetch for Groq calls. Tests use it; CI never calls Groq. */
  groqFetch?: typeof fetch;
}

// Groq's published Whisper limits (checked 2026-11-24; the page labels them Developer plan, and
// free-tier values may be lower). The ledger allows FREE_QUOTA_SAFETY_RATIO of them; a 429 from
// Groq still pauses transcription.
const GROQ_WHISPER_LIMITS: QuotaLimits = {
  perMinute: { requests: 20, audioSeconds: 7200 },
  perHour: { requests: 2000, audioSeconds: 7200 },
  perDay: { requests: 2000, audioSeconds: 28_800 },
};

function scaled(limits: QuotaLimits, ratio: number): QuotaLimits {
  const scale = (u: { requests: number; audioSeconds: number }) => ({
    requests: Math.floor(u.requests * ratio),
    audioSeconds: Math.floor(u.audioSeconds * ratio),
  });
  return { perMinute: scale(limits.perMinute), perHour: scale(limits.perHour), perDay: scale(limits.perDay) };
}

export async function buildApp(config: ServerConfig, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: (opts.logger ?? true)
      ? {
          level: config.production ? 'info' : 'debug',
          // Never log cookies or auth headers (SECURITY_PRIVACY §5).
          redact: ['req.headers.cookie', 'req.headers.authorization'],
          ...(opts.logStream ? { stream: opts.logStream } : {}),
        }
      : false,
    bodyLimit: MAX_PAYLOAD_BYTES,
  });

  const recordings = new Recordings(config.resumeGraceMs, config.maxTranscriptionMs);
  const sessions = new AuthSessions(config.sessionTtlMs, (authId) => recordings.removeForAuth(authId));

  let groq: ReturnType<typeof createGroqStt> | undefined;
  if (config.groq) {
    const ledger = new UsageLedger(config.usageLedgerPath, scaled(GROQ_WHISPER_LIMITS, config.freeQuotaRatio), {
      onWriteError: (err) => app.log.error({ err }, 'could not save usage ledger'),
    });
    await ledger.load();
    groq = createGroqStt({ ...config.groq, ledger, log: app.log, ...(opts.groqFetch ? { fetch: opts.groqFetch } : {}) });
    app.addHook('onClose', () => ledger.flush());
  }

  await app.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });

  app.get('/healthz', async () => ({ status: 'ok' }));

  await registerAuthRoutes(app, {
    passphraseHash: config.passphraseHash,
    sessions,
    sessionTtlMs: config.sessionTtlMs,
    allowedOrigins: config.allowedOrigins,
    providers: { groq: groq !== undefined },
  });
  await registerGateway(app, {
    allowedOrigins: config.allowedOrigins,
    sessions,
    recordings,
    stt: { simulated: createSimulatedStt, ...(groq ? { groq } : {}) },
  });

  if (config.production) {
    // Compiled layout: dist/server/src/app.js → dist/client/
    const root = fileURLToPath(new URL('../../client/', import.meta.url));
    await app.register(fastifyStatic, { root });
  }

  return app;
}
