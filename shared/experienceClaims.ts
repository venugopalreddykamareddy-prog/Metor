import { keywords } from './kb.ts';

// First-person claims of past experience ("I've built…", "at my last company…"). No verified resume
// or experience is loaded before Phase 5, so any such sentence in a suggested answer is made up.
// The UI warns when it appears and the evaluation counts it (hard rule 3). Explicit patterns only.

const PAST_VERBS =
  'built|designed|integrated|implemented|deployed|migrated|managed|ran|run|operated|led|configured|set up|setup|worked (?:on|with)|used|written|wrote|created|automated|handled|owned|scaled|maintained|debugged|troubleshot|introduced|rolled out|shipped|architected|developed|supported|monitored|tuned|optimized|optimised|reduced|cut|improved|delivered|launched';

const PATTERNS: RegExp[] = [
  // "I've built…", "I have integrated…", "we've migrated…"
  new RegExp(`\\b(?:I|we)(?:'ve| have)(?: \\w+ly)? (?:${PAST_VERBS})\\b`, 'i'),
  // "I built…", "I led…", "we migrated…" (plain past tense)
  new RegExp(`\\b(?:I|we) (?:\\w+ly )?(?:built|designed|integrated|implemented|deployed|migrated|managed|ran|operated|led|configured|set up|worked on|worked with|created|automated|handled|owned|scaled|maintained|rolled out|shipped|architected|developed|reduced|cut|improved|delivered|launched)\\b`, 'i'),
  /\b(?:at|in) my (?:last|previous|current|former) (?:company|job|role|team|employer|position)\b/i,
  /\bin my (?:experience|career|time at)\b/i,
  /\bwhen I (?:was at|worked at|joined|managed|ran|led|built)\b/i,
  /\byes,? I (?:have|did)\b/i,
  /\b\d+\+? years of (?:experience|hands-on)\b/i,
];

/**
 * Sentences that claim the candidate's own past experience. Hypotheticals ("I'd…", "I would…",
 * "say you have…") and statements about no verified experience don't count.
 */
export function findExperienceClaims(text: string): string[] {
  const sentences = text.replace(/’/g, "'").split(/(?<=[.!?])\s+/);
  return sentences.filter((s) => {
    if (/\b(?:no verified|isn't loaded|not loaded|hypothetical|for example, if I had|one way I'd)\b/i.test(s)) return false;
    return PATTERNS.some((p) => p.test(s));
  });
}

/**
 * Claims not backed by the verified KB excerpts sent with the question (Phase 5): a claim counts as
 * backed when it shares at least two keywords with one verified excerpt. A lexical check, so it
 * catches invented stories, not a wrong number inside a real one.
 */
export function unsupportedClaims(claims: readonly string[], verified: readonly string[]): string[] {
  const sets = verified.map((v) => new Set(keywords(v)));
  return claims.filter((c) => {
    const words = keywords(c);
    return !sets.some((set) => words.filter((w) => set.has(w)).length >= 2);
  });
}
