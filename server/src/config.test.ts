import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassphrase } from './auth/passphrase.ts';
import { buildAllowedOrigins, loadConfig, parseAnswerMaxTokens } from './config.ts';

let APP_PASSPHRASE_HASH: string;
beforeAll(async () => {
  APP_PASSPHRASE_HASH = await hashPassphrase('test passphrase 123');
});

describe('loadConfig', () => {
  it('defaults to loopback:8787, non-production, 12 h sessions, 30 s resume window', () => {
    expect(loadConfig({ APP_PASSPHRASE_HASH })).toMatchObject({
      host: '127.0.0.1',
      port: 8787,
      production: false,
      sessionTtlMs: 12 * 60 * 60_000,
      resumeGraceMs: 30_000,
    });
  });

  it('refuses to start without a passphrase hash or with a malformed one', () => {
    expect(() => loadConfig({})).toThrow(/APP_PASSPHRASE_HASH is not set/);
    expect(() => loadConfig({ APP_PASSPHRASE_HASH: 'nope' })).toThrow(/malformed/);
  });

  it('refuses paid providers', () => {
    expect(() => loadConfig({ APP_PASSPHRASE_HASH, ALLOW_PAID_PROVIDERS: 'true' })).toThrow(/must be false/);
  });

  it('offers Groq only when GROQ_API_KEY is set, with a default model', () => {
    expect(loadConfig({ APP_PASSPHRASE_HASH }).groq).toBeNull();
    expect(loadConfig({ APP_PASSPHRASE_HASH, GROQ_API_KEY: 'k' }).groq).toEqual({ apiKey: 'k', model: 'whisper-large-v3-turbo' });
    expect(loadConfig({ APP_PASSPHRASE_HASH, GROQ_API_KEY: 'k', GROQ_TRANSCRIPTION_MODEL: 'whisper-large-v3' }).groq?.model).toBe(
      'whisper-large-v3',
    );
  });

  it('reads limits and rejects bad numbers', () => {
    const c = loadConfig({
      APP_PASSPHRASE_HASH,
      MAX_TRANSCRIPTION_MINUTES: '30',
      FREE_QUOTA_SAFETY_RATIO: '0.5',
      MAX_ANSWERS_PER_SESSION: '20',
    });
    expect(c).toMatchObject({ maxTranscriptionMs: 30 * 60_000, freeQuotaRatio: 0.5, maxAnswersPerSession: 20 });
    expect(() => loadConfig({ APP_PASSPHRASE_HASH, MAX_TRANSCRIPTION_MINUTES: '-1' })).toThrow(/Invalid/);
  });

  it.each(['0', '70000', 'abc'])('rejects invalid PORT %s', (port) => {
    expect(() => loadConfig({ APP_PASSPHRASE_HASH, PORT: port })).toThrow(/Invalid PORT/);
  });
});

describe('buildAllowedOrigins', () => {
  it('includes local dev and own origins only by default', () => {
    expect([...buildAllowedOrigins({}, 8787)].sort()).toEqual([
      'http://127.0.0.1:5173', 'http://127.0.0.1:8787', 'http://localhost:5173', 'http://localhost:8787',
    ]);
  });

  it('adds Codespaces forwarded origins and ALLOWED_ORIGINS', () => {
    const origins = buildAllowedOrigins(
      { CODESPACE_NAME: 'cs', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev', ALLOWED_ORIGINS: ' https://a.example/ ,' },
      8787,
    );
    expect(origins.has('https://cs-5173.app.github.dev')).toBe(true);
    expect(origins.has('https://a.example')).toBe(true);
    expect(origins.has('')).toBe(false);
  });
});

describe('answer token budgets', () => {
  it('defaults to 120B with medium reasoning and room for it, and 20B fast mode with low reasoning', async () => {
    const config = loadConfig({ APP_PASSPHRASE_HASH: await hashPassphrase('x') });
    expect(config.answerModels).toEqual({
      'groq-120b': { effort: 'medium', maxTokens: { short: 1000, standard: 1400, detailed: 2200 } },
      'groq-20b': { effort: 'low', maxTokens: { short: 256, standard: 512, detailed: 1024 } },
    });
    const custom = loadConfig({ APP_PASSPHRASE_HASH: await hashPassphrase('x'), ANSWER_REASONING_EFFORT: 'high', ANSWER_MAX_TOKENS: '1200,1600,2600' });
    expect(custom.answerModels['groq-120b']).toEqual({ effort: 'high', maxTokens: { short: 1200, standard: 1600, detailed: 2600 } });
  });

  it('defaults to 256, 512 and 1024 and accepts an override', () => {
    expect(parseAnswerMaxTokens(undefined)).toEqual({ short: 256, standard: 512, detailed: 1024 });
    expect(parseAnswerMaxTokens('300, 600, 1200')).toEqual({ short: 300, standard: 600, detailed: 1200 });
  });

  it('rejects malformed values', () => {
    for (const bad of ['512', '256,512', '1,2,3', '256,abc,1024', '256,512,99999']) expect(() => parseAnswerMaxTokens(bad)).toThrow();
  });
});
