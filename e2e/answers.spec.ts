import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSPHRASE } from '../playwright.config.ts';

// Phase 4 browser tests: questions → answers with the simulated engine (no provider calls in CI),
// answer versions, copy, layout, collapsing, focus mode and display settings.

test.use({ viewport: { width: 1440, height: 900 } });

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

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Passphrase').fill(E2E_PASSPHRASE);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByTestId('connection-status')).toHaveText('Connected');
}

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Start recording?' });
  await dialog.getByLabel('I understand and want to start recording').check();
  await dialog.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByTestId('recording-indicator')).toContainText('REC');
}

async function ask(page: Page, text: string) {
  await page.getByLabel('Type a question').fill(text);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
}

const liveTracks = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length,
  );
const answers = (page: Page) => page.getByTestId('answer');
const widthOf = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())?.width ?? 0;

test('a spoken question is extracted and answered, and the answer is labeled as simulated', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('engine-note')).toHaveText(/not AI output/);
  await startRecording(page);

  const question = page.getByTestId('questions').locator('li').first();
  await expect(question).toContainText('define an SLO for a payments API', { timeout: 20_000 });
  const card = answers(page).first();
  await expect(card.getByTestId('answer-text')).toContainText('That is the short version', { timeout: 20_000 });
  await expect(card.getByTestId('answer-source')).toHaveText('Simulated · not AI');
  await expect(card).toHaveClass(/simulated/);
  await expect(card.getByTestId('answer-text')).toContainText('[Simulated placeholder, not an AI answer.]');

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByTestId('recording-indicator')).toBeHidden();
  expect(await liveTracks(page)).toBe(0);
});

test('regenerating keeps the earlier answer as a version, and copy puts the answer on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await ask(page, 'How does DNS resolution work?');
  const card = answers(page).first();
  await expect(card.getByRole('button', { name: 'Regenerate' })).toBeVisible(); // shown once streaming ends
  const first = await card.getByTestId('answer-text').innerText();
  expect(first).toContain('That is the short version');

  await card.getByRole('button', { name: 'Regenerate' }).click();
  await expect(card.getByTestId('answer-version')).toHaveText('Version 2 of 2');
  await expect(answers(page)).toHaveCount(1); // same question, one entry
  await expect(card.getByRole('button', { name: 'Regenerate' })).toBeVisible();

  await card.getByRole('button', { name: 'Previous version' }).click();
  await expect(card.getByTestId('answer-version')).toHaveText('Version 1 of 2');
  await expect(card.getByTestId('answer-text')).toHaveText(first);

  await card.getByRole('button', { name: 'Copy answer' }).click();
  await expect(card.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);
});

test('a new question stops the answer in flight but keeps its text', async ({ page }) => {
  await login(page);
  await ask(page, 'What is a Kubernetes readiness probe?');
  await expect(answers(page).first().getByTestId('answer-text')).toContainText('Sure');
  await ask(page, 'How does TCP slow start work?');

  const first = answers(page).first();
  await expect(first.getByText('Stopped early: Replaced by a newer question.')).toBeVisible();
  await expect(first.getByTestId('answer-text')).toContainText('Sure');
  await expect(answers(page).nth(1).getByTestId('answer-text')).toContainText('That is the short version');
});

test('the answers panel starts at about 55% and the dividers resize the panels', async ({ page }) => {
  await login(page);
  const total = await widthOf(page, 'workspace');
  const answersWidth = await widthOf(page, 'answers-column');
  // 55% of the space left after the two 0.5rem dividers and gaps.
  expect(answersWidth / total).toBeGreaterThan(0.5);
  expect(answersWidth / total).toBeLessThan(0.58);

  const divider = page.getByTestId('divider-1');
  const box = await divider.boundingBox();
  if (!box) throw new Error('divider not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + 50, { steps: 5 });
  await page.mouse.up();
  const wider = await widthOf(page, 'answers-column');
  expect(wider).toBeGreaterThan(answersWidth + 100);

  // Keyboard: arrow keys move the divider; Home restores the default.
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  expect(await widthOf(page, 'answers-column')).toBeLessThan(wider);
  await page.keyboard.press('Home');
  expect(Math.abs((await widthOf(page, 'answers-column')) - answersWidth)).toBeLessThan(2);

  // The layout is remembered after a reload.
  await page.keyboard.press('ArrowLeft');
  const before = await widthOf(page, 'answers-column');
  await page.reload();
  await expect(page.getByTestId('connection-status')).toHaveText('Connected');
  expect(Math.abs((await widthOf(page, 'answers-column')) - before)).toBeLessThan(2);
});

test('transcript and questions collapse to rails and expand again while the indicator stays visible', async ({ page }) => {
  await login(page);
  await startRecording(page);
  const before = await widthOf(page, 'answers-column');

  await page.getByRole('button', { name: 'Hide transcript' }).click();
  await page.getByRole('button', { name: 'Hide questions' }).click();
  await expect(page.getByRole('region', { name: 'Transcript', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Detected questions' })).toHaveCount(0);
  expect(await widthOf(page, 'answers-column')).toBeGreaterThan(before + 200);
  await expect(page.getByTestId('recording-indicator')).toBeVisible();

  await page.getByRole('button', { name: 'Show transcript' }).click();
  await page.getByRole('button', { name: 'Show questions' }).click();
  await expect(page.getByTestId('transcript-scroll')).toBeVisible();
  await expect(page.getByTestId('questions')).toBeAttached();

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(await liveTracks(page)).toBe(0);
});

test('focus mode shows only the latest question and answer, with the indicator still on screen', async ({ page }) => {
  await login(page);
  await ask(page, 'What is an error budget?');
  await expect(answers(page).first().getByTestId('answer-text')).toContainText('That is the short version');
  await ask(page, 'How do you alert on burn rate?');
  await expect(answers(page).nth(1).getByTestId('answer-text')).toContainText('That is the short version');

  await startRecording(page);
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  const focus = page.getByTestId('focus-view');
  await expect(focus.getByTestId('answer')).toHaveCount(1);
  await expect(focus.getByTestId('answer')).toContainText('How do you alert on burn rate?');
  await expect(page.getByTestId('workspace')).toBeHidden();
  await expect(page.getByTestId('recording-indicator')).toBeVisible();

  // Text size and line spacing apply in focus mode and are remembered.
  await focus.getByLabel('Text size').selectOption('28');
  await focus.getByLabel('Line spacing').selectOption('2');
  const style = await focus.getByTestId('answer-text').evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).lineHeight]);
  expect(style).toEqual(['28px', '56px']);

  await page.keyboard.press('Escape');
  await expect(focus).toBeHidden();
  await expect(page.getByTestId('workspace')).toBeVisible();
  const panelSize = await answers(page).first().getByTestId('answer-text').evaluate((el) => getComputedStyle(el).fontSize);
  expect(panelSize).toBe('28px');

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(await liveTracks(page)).toBe(0);
});
