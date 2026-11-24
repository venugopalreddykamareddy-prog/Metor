import { expect, test } from '@playwright/test';

test('loads the built app, connects over WebSocket, and echoes a message', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Metor');
  await expect(page.getByTestId('connection-status')).toHaveText('Connected');

  await page.getByLabel('Message', { exact: true }).fill('hello from playwright');
  await page.getByRole('button', { name: 'Send' }).click();

  const log = page.getByTestId('message-log');
  await expect(log.locator('li.log-sent')).toContainText('hello from playwright');
  await expect(log.locator('li.log-echo')).toContainText('hello from playwright');
  expect(errors).toEqual([]);
});

test('healthz responds ok', async ({ request }) => {
  const res = await request.get('/healthz');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ status: 'ok' });
});
