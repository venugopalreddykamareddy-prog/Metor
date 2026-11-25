import type { AnswerCard } from './useAnswers.ts';

/**
 * Time to the first answer word, measured from where the question really started: speech end for
 * a spoken question, submission for a typed question, a merge or a regeneration (no speech to time).
 */
export function firstWordTiming(card: Pick<AnswerCard, 'origin' | 'spokenAt' | 'sentAt' | 'firstTextAt'>): {
  label: string;
  ms: number | null;
} {
  const spoken = card.origin === 'speech';
  const from = spoken ? card.spokenAt : card.sentAt;
  return {
    label: spoken ? 'speech end → first word' : 'submitted → first word',
    ms: card.firstTextAt === null ? null : card.firstTextAt - from,
  };
}
