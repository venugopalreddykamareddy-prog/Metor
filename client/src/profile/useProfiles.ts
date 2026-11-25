import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PROFILE_ID, newProfile, type Profile } from '../../../shared/profile.ts';
import { idbStore } from '../kb/db.ts';
import { load, save } from '../settings.ts';

export const profileStore = idbStore<Profile>('profiles');
const fallback = newProfile('sre', 'My profile', DEFAULT_PROFILE_ID, 0);

/** Interview profiles in this browser; the first visit creates the default (SRE) profile. */
export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState(() => load('activeProfile') ?? DEFAULT_PROFILE_ID);

  const reload = useCallback(async () => {
    let all = await profileStore.all();
    if (all.length === 0) {
      const first = { ...fallback, createdAt: Date.now() };
      await profileStore.put(first);
      all = [first];
    }
    setProfiles(all.sort((a, b) => a.createdAt - b.createdAt));
    return all;
  }, []);
  useEffect(() => {
    void reload().catch(() => setProfiles([fallback]));
  }, [reload]);

  const select = useCallback((id: string) => {
    setActiveId(id);
    save('activeProfile', id);
  }, []);
  const saveProfile = useCallback(
    async (p: Profile) => {
      await profileStore.put(p);
      await reload();
    },
    [reload],
  );

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0] ?? fallback;
  return { profiles, active, select, saveProfile, reload };
}
