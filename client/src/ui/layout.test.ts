import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, MIN_PERCENT, dividerNeighbours, gridColumns, moveDivider, parseLayout } from './layout.ts';

describe('workspace layout', () => {
  it('gives the answers panel about 55% by default', () => {
    expect(DEFAULT_LAYOUT.widths[2]).toBe(55);
    expect(DEFAULT_LAYOUT.widths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('moves a divider between its two neighbours only', () => {
    expect(moveDivider([25, 20, 55], 1, 2, -5)).toEqual([25, 15, 60]);
    expect(moveDivider([25, 20, 55], 0, 1, 5)).toEqual([30, 15, 55]);
  });

  it('keeps every panel at least the minimum width', () => {
    expect(moveDivider([25, 20, 55], 1, 2, -50)).toEqual([25, MIN_PERCENT, 63]);
    expect(moveDivider([25, 20, 55], 0, 1, -50)).toEqual([MIN_PERCENT, 33, 55]);
    expect(moveDivider([25, 20, 55], 1, 2, 80)).toEqual([25, 63, MIN_PERCENT]);
  });

  it('skips collapsed panels when choosing what a divider resizes', () => {
    const both = DEFAULT_LAYOUT;
    expect(dividerNeighbours(both, 0)).toEqual([0, 1]);
    expect(dividerNeighbours(both, 1)).toEqual([1, 2]);
    const noQuestions = { ...both, collapsed: { transcript: false, questions: true } };
    expect(dividerNeighbours(noQuestions, 0)).toEqual([0, 2]);
    expect(dividerNeighbours(noQuestions, 1)).toEqual([0, 2]);
    const noTranscript = { ...both, collapsed: { transcript: true, questions: false } };
    expect(dividerNeighbours(noTranscript, 0)).toBeNull();
    expect(dividerNeighbours(noTranscript, 1)).toEqual([1, 2]);
    expect(dividerNeighbours({ ...both, collapsed: { transcript: true, questions: true } }, 1)).toBeNull();
  });

  it('turns collapsed panels into narrow rails', () => {
    expect(gridColumns(DEFAULT_LAYOUT)).toBe('minmax(0, 25fr) 0.5rem minmax(0, 20fr) 0.5rem minmax(0, 55fr)');
    expect(gridColumns({ ...DEFAULT_LAYOUT, collapsed: { transcript: true, questions: false } })).toBe(
      '2.25rem 0.5rem minmax(0, 20fr) 0.5rem minmax(0, 55fr)',
    );
  });

  it('falls back to the default for missing or bad stored values', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('not json')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{"widths":[5,5,90]}').widths).toEqual(DEFAULT_LAYOUT.widths);
    expect(parseLayout('{"widths":[30,30,30]}').widths).toEqual(DEFAULT_LAYOUT.widths);
    expect(parseLayout('{"widths":[30,20,50],"collapsed":{"questions":true}}')).toEqual({
      widths: [30, 20, 50],
      collapsed: { transcript: false, questions: true },
    });
  });
});
