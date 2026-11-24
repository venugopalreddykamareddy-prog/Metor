import { useState } from 'react';
import type { Replacement } from './cleanTranscript.ts';

const KEY = 'metor.corrections';

function load(): Replacement[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((r): r is Replacement => typeof r?.heard === 'string' && typeof r?.correct === 'string')
      : [];
  } catch {
    return [];
  }
}

/** The user's word corrections ("cloud flair" → "Cloudflare"), kept in this browser for future recordings. */
export function useCorrections() {
  const [replacements, setReplacements] = useState<Replacement[]>(load);

  const save = (next: Replacement[]) => {
    setReplacements(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
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
