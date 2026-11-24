import { defineConfig, devices } from '@playwright/test';
import { hashPassphrase } from './server/src/auth/passphrase.ts';

// Not 8787, so tests can run while `pnpm dev` is up.
const PORT = 8788;
const BASE_URL = `http://127.0.0.1:${PORT}`;
export const E2E_PASSPHRASE = 'e2e passphrase for tests';

// Tests run against the production build (`pnpm build` first).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Fake mic (a test tone) and auto-accept the permission prompt.
        launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
      },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORT), APP_PASSPHRASE_HASH: await hashPassphrase(E2E_PASSPHRASE) },
  },
});
