import { DEFAULT_PROFILE_ID, type Profile } from '../../../shared/profile.ts';
import type { KbItem } from '../../../shared/kb.ts';
import type { Store } from '../kb/db.ts';
import type { SavedSession } from '../session/history.ts';
import { correctionsKey } from '../session/corrections.ts';

/** A practice question in a profile's bank (editable; seeded from the role's drafted bank). */
export interface PracticeQuestion {
  id: string;
  profileId: string;
  category: 'technical' | 'behavioral' | 'scenario' | 'troubleshooting' | 'follow_up' | 'misleading' | 'made_up';
  text: string;
  /** What a good answer should notice, for misleading and made-up questions. */
  expect?: string;
  source: 'bank' | 'user';
}

export interface ProfileStores {
  profiles: Store<Profile>;
  kb: Store<KbItem>;
  sessions: Store<SavedSession>;
  questions: Store<PracticeQuestion>;
}

/**
 * Deletes a profile and everything it owns: its KB items, sessions, practice questions and
 * corrections. Items it shared stay with their owners; its id is removed from others' sharing.
 * The last remaining profile can't be deleted.
 */
export async function deleteProfile(stores: ProfileStores, id: string, storage: Pick<Storage, 'removeItem'> = localStorage): Promise<boolean> {
  const profiles = await stores.profiles.all();
  if (profiles.length <= 1 || !profiles.some((p) => p.id === id)) return false;
  for (const item of await stores.kb.all()) {
    if ((item.profileId ?? DEFAULT_PROFILE_ID) === id) await stores.kb.delete(item.id);
    else if (item.sharedWith?.includes(id)) await stores.kb.put({ ...item, sharedWith: item.sharedWith.filter((p) => p !== id) });
  }
  for (const s of await stores.sessions.all()) if ((s.profileId ?? DEFAULT_PROFILE_ID) === id) await stores.sessions.delete(s.id);
  for (const q of await stores.questions.all()) if (q.profileId === id) await stores.questions.delete(q.id);
  storage.removeItem(correctionsKey(id));
  storage.removeItem(`metor.practice.seeded.${id}`);
  await stores.profiles.delete(id);
  return true;
}

/** Shares or unshares one item with another profile; only the owner's item changes. */
export function setShared(item: KbItem, profileId: string, shared: boolean): KbItem {
  const others = (item.sharedWith ?? []).filter((p) => p !== profileId);
  if ((item.profileId ?? DEFAULT_PROFILE_ID) === profileId) return { ...item, sharedWith: others };
  return { ...item, sharedWith: shared ? [...others, profileId] : others, updatedAt: Date.now() };
}
