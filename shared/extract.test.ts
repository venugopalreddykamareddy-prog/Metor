import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractQuestions, isAnswerable, normalizeQuestion } from './extract.ts';

interface Case {
  id: string;
  input: string;
  context?: unknown[];
  events?: { atMs: number; text: string }[];
  expected: { questions: { text: string; kind: string }[]; incomplete?: boolean };
  note: string;
}
const load = (file: string) =>
  (JSON.parse(readFileSync(new URL(`../eval/${file}`, import.meta.url), 'utf8')) as { cases: Case[] }).cases;

/** The answerable questions extracted from one input, normalized for comparison. */
function questions(c: Case) {
  const result = extractQuestions(c.input, { hasContext: Boolean(c.context?.length) });
  return {
    texts: result.parts.filter(isAnswerable).map((p) => normalizeQuestion(p.text)),
    incomplete: result.incomplete,
  };
}

// Timed cases (superseding, repeats) also depend on history; the hook handles that part
// (useQuestions tests). Here each case's final text alone must give the right questions.
function expectedTexts(c: Case) {
  return c.expected.questions.map((q) => normalizeQuestion(q.text));
}

describe('extractQuestions on eval/question-extraction.json', () => {
  const cases = load('question-extraction.json');
  it.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const got = questions(c);
    expect(got.texts, c.note).toEqual(expectedTexts(c));
    if (c.expected.incomplete) expect(got.incomplete, c.note).toBe(true);
  });
});

// Written separately and never used to tune the rules. First blind run: 13/15. Two general bugs it
// exposed were fixed afterwards (now 15/15), so the set is no longer blind; see docs/ANSWER_EVALUATION.md.
describe('extractQuestions on eval/holdout-extraction.json', () => {
  it('gets at least 13 of 15 right', () => {
    const cases = load('holdout-extraction.json');
    const right = cases.filter((c) => {
      const got = questions(c);
      return JSON.stringify(got.texts) === JSON.stringify(expectedTexts(c)) && (!c.expected.incomplete || got.incomplete);
    });
    expect(right.length).toBeGreaterThanOrEqual(13);
  });
});

describe('extractQuestions details', () => {
  it('keeps the original words and punctuation of clean text', () => {
    const { parts } = extractQuestions('We run AKS. How would you plan the upgrade?');
    expect(parts).toEqual([
      { kind: 'statement', text: 'We run AKS.' },
      { kind: 'question', text: 'How would you plan the upgrade?' },
    ]);
  });

  it('marks a repeat cue', () => {
    const { parts } = extractQuestions('sorry let me ask again how does dns resolution work');
    expect(parts.find(isAnswerable)).toEqual({ kind: 'question', text: 'how does dns resolution work', repeatCue: true });
  });

  it('does not treat "do you know what…" or "what happens when you…" as two questions', () => {
    expect(extractQuestions('do you know what a pod disruption budget is').parts.filter(isAnswerable)).toHaveLength(1);
    expect(extractQuestions('what happens when you type a url and press enter').parts.filter(isAnswerable)).toHaveLength(1);
  });

  const answerable = (text: string, hasContext = false) => extractQuestions(text, { hasContext }).parts.filter(isAnswerable);

  it('treats contracted wh-words at the start as questions, but does not split on them mid-sentence', () => {
    expect(answerable("What's the difference between a Deployment and a StatefulSet?")).toEqual([
      { kind: 'question', text: "What's the difference between a Deployment and a StatefulSet?" },
    ]);
    expect(answerable('what’s your approach to monitoring')).toHaveLength(1);
    expect(answerable("that's what's going on with the cluster")).toHaveLength(0);
  });

  it('keeps an embedded wh-clause together with its verb', () => {
    expect(answerable('How does Kubernetes decide which node a pod is scheduled on?')).toEqual([
      { kind: 'question', text: 'How does Kubernetes decide which node a pod is scheduled on?' },
    ]);
  });

  it('finds "so what…" after a statement, tag questions, and imperative requests', () => {
    expect(answerable('Key Vault stores secrets unencrypted for speed, so what extra encryption should we add?')[0]?.kind).toBe('question');
    expect(answerable("You wrote the Terraform provider for Palo Alto, didn't you?")[0]?.kind).toBe('question');
    expect(answerable('Adding replicas always lowers p99 latency, right?')[0]?.kind).toBe('question');
    expect(answerable('Design a payment system that handles a million requests per second.')[0]?.kind).toBe('request');
    expect(answerable('We wrote it in Go, right now it runs on AKS.')).toHaveLength(0);
  });

  it('waits when a sentence trails off into fillers', () => {
    const result = extractQuestions('so um what I wanted to ask was, uh');
    expect(result.incomplete).toBe(true);
    expect(result.parts.filter(isAnswerable)).toHaveLength(0);
  });

  it('reads "I meant…" as a follow-up only when there is an earlier question', () => {
    expect(answerable('Sorry, I meant mutual TLS', true)).toEqual([{ kind: 'follow_up', text: 'I meant mutual TLS' }]);
    expect(answerable('Sorry, I meant mutual TLS', false)).toHaveLength(0);
  });
});
