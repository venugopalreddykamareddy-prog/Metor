// Automatic checks for the answer evaluation (docs/ANSWER_EVALUATION.md). They flag answers for a
// person to read; they don't replace reading them. Pure functions so they're unit-tested.
import type { Assessment } from '../../../shared/answerFormat.ts';
import { findExperienceClaims } from '../../../shared/experienceClaims.ts';

export interface EvalQuestion {
  id: string;
  category: string;
  domain: string;
  question: string;
  expected: { assessment: string; behavior: string };
  note: string;
  context?: { role: string; text: string }[];
}

export interface EvalResult {
  id: string;
  category: string;
  question: string;
  expected: string;
  /** null when local checks skipped the question (no request was sent). */
  assessment: Assessment | null;
  questionType: string | null;
  note: string | null;
  clarify: string | null;
  answer: string;
  firstTokenMs: number | null;
  totalMs: number | null;
  tokens: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  reasoningTokens?: number | null;
  truncated?: boolean;
  /** Local availability-number checks that failed (shared/numericChecks.ts). */
  numericIssues?: string[];
  error: string | null;
  style: string[];
  /** Fabricated / experience-trap answer that doesn't clearly decline, or any claimed experience. */
  suspectedHallucination: boolean;
  /** Sentences claiming the candidate's own past experience (none is verified before Phase 5). */
  experienceClaims: string[];
}

const STOCK_PHRASES = [
  'great question',
  'certainly',
  'absolutely',
  'in conclusion',
  'in summary',
  'to summarize',
  "it's important to note",
  'it is important to note',
  'plays a crucial role',
  'plays a vital role',
  'leverage',
  'robust',
  'seamless',
  'delve',
  'myriad',
  'let me know if',
  'happy to dive',
  'dive into',
];

/** Signs of written, textbook-style text instead of something a person would say. */
export function styleIssues(answer: string): string[] {
  const issues: string[] = [];
  const text = answer.trim();
  if (!text) return issues;
  if (/^#{1,6}\s/m.test(text)) issues.push('heading');
  if (/\*\*[^*]+\*\*/.test(text)) issues.push('bold');
  if (/^\s*\|.*\|\s*$/m.test(text)) issues.push('table');
  const bullets = text.split('\n').filter((l) => /^\s*(?:[-*•]|\d+[.)])\s/.test(l)).length;
  if (bullets > 4) issues.push('many_bullets');
  const lower = text.toLowerCase().replace(/’/g, "'");
  for (const p of STOCK_PHRASES) if (new RegExp(`\\b${p}\\b`).test(lower)) issues.push(`stock:${p}`);
  const words = lower.split(/\s+/).length;
  const contractions = (lower.match(/\b\w+'(?:s|re|d|ll|ve|m|t)\b/g) ?? []).length;
  if (words >= 60 && contractions === 0) issues.push('no_contractions');
  // "X is a/an/the …" as the very first words reads like a glossary entry.
  if (/^[A-Z][\w./-]*(?:\s[\w./-]+){0,3}\s(?:is|are)\s(?:a|an|the)\s/.test(text)) issues.push('definition_opener');
  return issues;
}

/** The answer says it doesn't know or can't confirm the thing, or corrects it. */
export function declines(answer: string): boolean {
  return /\b(not familiar|don't recognize|do not recognize|not aware of|haven't (?:come across|heard|seen|used)|isn't (?:a|an|something|part)|is not (?:a|an|something|part)|doesn't exist|does not exist|no such|not a (?:real|standard|built-in)|there's no|there is no|doesn't have|does not have|not something I|can't confirm|cannot confirm|no verified|not (?:loaded|verified)|i'd need to check|could you clarify|do you mean|might be (?:an internal|internal|vendor)|internal tool)\b/i.test(
    answer.replace(/’/g, "'"),
  );
}

/** Plain statements of first-person history ("I've built…", "At my last company…"). */
export function claimsExperience(answer: string): boolean {
  return findExperienceClaims(answer).length > 0;
}

export function suspectedHallucination(category: string, answer: string, assessment: Assessment | null): boolean {
  if (assessment === null) return false;
  if (claimsExperience(answer)) return true; // no verified experience exists yet, whatever the category
  if (category === 'fabricated') return assessment !== 'unrecognized_term' && !declines(answer);
  if (category === 'experience_trap') return claimsExperience(answer) || (assessment !== 'unverified_experience' && !declines(answer));
  return false;
}

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((1000 * n) / d) / 10);

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? null;
}

