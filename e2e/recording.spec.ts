import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSPHRASE } from '../playwright.config.ts';

// Record every stream the app opens so tests can check the mic was really released.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __streams: MediaStream[] };
    w.__streams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      w.__streams.push(stream);
      return stream;
    };
  });
});

async function liveTrackCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __streams: MediaStream[] }).__streams
      .flatMap((s) => s.getTracks())
      .filter((t) => t.readyState === 'live').length,
  );
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Passphrase').fill(E2E_PASSPHRASE);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByTestId('connection-status')).toHaveText('Connected');
}

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Start recording?' });
  await expect(dialog.getByRole('button', { name: 'Start recording' })).toBeDisabled();
  await dialog.getByLabel('I understand and want to start recording').check();
  await dialog.getByRole('button', { name: 'Start recording' }).click();
  await expect(indicator(page)).toContainText('REC');
}

const indicator = (page: Page) => page.getByTestId('recording-indicator');
const firstFinal = (page: Page) => page.getByTestId('transcript').locator('li.final').first();

test('healthz responds ok', async ({ request }) => {
  expect(await (await request.get('/healthz')).json()).toEqual({ status: 'ok' });
});

test('requires login and rejects a wrong passphrase', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Metor');
  await page.getByLabel('Passphrase').fill('wrong passphrase');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong passphrase.');
  await login(page);
});

test('start, pause, resume and stop with simulated transcript', async ({ page }) => {
  await login(page);
  await startRecording(page);
  await expect(indicator(page)).toContainText(/REC 00:0\d/);
  await expect(page.getByTestId('partial')).toContainText('Can you');
  // Chromium's fake mic plays a tone, so the server should see about 10 frames/s with a real level.
  await expect(page.getByTestId('audio-debug')).toHaveText(/Server received: (9|10|11) frames\/s · 3\d\.\d KB\/s · level -\d{1,2} dB/);

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(indicator(page)).toContainText('Paused, mic still open');
  // No audio while paused, so the server finalizes the partial after a second.
  await expect(firstFinal(page)).toContainText(/^Can you/);
  expect(await liveTrackCount(page)).toBe(1);

  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(indicator(page)).toContainText('REC');
  await expect(page.getByTestId('partial')).toContainText('What');

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(indicator(page)).toBeHidden();
  expect(await liveTrackCount(page)).toBe(0);
  await expect(firstFinal(page)).toBeVisible(); // transcript is kept after stop
});

test('shows an error and stays idle when mic permission is denied', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await login(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel('I understand and want to start recording').check();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('alert')).toContainText('Microphone permission was denied');
  await expect(indicator(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
});

test('logging out while recording releases the mic', async ({ page }) => {
  await login(page);
  await startRecording(page);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByLabel('Passphrase')).toBeVisible();
  expect(await liveTrackCount(page)).toBe(0);
});

test('reconnects mid-recording and keeps going', async ({ page }) => {
  let dropConnection = () => {};
  await page.routeWebSocket('/ws', (ws) => {
    ws.connectToServer();
    dropConnection = () => void ws.close({ code: 1011, reason: 'test drop' });
  });
  await login(page);
  await startRecording(page);
  await expect(page.getByTestId('partial')).toBeVisible();

  dropConnection();
  await expect(indicator(page)).toContainText('Reconnecting, mic on');
  await expect(indicator(page)).not.toContainText('Reconnecting', { timeout: 10_000 });
  await expect(firstFinal(page)).toBeVisible({ timeout: 10_000 });
  expect(await liveTrackCount(page)).toBe(1);
});

test('server ending the login (4401) releases the mic and shows login', async ({ page }) => {
  let endLogin = () => {};
  await page.routeWebSocket('/ws', (ws) => {
    ws.connectToServer();
    endLogin = () => void ws.close({ code: 4401, reason: 'auth ended' });
  });
  await login(page);
  await startRecording(page);
  endLogin();
  await expect(page.getByLabel('Passphrase')).toBeVisible();
  expect(await liveTrackCount(page)).toBe(0);
});

test('a failed resume stops recording and keeps the transcript', async ({ page }) => {
  let connections = 0;
  let dropConnection = () => {};
  await page.routeWebSocket('/ws', (ws) => {
    connections += 1;
    if (connections === 1) {
      ws.connectToServer();
      dropConnection = () => void ws.close({ code: 1011, reason: 'test drop' });
      return;
    }
    // Later connections answer the resume as if the 30 s grace period had passed.
    ws.onMessage((message) => {
      if (typeof message === 'string' && message.includes('"session.resume"')) {
        ws.send(JSON.stringify({ type: 'error', id: 'e1', ts: Date.now(), code: 'session_expired', message: 'gone', retryable: false }));
      }
    });
  });
  await login(page);
  await startRecording(page);
  await expect(page.getByTestId('partial')).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(firstFinal(page)).toBeVisible();

  dropConnection();
  await expect(page.getByRole('alert')).toContainText('recording stopped');
  await expect(indicator(page)).toBeHidden();
  expect(await liveTrackCount(page)).toBe(0);
  await expect(firstFinal(page)).toBeVisible();
});
