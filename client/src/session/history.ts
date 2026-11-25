import type { AnswerCard } from '../answers/useAnswers.ts';
import type { Store } from '../kb/db.ts';

// Opt-in session history (FR-S1b, FR-S4): off by default; when on, each recording is saved on Stop
// with an expiry, expired sessions are purged on startup, and each one can be exported or deleted.
// Raw audio is never stored (hard rule 7).

export const RETENTION_DAYS = ['7', '30', '90'] as const;
export type RetentionDays = (typeof RETENTION_DAYS)[number];
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SavedSession {
  id: string;
  startedAt: number;
  savedAt: number;
  expiresAt: number;
  mode: string;
  /** The clean transcript text; the raw recognizer text isn't kept. */
  transcript: string;
  /** False when a new recording started before the last transcription arrived. */
  transcriptComplete: boolean;
  answers: SavedAnswer[];
}

export interface SavedAnswer {
  question: string;
  /** The text shown, possibly partial. */
  answer: string;
  engine: string;
  /** done, or why it's incomplete: still streaming or waiting, stopped early, or failed. */
  status: 'done' | 'pending' | 'stopped' | 'failed';
}

/** This recording's answers, finished or not; unfinished ones keep their text and say so. */
export function sessionAnswers(cards: readonly AnswerCard[], startedAt: number): SavedAnswer[] {
  const status = { done: 'done', streaming: 'pending', cancelled: 'stopped', failed: 'failed' } as const;
  return cards
    .filter((c) => c.sentAt >= startedAt)
    .map((c) => ({ question: c.question, answer: c.text, engine: c.engine, status: status[c.status] }));
}

export interface HistorySettings {
  persist: boolean;
  retentionDays: RetentionDays;
}

/** Saves a finished recording when the user opted in; with persistence off nothing is written. */
export async function saveSession(
  store: Store<SavedSession>,
  settings: HistorySettings,
  data: Omit<SavedSession, 'savedAt' | 'expiresAt'>,
  now: number,
): Promise<boolean> {
  if (!settings.persist) return false;
  if (!data.transcript.trim() && data.answers.length === 0) return false;
  await store.put({ ...data, savedAt: now, expiresAt: now + Number(settings.retentionDays) * DAY_MS });
  return true;
}

/** Deletes expired sessions; run on startup. Returns the sessions that are kept, newest first. */
export async function purgeExpired(store: Store<SavedSession>, now: number): Promise<SavedSession[]> {
  const all = await store.all();
  const kept: SavedSession[] = [];
  for (const s of all) {
    if (s.expiresAt <= now) await store.delete(s.id);
    else kept.push(s);
  }
  return kept.sort((a, b) => b.savedAt - a.savedAt);
}

/** A file the user can save: everything Metor keeps locally (FR-K6, FR-S4). */
export function exportJson(data: { kb: unknown[]; sessions: SavedSession[] }, now: number): string {
  return JSON.stringify({ exportedAt: new Date(now).toISOString(), app: 'metor', ...data }, null, 2);
}