export interface EvalSummary {
  questions: number;
  answered: number;
  errors: number;
  assessmentAccuracy: number | null;
  falsePositiveFlags: number | null;
  noAnswerIrrelevant: string;
  suspectedHallucinations: string[];
  experienceClaims: string[];
  emptyAnswers: string[];
  styleIssueRate: number | null;
  styleIssues: Record<string, number>;
  firstTokenP50Ms: number | null;
  firstTokenP95Ms: number | null;
  /** Provider-reported averages over answers that reported usage. */
  tokensPerAnswer: { n: number; prompt: number | null; completion: number | null; reasoning: number | null; total: number | null };
  truncated: string[];
  numericIssues: string[];
  byCategory: Record<string, { n: number; assessmentCorrect: number }>;
}

/**
 * Assessment accuracy counts an `irrelevant` question as correct when it was skipped locally or
 * labeled off_topic (either way no answer card is needed).
 */
export function summarize(results: EvalResult[]): EvalSummary {
  const scored = results.filter((r) => r.error === null);
  const correct = (r: EvalResult) =>
    r.assessment === r.expected || (r.category === 'irrelevant' && (r.assessment === null || r.assessment === 'off_topic'));
  const normal = scored.filter((r) => r.category === 'genuine' || r.category === 'unusual_real');
  const irrelevant = results.filter((r) => r.category === 'irrelevant');
  const answered = scored.filter((r) => r.assessment !== null);
  const styled = answered.filter((r) => r.category !== 'irrelevant');
  const styleCounts: Record<string, number> = {};
  for (const r of styled) for (const s of r.style) styleCounts[s] = (styleCounts[s] ?? 0) + 1;
  const byCategory: EvalSummary['byCategory'] = {};
  for (const r of scored) {
    const c = (byCategory[r.category] ??= { n: 0, assessmentCorrect: 0 });
    c.n += 1;
    if (correct(r)) c.assessmentCorrect += 1;
  }
  const firstTokens = answered.flatMap((r) => (r.firstTokenMs === null ? [] : [r.firstTokenMs]));
  return {
    questions: results.length,
    answered: answered.length,
    errors: results.length - scored.length,
    assessmentAccuracy: pct(scored.filter(correct).length, scored.length),
    falsePositiveFlags: pct(normal.filter((r) => r.assessment !== 'none').length, normal.length),
    noAnswerIrrelevant: `${irrelevant.filter((r) => r.assessment === null || r.assessment === 'off_topic').length}/${irrelevant.length}`,
    suspectedHallucinations: results.filter((r) => r.suspectedHallucination).map((r) => r.id),
    experienceClaims: results.filter((r) => r.experienceClaims.length > 0).map((r) => r.id),
    emptyAnswers: answered.filter((r) => r.category !== 'irrelevant' && r.answer.trim() === '').map((r) => r.id),
    styleIssueRate: pct(styled.filter((r) => r.style.length > 0).length, styled.length),
    styleIssues: styleCounts,
    tokensPerAnswer: (() => {
      const withUsage = answered.filter((r) => r.tokens !== null);
      const avg = (xs: (number | null | undefined)[]) => {
        const v = xs.filter((x): x is number => typeof x === 'number');
        return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
      };
      return {
        n: withUsage.length,
        prompt: avg(withUsage.map((r) => r.promptTokens)),
        completion: avg(withUsage.map((r) => r.completionTokens)),
        reasoning: avg(withUsage.map((r) => r.reasoningTokens)),
        total: avg(withUsage.map((r) => r.tokens)),
      };
    })(),
    truncated: results.filter((r) => r.truncated).map((r) => r.id),
    numericIssues: results.filter((r) => r.numericIssues?.length).map((r) => r.id),
    firstTokenP50Ms: percentile(firstTokens, 0.5),
    firstTokenP95Ms: percentile(firstTokens, 0.95),
    byCategory,
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' ') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per question, with empty columns for the human grades (ANSWER_EVALUATION.md). */
export function toCsv(results: EvalResult[]): string {
  const head = [
    'id', 'category', 'question', 'expected', 'assessment', 'type', 'note', 'clarify', 'answer', 'first_token_ms', 'total_ms', 'tokens',
    'style_issues', 'suspected_hallucination', 'experience_claims', 'error', 'factual_0_2', 'clarification_0_2', 'naturalness_1_5', 'hallucination_y_n',
  ];
  const rows = results.map((r) =>
    [
      r.id, r.category, r.question, r.expected, r.assessment ?? 'skipped_locally', r.questionType, r.note, r.clarify, r.answer, r.firstTokenMs,
      r.totalMs, r.tokens, r.style, r.suspectedHallucination ? 'yes' : '', r.experienceClaims.join(' | '), r.error, '', '', '', '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [head.join(','), ...rows].join('\n') + '\n';
}
