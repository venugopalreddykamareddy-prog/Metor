import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSPHRASE } from '../playwright.config.ts';

// Phase 6: interview profiles keep their knowledge base, answers and cache apart; sharing is
// explicit; deletion and migration from the Phase 5 database. Simulated providers only.

test.use({ viewport: { width: 1440, height: 900 } });

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
async function stopRecording(page: Page) {
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
}
async function ask(page: Page, text: string) {
  await page.getByLabel('Type a question').fill(text);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByTestId('answer').last()).toHaveClass(/status-done/);
}
async function addProfile(page: Page, role: string, name: string) {
  const bar = page.getByTestId('profile-bar');
  await bar.getByText('Edit profiles').click();
  await bar.getByLabel('New profile role').selectOption({ label: role });
  await bar.getByLabel('New profile name').fill(name);
  await bar.getByRole('button', { name: 'Add profile' }).click();
  await expect.poll(() => activeProfile(page)).toBe(name);
  await bar.getByText('Edit profiles').click();
}
const activeProfile = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLSelectElement>('[data-testid="profile-bar"] select')?.selectedOptions[0]?.textContent ?? '');
const selectProfile = (page: Page, name: string) => page.getByTestId('profile-bar').getByRole('combobox', { name: 'Profile', exact: true }).selectOption({ label: name });
async function addStory(page: Page, title: string, text: string) {
  const kb = page.getByTestId('kb');
  if (!(await kb.getByLabel('Title').isVisible())) await page.getByText(/Knowledge base and history/).click();
  await kb.getByLabel('Type').selectOption({ label: 'Experience story' });
  await kb.getByLabel('Title').fill(title);
  await kb.getByLabel('Content').fill(text);
  await kb.getByRole('button', { name: 'Add to knowledge base' }).click();
  await expect(kb.getByTestId('kb-list')).toContainText(title);
}

test('profiles keep knowledge base, answers and cache apart; sharing is explicit', async ({ page }) => {
  await login(page);
  await addStory(page, 'Checkout outage', 'A bad config push took checkout down for 20 minutes. I rolled back with Argo CD.');
  await addProfile(page, 'QA Engineer (manual)', 'QA');

  // QA can't see or use the SRE story.
  await expect(page.getByTestId('kb')).toContainText('(0 items)');
  await startRecording(page);
  await ask(page, 'Tell me about a time you handled a checkout outage');
  await expect(page.getByTestId('answer').last().getByTestId('answer-text')).toContainText('No verified experience is loaded for this');
  await stopRecording(page);

  // Back in the default profile: the QA answer isn't shown here, and the same question isn't served from QA's cache.
  await selectProfile(page, 'My profile');
  await expect(page.getByTestId('answer')).toHaveCount(0);
  await startRecording(page);
  await ask(page, 'Tell me about a time you handled a checkout outage');
  const sreAnswer = page.getByTestId('answer').last();
  await expect(sreAnswer.getByTestId('answer-text')).toContainText('From your verified story "Checkout outage"');
  await expect(sreAnswer).not.toContainText('reused from cache');
  await stopRecording(page);

  // Share the story with QA explicitly; QA sees it as shared and answers from it.
  await page.getByTestId('kb-list').getByRole('group', { name: 'Share Checkout outage with' }).getByLabel('QA').check();
  await selectProfile(page, 'QA');
  await expect(page.getByTestId('shared-from')).toHaveText('Shared from My profile');
  await startRecording(page);
  await ask(page, 'Tell me about a time you fixed a checkout outage');
  await expect(page.getByTestId('answer').last().getByTestId('answer-text')).toContainText('From your verified story "Checkout outage"');
  await stopRecording(page);

  // Unsharing from QA's side removes it there only.
  await page.getByTestId('kb-list').getByRole('button', { name: 'Remove from this profile' }).click();
  await expect(page.getByTestId('kb')).toContainText('(0 items)');
  await selectProfile(page, 'My profile');
  await expect(page.getByTestId('kb-list')).toContainText('Checkout outage');
});

test('the active profile and its settings persist; deleting a profile removes its data', async ({ page }) => {
  await login(page);
  await addProfile(page, 'Software Engineer', 'SWE');
  await addStory(page, 'Cache rewrite', 'Rewrote the cache layer.');
  await page.reload();
  await expect.poll(() => activeProfile(page)).toBe('SWE');
  await page.getByText(/Knowledge base and history/).click();
  await expect(page.getByTestId('kb-list')).toContainText('Cache rewrite');

  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('profile-bar').getByText('Edit profiles').click();
  await page.getByTestId('profile-bar').getByRole('button', { name: 'Delete profile' }).click();
  await expect(page.getByTestId('profile-bar').getByRole('combobox', { name: 'Profile', exact: true }).locator('option')).toHaveText(['My profile']);
  await expect(page.getByTestId('kb')).toContainText('(0 items)');
  const left = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('metor');
        req.onsuccess = () => {
          const c = req.result.transaction('kb').objectStore('kb').count();
          c.onsuccess = () => resolve(c.result);
        };
      }),
  );
  expect(left).toBe(0);
});

