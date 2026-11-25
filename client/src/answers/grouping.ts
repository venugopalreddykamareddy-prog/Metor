import type { AnswerCard } from './useAnswers.ts';

// Answers are grouped by the question they answer. Regenerating or "Answer again" adds a version
// to the group instead of replacing anything, so earlier answers stay readable.

export interface AnswerGroup {
  sourceId: string;
  /** The latest wording of the question. */
  question: string;
  /** Oldest first. */
  versions: AnswerCard[];
  /** Set when the interviewer asked the same question again later (FR-E8). */
  askedAgainAt: number | null;
  /** Latest request or repeat; groups are ordered by it. */
  lastActivity: number;
}

export interface Repeat {
  sourceId: string;
  at: number;
}

export function groupAnswers(cards: AnswerCard[], repeats: Repeat[] = []): AnswerGroup[] {
  const groups = new Map<string, AnswerGroup>();
  for (const card of cards) {
    const group = groups.get(card.sourceId);
    if (group) {
      group.versions.push(card);
      group.question = card.question;
      group.lastActivity = Math.max(group.lastActivity, card.sentAt);
    } else {
      groups.set(card.sourceId, {
        sourceId: card.sourceId,
        question: card.question,
        versions: [card],
        askedAgainAt: null,
        lastActivity: card.sentAt,
      });
    }
  }
  for (const r of repeats) {
    const group = groups.get(r.sourceId);
    if (!group || r.at <= group.lastActivity) continue;
    group.askedAgainAt = r.at;
    group.lastActivity = r.at;
  }
  return [...groups.values()].sort((a, b) => a.lastActivity - b.lastActivity);
}

/** Finished answers for follow-up context: the newest version per question, oldest question first. */
export function contextTurns(cards: AnswerCard[], max: number, maxChars: number): { question: string; answer: string }[] {
  return groupAnswers(cards)
    .flatMap((g) => {
      const done = g.versions.filter((c) => c.status === 'done' && c.text).at(-1);
      return done ? [done] : [];
    })
    .slice(-max)
    .map((c) => ({ question: c.question.slice(0, 1000), answer: c.text.slice(0, maxChars) }));
}

/**
 * The rolling summary for older turns (ARCHITECTURE §5.5), built locally with no extra request:
 * the questions asked before the ones sent in full, newest kept, about 200 tokens at most.
 */
export function earlierTopics(cards: AnswerCard[], fullTurns: number, maxChars = 800): string[] {
  const asked = groupAnswers(cards)
    .filter((g) => g.versions.some((c) => c.status === 'done' && c.text))
    .map((g) => g.question.slice(0, 300));
  const older = asked.slice(0, Math.max(0, asked.length - fullTurns));
  const kept: string[] = [];
  let used = 0;
  for (const q of older.reverse()) {
    if (used + q.length > maxChars || kept.length >= 10) break;
    kept.unshift(q);
    used += q.length;
  }
  return kept;
}

// Words that point back at something said earlier ("how would you scale it?").
const BACK_REFERENCE = /\b(?:it|its|it's|that|this|those|these|they|them|their|instead|also|either|both|one|ones|former|latter)\b/i;
const CONTINUATION = /^(?:and|but|so|or|what about|how about|why not|what if|then|also|okay so)\b/i;

/**
 * Does this question need earlier turns to be understood? Follow-ups, continuations, back-references
 * and very short questions do; a self-contained question goes alone (fewer tokens per request).
 */
export function needsContext(question: string, isFollowUp: boolean): boolean {
  if (isFollowUp) return true;
  const text = question.trim();
  if (CONTINUATION.test(text)) return true;
  if (text.split(/\s+/).length <= 5) return true;
  return BACK_REFERENCE.test(text);
}
