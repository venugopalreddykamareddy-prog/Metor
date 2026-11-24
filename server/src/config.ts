import { parsePassphraseHash, type ParsedHash } from './auth/passphrase.ts';

export interface ServerConfig {
  host: string;
  port: number;
  production: boolean;
  allowedOrigins: ReadonlySet<string>;
  passphraseHash: ParsedHash;
  sessionTtlMs: number;
  resumeGraceMs: number;
  maxTranscriptionMs: number;
  usageLedgerPath: string;
  freeQuotaRatio: number;
  groq: { apiKey: string; model: string } | null;
}

const DEV_CLIENT_PORT = 5173;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const RESUME_GRACE_MS = 30_000;

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

/** Origins allowed to open /ws: local dev and own port, Codespaces forwarded URLs, plus ALLOWED_ORIGINS. */
export function buildAllowedOrigins(env: NodeJS.ProcessEnv, port: number): Set<string> {
  const origins = new Set<string>();
  for (const p of new Set([port, DEV_CLIENT_PORT])) {
    origins.add(`http://localhost:${p}`);
    origins.add(`http://127.0.0.1:${p}`);
  }
  const codespace = env.CODESPACE_NAME;
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (codespace && domain) {
    for (const p of new Set([port, DEV_CLIENT_PORT])) {
      origins.add(`https://${codespace}-${p}.${domain}`);
    }
  }
  for (const origin of (env.ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = origin.trim();
    if (trimmed) origins.add(trimmed.replace(/\/$/, ''));
  }
  return origins;
}

/** Answers stay simulated until Phase 4; refuse anything else instead of silently ignoring it. */
function checkProviders(env: NodeJS.ProcessEnv): void {
  const answer = env.ANSWER_PROVIDER || 'simulated';
  if (answer !== 'simulated') throw new Error(`ANSWER_PROVIDER=${answer} is not available yet; use simulated`);
  if ((env.ALLOW_PAID_PROVIDERS ?? 'false') !== 'false') {
    throw new Error('ALLOW_PAID_PROVIDERS must be false; Metor has no paid providers');
  }
}

function positiveNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name}: ${raw}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = parsePort(env.PORT, 8787);
  checkProviders(env);
  if (!env.APP_PASSPHRASE_HASH) {
    throw new Error('APP_PASSPHRASE_HASH is not set; see docs/DEVELOPMENT.md (pnpm hash-passphrase)');
  }
  return {
    // Loopback only: Codespaces port forwarding still reaches it, nothing else on the network can.
    host: '127.0.0.1',
    port,
    production: env.NODE_ENV === 'production',
    allowedOrigins: buildAllowedOrigins(env, port),
    passphraseHash: parsePassphraseHash(env.APP_PASSPHRASE_HASH),
    sessionTtlMs: SESSION_TTL_MS,
    resumeGraceMs: RESUME_GRACE_MS,
    maxTranscriptionMs: positiveNumber(env, 'MAX_TRANSCRIPTION_MINUTES', 90) * 60_000,
    usageLedgerPath: env.SPEND_LEDGER_PATH || './data/usage-ledger.json',
    freeQuotaRatio: Math.min(1, positiveNumber(env, 'FREE_QUOTA_SAFETY_RATIO', 0.8)),
    // Transcription mode is picked per recording in the UI; Groq is offered only when a key is set.
    groq: env.GROQ_API_KEY
      ? { apiKey: env.GROQ_API_KEY, model: env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo' }
      : null,
  };
}
