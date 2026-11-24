import { describe, expect, it } from 'vitest';
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, backoffDelay } from './backoff.ts';

describe('backoffDelay', () => {
  it('doubles the ceiling each attempt and caps at 8 s', () => {
    const ceilings = [0, 1, 2, 3, 4, 5, 10, 100].map((a) => backoffDelay(a, () => 0.999999));
    expect(ceilings).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000, 8000]);
  });

  it('jitters between 50% and 100% of the ceiling', () => {
    expect(backoffDelay(0, () => 0)).toBe(BACKOFF_BASE_MS / 2);
    expect(backoffDelay(4, () => 0)).toBe(BACKOFF_MAX_MS / 2);
    expect(backoffDelay(2, () => 0.5)).toBe(1500);
  });

  it('stays within bounds for random input', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      for (let i = 0; i < 50; i++) {
        const d = backoffDelay(attempt);
        expect(d).toBeGreaterThanOrEqual(BACKOFF_BASE_MS / 2);
        expect(d).toBeLessThanOrEqual(BACKOFF_MAX_MS);
      }
    }
  });

  it('treats negative, fractional, and huge attempts safely', () => {
    expect(backoffDelay(-3, () => 0.999999)).toBe(500);
    expect(backoffDelay(1.7, () => 0.999999)).toBe(1000);
    expect(backoffDelay(Number.MAX_SAFE_INTEGER, () => 0.999999)).toBe(8000);
  });

  it('clamps out-of-range random values', () => {
    expect(backoffDelay(0, () => 5)).toBe(500);
    expect(backoffDelay(0, () => -1)).toBe(250);
  });
});
