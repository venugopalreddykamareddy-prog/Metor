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
  maxAnswersPerSession: number;
  usageLedgerPath: string;
  freeQuotaRatio: number;
  groq: { apiKey: string; model: string } | null;
  /**
   * Per answer model: GPT-OSS reasoning effort and completion budgets per length (hidden reasoning
   * counts against the budget). 120B is the default; 20B is the optional fast mode.
   */
  answerModels: Record<'groq-120b' | 'groq-20b', { effort: ReasoningEffort; maxTokens: AnswerBudgets }>;
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

/** Metor has no paid providers; refuse a config that asks for them instead of silently ignoring it. */
function checkProviders(env: NodeJS.ProcessEnv): void {
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

export type ReasoningEffort = 'low' | 'medium' | 'high';
export interface AnswerBudgets {
  short: number;
  standard: number;
  detailed: number;
}
// Medium reasoning can use ~1,000 hidden tokens before the answer; at 1,000 a standard answer once
// came back empty, at 1,400 none did (docs/ANSWER_EVALUATION.md). Low reasoning fits 256/512/1024.
export const BUDGETS_120B: AnswerBudgets = { short: 1000, standard: 1400, detailed: 2200 };
export const BUDGETS_FAST: AnswerBudgets = { short: 256, standard: 512, detailed: 1024 };

/** "256,512,1024" → budgets for short, standard, detailed. */
export function parseAnswerMaxTokens(raw: string | undefined, fallback: AnswerBudgets = BUDGETS_FAST): AnswerBudgets {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = raw.split(',').map((v) => Number(v.trim()));
  if (n.length !== 3 || n.some((v) => !Number.isInteger(v) || v < 64 || v > 8192)) {
    throw new Error(`Invalid ANSWER_MAX_TOKENS: ${raw} (expected three integers 64–8192, e.g. 256,512,1024)`);
  }
  return { short: n[0] as number, standard: n[1] as number, detailed: n[2] as number };
}

function parseEffort(raw: string | undefined): ReasoningEffort {
  if (raw === undefined || raw === '') return 'medium';
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  throw new Error(`Invalid ANSWER_REASONING_EFFORT: ${raw} (low, medium or high)`);
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
    maxAnswersPerSession: positiveNumber(env, 'MAX_ANSWERS_PER_SESSION', 100),
    usageLedgerPath: env.SPEND_LEDGER_PATH || './data/usage-ledger.json',
    freeQuotaRatio: Math.min(1, positiveNumber(env, 'FREE_QUOTA_SAFETY_RATIO', 0.8)),
    // Transcription mode and answer engine are picked in the UI; Groq is offered only when a key is set.
    answerModels: {
      'groq-120b': { effort: parseEffort(env.ANSWER_REASONING_EFFORT), maxTokens: parseAnswerMaxTokens(env.ANSWER_MAX_TOKENS, BUDGETS_120B) },
      // Fast mode: always low effort, small budgets.
      'groq-20b': { effort: 'low', maxTokens: parseAnswerMaxTokens(env.ANSWER_MAX_TOKENS_FAST, BUDGETS_FAST) },
    },
    groq: env.GROQ_API_KEY
      ? { apiKey: env.GROQ_API_KEY, model: env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo' }
      : null,
  };
}
