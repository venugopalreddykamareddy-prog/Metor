import { describe, expect, it } from 'vitest';
import { memoryStore } from '../kb/db.ts';
import { exportJson, purgeExpired, saveSession, type SavedSession } from './history.ts';

const DAY = 24 * 60 * 60 * 1000;
const data = { id: 's1', startedAt: 0, mode: 'Groq Whisper', transcript: 'How does BGP choose a path?', answers: [{ question: 'How does BGP choose a path?', answer: 'So…', engine: 'groq-120b' }] };

describe('saveSession', () => {
  it('writes nothing with persistence off (the default)', async () => {
    const store = memoryStore<SavedSession>();
    expect(await saveSession(store, { persist: false, retentionDays: '30' }, data, 1000)).toBe(false);
    expect(store.writes).toBe(0);
    expect(await store.all()).toEqual([]);
  });

  it('saves with an expiry when opted in, and skips empty recordings', async () => {
    const store = memoryStore<SavedSession>();
    expect(await saveSession(store, { persist: true, retentionDays: '7' }, data, 1000)).toBe(true);
    expect((await store.all())[0]?.expiresAt).toBe(1000 + 7 * DAY);
    expect(await saveSession(store, { persist: true, retentionDays: '7' }, { ...data, id: 's2', transcript: ' ', answers: [] }, 1000)).toBe(false);
  });
});

describe('purgeExpired', () => {
  it('deletes expired sessions on startup (mocked clock) and keeps the rest, newest first', async () => {
    const store = memoryStore<SavedSession>();
    await saveSession(store, { persist: true, retentionDays: '7' }, { ...data, id: 'old' }, 0);
    await saveSession(store, { persist: true, retentionDays: '90' }, { ...data, id: 'kept' }, 0);
    await saveSession(store, { persist: true, retentionDays: '30' }, { ...data, id: 'new' }, DAY);
    const kept = await purgeExpired(store, 8 * DAY);
    expect(kept.map((s) => s.id)).toEqual(['new', 'kept']);
    expect((await store.all()).map((s) => s.id).sort()).toEqual(['kept', 'new']);
  });
});

describe('exportJson', () => {
  it('includes the KB and sessions', () => {
    const out = JSON.parse(exportJson({ kb: [{ id: 'k' }], sessions: [] }, 0)) as { app: string; kb: unknown[] };
    expect(out.app).toBe('metor');
    expect(out.kb).toHaveLength(1);
  });
});
