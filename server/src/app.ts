// Separate from index.ts so tests can build the app without listening on a port.
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { MAX_PAYLOAD_BYTES } from '../../shared/messages.ts';
import type { ServerConfig } from './config.ts';
import { registerAuthRoutes } from './auth/routes.ts';
import { AuthSessions } from './auth/sessions.ts';
import { createGroqAnswer } from './answer/groq.ts';
import { createSimulatedAnswer } from './answer/simulated.ts';
import type { AnswerProvider } from './answer/types.ts';
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
  /** Delay between simulated answer words; tests use 0. */
  simulatedAnswerDelayMs?: number;
}

// Groq's published Whisper limits (checked 2026-11-24; the page labels them Developer plan, and
// free-tier values may be lower). The ledger allows FREE_QUOTA_SAFETY_RATIO of them; a 429 from
// Groq still pauses transcription.
const GROQ_WHISPER_LIMITS: QuotaLimits = {
  perMinute: { requests: 20, units: 7200 },
  perHour: { requests: 2000, units: 7200 },
  perDay: { requests: 2000, units: 28_800 },
};

// Groq's published limits for openai/gpt-oss-20b and -120b (checked 2026-11-24, Developer-plan
// table): 30 requests/min, 1K/day, 8K tokens/min, 200K tokens/day. No hourly limit is listed.
export const GROQ_CHAT_LIMITS: QuotaLimits = {
  perMinute: { requests: 30, units: 8000 },
  perHour: { requests: 1000, units: 200_000 },
  perDay: { requests: 1000, units: 200_000 },
};

export function scaled(limits: QuotaLimits, ratio: number): QuotaLimits {
  const scale = (u: { requests: number; units: number }) => ({
    requests: Math.floor(u.requests * ratio),
    units: Math.floor(u.units * ratio),
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
  let sttLedger: UsageLedger | null = null;
  let chatLedger: UsageLedger | null = null;
  const answerProviders: Partial<Record<'simulated' | 'groq-120b' | 'groq-20b', AnswerProvider>> = {
    simulated: createSimulatedAnswer(opts.simulatedAnswerDelayMs),
  };
  if (config.groq) {
    const onWriteError = (err: unknown) => app.log.error({ err }, 'could not save usage ledger');
    const fetchOpt = opts.groqFetch ? { fetch: opts.groqFetch } : {};
    sttLedger = new UsageLedger(config.usageLedgerPath, scaled(GROQ_WHISPER_LIMITS, config.freeQuotaRatio), { onWriteError });
    chatLedger = new UsageLedger(config.usageLedgerPath.replace(/(\.json)?$/, '-answers.json'), scaled(GROQ_CHAT_LIMITS, config.freeQuotaRatio), {
      onWriteError,
    });
    await Promise.all([sttLedger.load(), chatLedger.load()]);
    groq = createGroqStt({ ...config.groq, ledger: sttLedger, log: app.log, ...fetchOpt });
    const { apiKey } = config.groq;
    answerProviders['groq-120b'] = createGroqAnswer({ apiKey, model: 'openai/gpt-oss-120b', log: app.log, ...fetchOpt });
    answerProviders['groq-20b'] = createGroqAnswer({ apiKey, model: 'openai/gpt-oss-20b', log: app.log, ...fetchOpt });
    const ledgers = [sttLedger, chatLedger];
    app.addHook('onClose', () => Promise.all(ledgers.map((l) => l.flush())).then(() => undefined));
  }

  await app.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });

  app.get('/healthz', async () => ({ status: 'ok' }));

  await registerAuthRoutes(app, {
    passphraseHash: config.passphraseHash,
    sessions,
    sessionTtlMs: config.sessionTtlMs,
    allowedOrigins: config.allowedOrigins,
    providers: { groq: groq !== undefined },
    usage: () => {
      if (!sttLedger || !chatLedger) return { groq: null };
      const windows = (l: UsageLedger) => ({ lastMinute: l.usedInLast(1), lastHour: l.usedInLast(60), lastDay: l.usedInLast(24 * 60) });
      return {
        groq: {
          transcription: { ...windows(sttLedger), limits: scaled(GROQ_WHISPER_LIMITS, config.freeQuotaRatio), unit: 'audio seconds' },
          answers: { ...windows(chatLedger), limits: scaled(GROQ_CHAT_LIMITS, config.freeQuotaRatio), unit: 'tokens' },
        },
      };
    },
  });
  await registerGateway(app, {
    allowedOrigins: config.allowedOrigins,
    sessions,
    recordings,
    stt: { simulated: createSimulatedStt, ...(groq ? { groq } : {}) },
    answers: { providers: answerProviders, ledger: chatLedger, maxAnswers: config.maxAnswersPerSession, log: app.log },
  });

  if (config.production) {
    // Compiled layout: dist/server/src/app.js → dist/client/
    const root = fileURLToPath(new URL('../../client/', import.meta.url));
    await app.register(fastifyStatic, { root });
  }

  return app;
}