test('a Phase 5 (v1) database migrates into the default profile without losing anything', async ({ page }) => {
  await page.goto('/');
  // Build the v1 database Phase 5 wrote, before the app opens it.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const del = indexedDB.deleteDatabase('metor');
        del.onsuccess = () => {
          const req = indexedDB.open('metor', 1);
          req.onupgradeneeded = () => {
            req.result.createObjectStore('kb', { keyPath: 'id' });
            req.result.createObjectStore('sessions', { keyPath: 'id' });
          };
          req.onsuccess = () => {
            const tx = req.result.transaction(['kb', 'sessions'], 'readwrite');
            tx.objectStore('kb').put({ id: 'old', kind: 'story', provenance: 'verified', title: 'Legacy story', text: 'Old verified story.', active: true, updatedAt: 1 });
            tx.objectStore('sessions').put({ id: 's', startedAt: 1, savedAt: 1, expiresAt: Date.now() + 86_400_000, mode: 'Simulated', transcript: 'x', transcriptComplete: true, answers: [] });
            tx.oncomplete = () => {
              req.result.close();
              resolve();
            };
          };
        };
      }),
  );
  await login(page);
  await page.getByText(/Knowledge base and history/).click();
  await expect(page.getByTestId('kb-list')).toContainText('Legacy story');
  await expect(page.getByTestId('session-list')).toContainText('Simulated');
  const tagged = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open('metor');
        req.onsuccess = () => {
          const tx = req.result.transaction(['kb', 'sessions']);
          const a = tx.objectStore('kb').getAll();
          const b = tx.objectStore('sessions').getAll();
          tx.oncomplete = () => resolve([...a.result, ...b.result].map((r: { profileId?: string }) => r.profileId ?? 'none'));
        };
      }),
  );
  expect(tagged).toEqual(['default', 'default']);
});

test('practice: each profile has its own editable bank, and feedback is scored on request', async ({ page }) => {
  await login(page);
  const practice = page.getByTestId('practice');
  await page.getByText(/^Practice \(/).click();
  // The default (SRE) profile gets the drafted SRE bank.
  await practice.getByText('Edit question bank').click();
  await expect(practice.getByTestId('practice-bank')).toContainText('error budget');

  await addProfile(page, 'QA Automation Engineer', 'QA Auto');
  await expect(practice.getByTestId('practice-bank')).toContainText('Page Object Model');
  await expect(practice.getByTestId('practice-bank')).not.toContainText('error budget');
  await practice.getByLabel('New question', { exact: true }).fill('How do you test a file upload?');
  await practice.getByRole('button', { name: 'Add question' }).click();
  await expect(practice.getByTestId('practice-bank')).toContainText('How do you test a file upload?');

  // A made-up question, an answer, and simulated feedback with the four scores.
  await practice.getByLabel('Practice category').selectOption('made_up');
  await practice.getByRole('button', { name: 'Next question' }).click();
  await expect(practice.getByTestId('practice-question')).toContainText('Quantleaf');
  await practice.getByRole('button', { name: /what a good answer notices/ }).click();
  await expect(practice.getByTestId('practice-question')).toContainText('Not a known Cypress feature');
  await practice.getByLabel('Your answer').fill("I'm not familiar with Quantleaf retries. Could you tell me what they do?");
  await practice.getByRole('button', { name: 'Get feedback' }).click();
  await expect(practice.getByTestId('practice-scores')).toHaveText('Accuracy 3/5 · Relevance 4/5 · Communication 4/5 · Completeness 2/5');
  await expect(practice.getByTestId('practice-feedback')).toContainText('not AI feedback');
  await expect(practice.getByTestId('practice-weak')).toContainText('completeness 2');
  // Feedback doesn't land in the answers panel.
  await expect(page.getByTestId('answer')).toHaveCount(0);

  // The added question stays with QA Auto only, across a reload.
  await selectProfile(page, 'My profile');
  await expect(practice.getByTestId('practice-bank')).not.toContainText('file upload');
  await page.reload();
  await expect.poll(() => activeProfile(page)).toBe('My profile');
  await selectProfile(page, 'QA Auto');
  await page.getByText(/^Practice \(/).click();
  await practice.getByText('Edit question bank').click();
  await expect(practice.getByTestId('practice-bank')).toContainText('How do you test a file upload?');
});
