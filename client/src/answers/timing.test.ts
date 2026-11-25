import { describe, expect, it } from 'vitest';
import { firstWordTiming } from './timing.ts';

describe('firstWordTiming', () => {
  it('times spoken questions from speech end', () => {
    expect(firstWordTiming({ origin: 'speech', spokenAt: 1000, sentAt: 1800, firstTextAt: 2500 })).toEqual({ label: 'speech end → first word', ms: 1500 });
  });

  it('times typed questions from submission, never speech end', () => {
    const t = firstWordTiming({ origin: 'typed', spokenAt: 0, sentAt: 5000, firstTextAt: 5600 });
    expect(t).toEqual({ label: 'submitted → first word', ms: 600 });
    expect(t.label).not.toContain('speech');
  });

  it('has no time before the first word', () => {
    expect(firstWordTiming({ origin: 'typed', spokenAt: 0, sentAt: 5000, firstTextAt: null }).ms).toBeNull();
  });
});
