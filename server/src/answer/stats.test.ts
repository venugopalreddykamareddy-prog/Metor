import { describe, expect, it } from 'vitest';
import { AnswerStats } from './stats.ts';

describe('AnswerStats', () => {
  it('averages only over answers that reported usage, and reasoning only where reported', () => {
    const s = new AnswerStats();
    s.record('groq-20b', { promptTokens: 800, completionTokens: 300, reasoningTokens: 100 }, false);
    s.record('groq-20b', { promptTokens: 1000, completionTokens: 500, reasoningTokens: null }, true);
    s.record('groq-20b', null, false);
    s.recordCached('groq-20b');
    expect(s.snapshot()['groq-20b']).toMatchObject({
      answers: 3,
      withUsage: 2,
      cached: 1,
      truncated: 1,
      totalTokens: 2600,
      averagePerAnswer: { prompt: 900, completion: 400, reasoning: 100, total: 1300 },
    });
  });
});
