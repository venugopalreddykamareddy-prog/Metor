import { describe, expect, it } from 'vitest';
import { contextTurns, earlierTopics, groupAnswers, needsContext } from './grouping.ts';
import type { AnswerCard } from './useAnswers.ts';

function card(questionId: string, sourceId: string, sentAt: number, extra: Partial<AnswerCard> = {}): AnswerCard {
  return {
    questionId,
    sourceId,
    question: `Question ${sourceId}?`,
    engine: 'simulated',
    length: 'standard',
    status: 'done',
    header: null,
    text: `Answer ${questionId}`,
    error: null,
    model: 'simulated',
    origin: 'speech',
    context: { statements: [], turns: [], earlier: [], isFollowUp: false },
    spokenAt: sentAt,
    sentAt,
    firstTextAt: null,
    serverFirstTokenMs: null,
    totalMs: null,
    usage: null,
    truncated: false,
    cached: false,
    ...extra,
  };
}

describe('groupAnswers', () => {
  it('keeps every version of a regenerated answer, oldest first', () => {
    const groups = groupAnswers([card('a1', 'q1', 1), card('b1', 'q2', 2), card('a2', 'q1', 3)]);
    expect(groups.map((g) => g.sourceId)).toEqual(['q2', 'q1']);
    expect(groups[1]?.versions.map((v) => v.questionId)).toEqual(['a1', 'a2']);
  });

  it('keeps a cancelled answer next to its replacement', () => {
    const groups = groupAnswers([card('a1', 'q1', 1, { status: 'cancelled', text: 'Partial' }), card('a2', 'q1', 2)]);
    expect(groups[0]?.versions.map((v) => [v.status, v.text])).toEqual([
      ['cancelled', 'Partial'],
      ['done', 'Answer a2'],
    ]);
  });

  it('moves a question asked again to the end without a new request', () => {
    const groups = groupAnswers([card('a1', 'q1', 1), card('b1', 'q2', 2)], [{ sourceId: 'q1', at: 5 }]);
    expect(groups.map((g) => [g.sourceId, g.askedAgainAt, g.versions.length])).toEqual([
      ['q2', null, 1],
      ['q1', 5, 1],
    ]);
  });

  it('ignores repeats older than the latest answer', () => {
    const groups = groupAnswers([card('a1', 'q1', 10)], [{ sourceId: 'q1', at: 5 }]);
    expect(groups[0]?.askedAgainAt).toBeNull();
  });
});

describe('contextTurns', () => {
  it('uses the newest finished version per question', () => {
    const cards = [card('a1', 'q1', 1), card('b1', 'q2', 2), card('a2', 'q1', 3), card('c1', 'q3', 4, { status: 'streaming' })];
    expect(contextTurns(cards, 3, 1000)).toEqual([
      { question: 'Question q2?', answer: 'Answer b1' },
      { question: 'Question q1?', answer: 'Answer a2' },
    ]);
  });

  it('limits the number of turns and the answer length', () => {
    const cards = [card('a', 'q1', 1), card('b', 'q2', 2), card('c', 'q3', 3)];
    expect(contextTurns(cards, 2, 4)).toEqual([
      { question: 'Question q2?', answer: 'Answ' },
      { question: 'Question q3?', answer: 'Answ' },
    ]);
  });
});

describe('earlierTopics', () => {
  it('lists questions older than the full turns, newest kept within the budget', () => {
    const cards = ['q1', 'q2', 'q3', 'q4', 'q5'].map((id, i) => card(`a${i}`, id, i));
    expect(earlierTopics(cards, 3)).toEqual(['Question q1?', 'Question q2?']);
    expect(earlierTopics(cards, 3, 15)).toEqual(['Question q2?']);
    expect(earlierTopics(cards.slice(0, 3), 3)).toEqual([]);
  });

  it('skips questions with no finished answer', () => {
    const cards = [card('a', 'q1', 1, { status: 'cancelled' }), card('b', 'q2', 2), card('c', 'q3', 3), card('d', 'q4', 4), card('e', 'q5', 5)];
    expect(earlierTopics(cards, 3)).toEqual(['Question q2?']);
  });
});

describe('needsContext', () => {
  it.each([
    ['How would you scale it?', false],
    ['And what if two paths have the same local preference?', false],
    ['Which one would you use for a slow-starting Java app?', false],
    ['Why not?', false],
    ['What about OSPF?', false],
    ['Anything else?', false],
  ])('sends context for "%s"', (q, followUp) => {
    expect(needsContext(q, followUp)).toBe(true);
  });

  it.each([
    'How does BGP choose the best path between multiple routes to the same prefix?',
    'What is the difference between an SLI, an SLO, and an SLA?',
    'How would you troubleshoot high CPU usage on a Linux server?',
  ])('sends a self-contained question alone: %s', (q) => {
    expect(needsContext(q, false)).toBe(false);
  });
});
