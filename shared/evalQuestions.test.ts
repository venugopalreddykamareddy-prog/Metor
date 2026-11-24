import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Keeps eval/answer-questions.json well-formed until the Phase 4 eval runner uses it.
interface Question {
  id: string;
  category: string;
  domain: string;
  question: string;
  expected: { assessment: string; behavior: string };
  note: string;
  context?: { role: string; text: string }[];
}

const { questions } = JSON.parse(readFileSync(new URL('../eval/answer-questions.json', import.meta.url), 'utf8')) as {
  questions: Question[];
};

const CATEGORIES = [
  'genuine', 'unusual_real', 'fabricated', 'incorrect_premise', 'tricky_troubleshooting',
  'ambiguous', 'irrelevant', 'misheard', 'experience_trap', 'follow_up', 'behavioral',
];
const ASSESSMENTS = [
  'none', 'incorrect_premise', 'unrecognized_term', 'possible_transcription_error', 'clarification_needed',
  'unrealistic_requirement', 'insufficient_information', 'unverified_experience', 'off_topic',
];

describe('answer evaluation set', () => {
  it('has at least 100 questions with unique ids', () => {
    expect(questions.length).toBeGreaterThanOrEqual(100);
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
  });

  it('covers every category with at least 8 questions', () => {
    for (const category of CATEGORIES) {
      expect(questions.filter((q) => q.category === category).length, category).toBeGreaterThanOrEqual(8);
    }
  });

  it('uses only known categories and assessment labels, and fills every field', () => {
    for (const q of questions) {
      expect(CATEGORIES, q.id).toContain(q.category);
      expect(ASSESSMENTS, q.id).toContain(q.expected.assessment);
      expect(q.question.trim() && q.expected.behavior.trim() && q.note.trim() && q.domain.trim(), q.id).toBeTruthy();
    }
  });

  it('never expects a genuine or unusual-but-real question to be flagged', () => {
    for (const q of questions.filter((q) => q.category === 'genuine' || q.category === 'unusual_real')) {
      expect(q.expected.assessment, q.id).toBe('none');
    }
  });

  it('gives context to follow-ups that refer to an earlier question', () => {
    const withContext = questions.filter((q) => q.category === 'follow_up' && q.context?.length);
    expect(withContext.length).toBeGreaterThanOrEqual(6);
  });
});
