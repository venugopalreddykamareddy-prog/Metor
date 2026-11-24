import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Keeps eval/question-extraction.json well-formed until Phase 4's extractor is tested against it.
interface Case {
  id: string;
  input: string;
  expected: { questions: { text: string; kind: string }[]; ignored?: { text: string; kind: string }[]; incomplete?: boolean };
  note: string;
}

const { cases } = JSON.parse(readFileSync(new URL('../eval/question-extraction.json', import.meta.url), 'utf8')) as {
  cases: Case[];
};

describe('question extraction fixture', () => {
  it('has at least 20 cases with unique ids', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('uses raw-style input: lowercase, no punctuation', () => {
    for (const c of cases) expect(c.input, c.id).toMatch(/^[a-z0-9 ]+$/);
  });

  it('expects questions word for word from the input, never paraphrased (FR-E4)', () => {
    for (const c of cases) {
      for (const q of [...c.expected.questions, ...(c.expected.ignored ?? [])]) {
        expect(c.input, `${c.id}: "${q.text}"`).toContain(q.text);
      }
    }
  });

  it('uses known kinds', () => {
    for (const c of cases) {
      for (const q of c.expected.questions) expect(['question', 'request', 'follow_up'], c.id).toContain(q.kind);
      for (const q of c.expected.ignored ?? []) expect(['greeting', 'filler', 'statement', 'abandoned'], c.id).toContain(q.kind);
    }
  });

  it('covers multi-question, compound, no-question, and incomplete cases', () => {
    expect(cases.some((c) => c.expected.questions.length >= 3)).toBe(true);
    expect(cases.filter((c) => c.expected.questions.length === 0).length).toBeGreaterThanOrEqual(2);
    expect(cases.some((c) => c.expected.incomplete)).toBe(true);
  });
});
