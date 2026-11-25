import { describe, expect, it } from 'vitest';
import { claimsExperience, declines, styleIssues, summarize, suspectedHallucination, toCsv, type EvalResult } from './evaluate.ts';

describe('styleIssues', () => {
  it('passes a natural spoken answer', () => {
    expect(
      styleIssues(
        "It's basically how much failure we're allowed before reliability work wins. With a 99.9% monthly SLO that's about 43 minutes, so once most of it's gone we slow releases down.",
      ),
    ).toEqual([]);
  });

  it('flags textbook openers, stock phrases and markdown', () => {
    expect(styleIssues('An error budget is the amount of unreliability that is acceptable. It plays a crucial role.')).toEqual([
      'stock:plays a crucial role',
      'definition_opener',
    ]);
    expect(styleIssues('## Overview\n**Great question!**')).toEqual(['heading', 'bold', 'stock:great question']);
    expect(styleIssues(['- a', '- b', '- c', '- d', '- e'].join('\n'))).toContain('many_bullets');
  });

  it('flags long answers with no contractions at all', () => {
    const formal = Array.from({ length: 70 }, () => 'word').join(' ');
    expect(styleIssues(formal)).toContain('no_contractions');
    expect(styleIssues(`${formal} it's`)).not.toContain('no_contractions');
  });
});

describe('hallucination checks', () => {
  it('recognizes an answer that declines a made-up term', () => {
    expect(declines("I'm not familiar with a rewind command in kubectl. If you mean rolling back, I'd use kubectl rollout undo.")).toBe(true);
    expect(declines('Hyperdrive mode in Istio enables a faster data path by bypassing Envoy.')).toBe(false);
  });

  it('spots claimed experience', () => {
    expect(claimsExperience('Yes, I managed 10,000 nodes at my last company.')).toBe(true);
    expect(claimsExperience('When I managed the platform team we…')).toBe(true);
    expect(claimsExperience("There's no verified story loaded yet. One way I'd approach it is…")).toBe(false);
    expect(claimsExperience("If you mean active-active, I've built services across two zones.")).toBe(true);
  });

  it('treats claimed experience as a hallucination in any category', () => {
    expect(suspectedHallucination('ambiguous', "I've integrated several apps with Azure AD.", 'clarification_needed')).toBe(true);
  });

  it('flags fabricated answers that neither flag nor decline', () => {
    expect(suspectedHallucination('fabricated', 'Hyperdrive mode bypasses Envoy.', 'none')).toBe(true);
    expect(suspectedHallucination('fabricated', 'Hyperdrive mode bypasses Envoy.', 'unrecognized_term')).toBe(false);
    expect(suspectedHallucination('fabricated', "I'm not familiar with that mode.", 'clarification_needed')).toBe(false);
    expect(suspectedHallucination('experience_trap', 'Yes, I ran 10,000 nodes.', 'unverified_experience')).toBe(true);
    expect(suspectedHallucination('genuine', 'anything', 'none')).toBe(false);
  });
});

function result(id: string, category: string, expected: string, assessment: EvalResult['assessment'], extra: Partial<EvalResult> = {}): EvalResult {
  return {
    id,
    category,
    question: 'Q?',
    expected,
    assessment,
    questionType: null,
    note: null,
    clarify: null,
    answer: "It's fine.",
    firstTokenMs: 400,
    totalMs: 900,
    tokens: 300,
    error: null,
    style: [],
    suspectedHallucination: false,
    experienceClaims: [],
    ...extra,
  };
}

describe('summarize', () => {
  it('computes accuracy, false positives, no-answer cases and latency', () => {
    const s = summarize([
      result('g1', 'genuine', 'none', 'none', { firstTokenMs: 300 }),
      result('g2', 'genuine', 'none', 'clarification_needed', { firstTokenMs: 500 }),
      result('f1', 'fabricated', 'unrecognized_term', 'unrecognized_term', { firstTokenMs: 700 }),
      result('i1', 'irrelevant', 'off_topic', null, { firstTokenMs: null }),
      result('e1', 'genuine', 'none', null, { error: 'quota' }),
    ]);
    expect(s).toMatchObject({
      questions: 5,
      answered: 3,
      errors: 1,
      assessmentAccuracy: 75,
      falsePositiveFlags: 50,
      noAnswerIrrelevant: '1/1',
      firstTokenP50Ms: 500,
    });
  });

  it('writes a CSV with grading columns and escapes text', () => {
    const csv = toCsv([result('g1', 'genuine', 'none', 'none', { answer: 'Say "hi", then\nleave' })]);
    expect(csv.split('\n')[0]).toContain('naturalness_1_5');
    expect(csv).toContain('"Say ""hi"", then\nleave"');
  });
});
