import { useState } from 'react';
import type { Replacement } from './cleanTranscript.ts';

import { DEFAULT_PROFILE_ID } from '../../../shared/profile.ts';

/** Per profile; the default profile keeps the pre-profile key, so existing corrections carry over. */
export const correctionsKey = (profileId: string) => (profileId === DEFAULT_PROFILE_ID ? 'metor.corrections' : `metor.corrections.${profileId}`);

function load(key: string): Replacement[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((r): r is Replacement => typeof r?.heard === 'string' && typeof r?.correct === 'string')
      : [];
  } catch {
    return [];
  }
}

/** The user's word corrections ("cloud flair" → "Cloudflare"), kept in this browser for future recordings. */
export function useCorrections(profileId: string) {
  const key = correctionsKey(profileId);
  const [state, setState] = useState(() => ({ key, replacements: load(key) }));
  // Switching profile loads that profile's corrections; none leak across.
  const replacements = state.key === key ? state.replacements : load(key);
  if (state.key !== key) setState({ key, replacements });

  const save = (next: Replacement[]) => {
    setState({ key, replacements: next });
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage blocked: corrections still apply until the tab closes.
    }
  };

  return {
    replacements,
    add: (heard: string, correct: string) => {
      const h = heard.trim();
      const c = correct.trim();
      if (!h || !c) return;
      save([...replacements.filter((r) => r.heard.toLowerCase() !== h.toLowerCase()), { heard: h, correct: c }]);
    },
    remove: (heard: string) => save(replacements.filter((r) => r.heard !== heard)),
  };
}
