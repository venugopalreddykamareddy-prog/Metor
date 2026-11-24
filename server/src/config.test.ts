import { describe, expect, it } from 'vitest';
import { buildAllowedOrigins, loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('defaults to loopback:8787, non-production', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ host: '127.0.0.1', port: 8787, production: false });
  });

  it('reads PORT and NODE_ENV', () => {
    expect(loadConfig({ PORT: '9000', NODE_ENV: 'production' })).toMatchObject({ port: 9000, production: true });
  });

  it.each(['0', '70000', 'abc', '80.5'])('rejects invalid PORT %s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/Invalid PORT/);
  });
});

describe('buildAllowedOrigins', () => {
  it('includes local dev and own origins only by default', () => {
    expect([...buildAllowedOrigins({}, 8787)].sort()).toEqual([
      'http://127.0.0.1:5173', 'http://127.0.0.1:8787', 'http://localhost:5173', 'http://localhost:8787',
    ]);
  });

  it('adds Codespaces forwarded origins when running in a Codespace', () => {
    const origins = buildAllowedOrigins(
      { CODESPACE_NAME: 'my-cs', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' },
      8787,
    );
    expect(origins.has('https://my-cs-5173.app.github.dev')).toBe(true);
    expect(origins.has('https://my-cs-8787.app.github.dev')).toBe(true);
  });

  it('adds ALLOWED_ORIGINS entries, trimmed and without trailing slash', () => {
    const origins = buildAllowedOrigins({ ALLOWED_ORIGINS: ' https://a.example/ , ,https://b.example' }, 8787);
    expect(origins.has('https://a.example')).toBe(true);
    expect(origins.has('https://b.example')).toBe(true);
    expect(origins.has('')).toBe(false);
  });
});
