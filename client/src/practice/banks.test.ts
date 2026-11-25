import { describe, expect, it } from 'vitest';
import { ROLES } from '../../../shared/profile.ts';
import { BANKS, parseScores, seedQuestions, weakestAreas } from './banks.ts';

describe('question banks', () => {
  it('cover every role; non-custom roles have every category, and every trick question says what to notice', () => {
    for (const role of ROLES) {
      expect(BANKS[role].length).toBeGreaterThan(3);
      if (role === 'custom') continue;
      const cats = new Set(BANKS[role].map((q) => q.category));
      for (const c of ['technical', 'behavioral', 'scenario', 'troubleshooting', 'follow_up', 'misleading', 'made_up']) expect(cats, `${role} ${c}`).toContain(c);
    }
    for (const q of Object.values(BANKS).flat()) if (q.category === 'misleading' || q.category === 'made_up') expect(q.expect).toBeTruthy();
  });

  it('seeds editable copies owned by one profile', () => {
    let n = 0;
    const qs = seedQuestions('sdet', 'p1', () => `q${n++}`);
    expect(qs.every((q) => q.profileId === 'p1' && q.source === 'bank')).toBe(true);
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
  });
});

describe('feedback scores', () => {
  it('parses the SCORES line and finds the weakest areas', () => {
    const s = parseScores('SCORES: accuracy=2 relevance=4 communication=5 completeness=3\nAccuracy: ...');
    expect(s).toEqual({ accuracy: 2, relevance: 4, communication: 5, completeness: 3 });
    expect(parseScores('no scores here')).toBeNull();
    expect(parseScores('SCORES: accuracy=9 relevance=4 communication=5 completeness=3')).toBeNull();
    expect(weakestAreas([s!, { accuracy: 4, relevance: 4, communication: 3, completeness: 3 }])[0]).toEqual({ area: 'accuracy', average: 3 });
  });
});
