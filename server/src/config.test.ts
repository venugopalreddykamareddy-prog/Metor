import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassphrase } from './auth/passphrase.ts';
import { buildAllowedOrigins, loadConfig } from './config.ts';

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
