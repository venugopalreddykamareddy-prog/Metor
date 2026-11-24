import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSPHRASE } from '../playwright.config.ts';

// Headless Chromium has no speech service, so a fake SpeechRecognition stands in for the browser's.
// It records how Metor drives it, and tests push results through it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __recognitions: unknown[]; __streams: MediaStream[] };
    w.__recognitions = [];
    w.__streams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await original(c);
      w.__streams.push(s);
      return s;
    };
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      starts = 0;
      stops = 0;
      track: MediaStreamTrack | undefined;
      constructor() {
        w.__recognitions.push(this);
      }
      start(track?: MediaStreamTrack) {
        this.starts += 1;
        this.track = track;
      }
      stop() {
        this.stops += 1;
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {
        this.stop();
      }
      emit(text: string, isFinal: boolean) {
        const result = Object.assign([{ transcript: text }], { isFinal });
        this.onresult?.({ resultIndex: 0, results: Object.assign([result], {}) });
      }
      fail(error: string) {
        this.onerror?.({ error });
      }
      end() {
        this.onend?.();
      }
    }
    w.SpeechRecognition = FakeRecognition;
  });
});

type Fake = { starts: number; stops: number; track?: MediaStreamTrack; emit(t: string, f: boolean): void; fail(e: string): void; end(): void };
const fake = <T>(page: Page, fn: (r: Fake) => T) =>
  page.evaluate(`(${fn.toString()})(window.__recognitions.at(-1))`) as Promise<T>;

async function liveTrackCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length,
  );
}

async function startBrowserSpeech(page: Page) {
  await page.goto('/');
  await page.getByLabel('Passphrase').fill(E2E_PASSPHRASE);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByLabel('Transcription').selectOption('webspeech');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText("browser's speech service");
  await page.getByLabel('I understand and want to start recording').check();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByTestId('recording-indicator')).toContainText('REC');
}

const finals = (page: Page) => page.getByTestId('transcript').locator('li.final');

test('offers simulated and browser speech, but not Groq without a key', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Passphrase').fill(E2E_PASSPHRASE);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByLabel('Transcription').locator('option')).toHaveText(['Simulated', 'Browser speech']);
});

test('shows the words spoken, fixes technical terms, and survives browser restarts', async ({ page }) => {
  await startBrowserSpeech(page);
  await expect(page.getByTestId('audio-debug')).toContainText('nothing is sent to the Metor server');
  // Recognition runs on Metor's own mic track, so Stop really turns the mic off.
  expect(await fake(page, (r) => r.track?.kind === 'audio' && r.track.readyState === 'live')).toBe(true);
  expect(await fake(page, (r) => r.starts)).toBe(1);

  await fake(page, (r) => r.emit('run cube cuddle', false));
  await expect(page.getByTestId('partial')).toHaveText('run cube cuddle');
  await fake(page, (r) => r.emit('run cube cuddle get pods on a k s', true));
  await expect(finals(page)).toHaveText(['run kubectl get pods on AKS']);
  await expect(page.getByTestId('partial')).toHaveCount(0);

  // Chrome ends recognition after silence; Metor restarts it. A repeated final isn't shown twice.
  await fake(page, (r) => r.end());
  await expect.poll(() => fake(page, (r) => r.starts)).toBe(2);
  await fake(page, (r) => r.emit('Run kubectl get pods on AKS.', true));
  await fake(page, (r) => r.emit('check b g p peers', true));
  await expect(finals(page)).toHaveText(['run kubectl get pods on AKS', 'check BGP peers']);
  await expect(page.getByTestId('audio-debug')).toContainText('final latency p50');

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => fake(page, (r) => r.stops)).toBe(1);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => fake(page, (r) => r.starts)).toBe(3);

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByTestId('recording-indicator')).toBeHidden();
  expect(await liveTrackCount(page)).toBe(0);
  await expect(finals(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Clear transcript' }).click();
  await expect(finals(page)).toHaveCount(0);
});

test('a fatal speech error stops recording and releases the mic', async ({ page }) => {
  await startBrowserSpeech(page);
  await fake(page, (r) => r.fail('service-not-allowed'));
  await expect(page.getByRole('alert')).toContainText('Recording stopped');
  await expect(page.getByTestId('recording-indicator')).toBeHidden();
  expect(await liveTrackCount(page)).toBe(0);
});

test('keeps the newest line in view unless the user scrolls up', async ({ page }) => {
  await startBrowserSpeech(page);
  const scroller = page.getByTestId('transcript-scroll');
  const atBottom = () => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 5);
  for (let i = 0; i < 40; i++) await fake(page, (r) => r.emit(`line number ${Math.random()}`, true));
  await expect(finals(page)).toHaveCount(40);
  expect(await atBottom()).toBe(true);

  await scroller.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
  });
  await fake(page, (r) => r.emit('one more line', true));
  await expect(finals(page)).toHaveCount(41);
  expect(await atBottom()).toBe(false);
});

test('scores a transcript against the accuracy script', async ({ page }) => {
  await startBrowserSpeech(page);
  await fake(page, (r) =>
    r.emit('How would you define an SLO and an error budget for a payments API', true),
  );
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByText('Accuracy check').click();
  await page.getByLabel('Reference text').fill('How would you define an SLO and an error budget for a payments API?');
  await page.getByRole('button', { name: 'Score transcript' }).click();
  const row = page.getByTestId('accuracy-results').locator('tbody tr').first();
  await expect(row).toContainText('Browser speech');
  await expect(row).toContainText('0.0%');
  await expect(row).toContainText('2/2'); // SLO, error budget
});
