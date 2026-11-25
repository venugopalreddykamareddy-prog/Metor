import { describe, expect, it } from 'vitest';
import { retrieve, visibleTo, type KbItem } from '../../../shared/kb.ts';
import { DEFAULT_PROFILE_ID, newProfile, type Profile } from '../../../shared/profile.ts';
import { memoryStore } from '../kb/db.ts';
import type { SavedSession } from '../session/history.ts';
import { deleteProfile, setShared, type PracticeQuestion } from './profiles.ts';

const item = (id: string, profileId: string | undefined, text: string, extra: Partial<KbItem> = {}): KbItem => ({
  id,
  kind: 'resume',
  provenance: 'verified',
  title: id,
  text,
  active: true,
  updatedAt: 0,
  ...(profileId ? { profileId } : {}),
  ...extra,
});

describe('profile isolation', () => {
  const sre = item('sre-resume', 'sre', 'Ran 40 AKS clusters and Terraform modules.');
  const qa = item('qa-resume', 'qa', 'Built a Selenium and Playwright framework.');
  const legacy = item('old', undefined, 'Pre-profile resume with Kubernetes.');
  const all = [sre, qa, legacy];

  it('a profile sees only its own items; pre-profile items belong to the default profile', () => {
    expect(all.filter((i) => visibleTo(i, 'qa')).map((i) => i.id)).toEqual(['qa-resume']);
    expect(all.filter((i) => visibleTo(i, DEFAULT_PROFILE_ID)).map((i) => i.id)).toEqual(['old']);
    expect(retrieve(all.filter((i) => visibleTo(i, 'qa')), 'Tell me about AKS and Terraform')).toEqual([]);
  });

  it('sharing is explicit, per item, and can be undone', () => {
    const shared = setShared(sre, 'qa', true);
    expect(visibleTo(shared, 'qa')).toBe(true);
    expect(visibleTo(sre, 'qa')).toBe(false); // the original isn't touched
    expect(visibleTo(setShared(shared, 'qa', false), 'qa')).toBe(false);
    expect(setShared(sre, 'sre', true).sharedWith).toEqual([]); // the owner can't be a share target
  });
});

describe('deleteProfile', () => {
  async function setup() {
    const profiles = memoryStore<Profile>([newProfile('sre', 'SRE', 'sre', 0), newProfile('qa_manual', 'QA', 'qa', 1)]);
    const kb = memoryStore<KbItem>([item('a', 'qa', 'qa text'), item('b', 'sre', 'sre text', { sharedWith: ['qa'] })]);
    const sessions = memoryStore<SavedSession>([{ id: 's1', profileId: 'qa' } as SavedSession, { id: 's2', profileId: 'sre' } as SavedSession]);
    const questions = memoryStore<PracticeQuestion>([{ id: 'q1', profileId: 'qa', category: 'technical', text: 'x', source: 'bank' }]);
    const removed: string[] = [];
    return { stores: { profiles, kb, sessions, questions }, storage: { removeItem: (k: string) => void removed.push(k) }, removed };
  }

  it("removes the profile's own data, unshares others' items, and keeps the rest", async () => {
    const { stores, storage, removed } = await setup();
    expect(await deleteProfile(stores, 'qa', storage)).toBe(true);
    expect((await stores.profiles.all()).map((p) => p.id)).toEqual(['sre']);
    expect(await stores.kb.all()).toEqual([expect.objectContaining({ id: 'b', sharedWith: [] })]);
    expect((await stores.sessions.all()).map((s) => s.id)).toEqual(['s2']);
    expect(await stores.questions.all()).toEqual([]);
    expect(removed).toEqual(['metor.corrections.qa', 'metor.practice.seeded.qa']);
  });

  it('refuses to delete the last profile', async () => {
    const { stores, storage } = await setup();
    await deleteProfile(stores, 'qa', storage);
    expect(await deleteProfile(stores, 'sre', storage)).toBe(false);
  });
});
