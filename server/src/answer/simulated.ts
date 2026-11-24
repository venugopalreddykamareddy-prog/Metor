import { findAmbiguousAcronyms } from '../../../shared/acronyms.ts';
import type { Assessment, QuestionType } from '../../../shared/answerFormat.ts';
import type { AnswerLength } from '../../../shared/messages.ts';
import type { AnswerRequest } from './prompt.ts';
import type { AnswerProvider } from './types.ts';

const SENTENCES: Record<AnswerLength, number> = { short: 2, standard: 4, detailed: 8 };
const BODY = [
  'The direct answer would go first, in plain words.',
  'Then a sentence on why it works that way.',
  'A practical example would come next, tied to the question.',
  'After that, one trade-off worth mentioning.',
  'Then what I would watch for in production.',
  'A detailed answer adds a second example here.',
  'It would also cover how to verify the result.',
  'And one common mistake to avoid.',
];

/** Picks a header with a few simple rules, so the UI and tests see every kind of assessment. */
function classify(req: AnswerRequest): { type: QuestionType; assessment: Assessment; note: string | null; clarify: string | null } {
  const q = req.question.toLowerCase();
  if (/\b(weekend|favorite movie|football|how are you)\b/.test(q)) {
    return { type: 'off_topic', assessment: 'off_topic', note: 'Small talk, not a technical question.', clarify: null };
  }
  if (/\b(you've|you have)\b.*\b(right|didn't you)\b|\bdidn't you\b/.test(q)) {
    return { type: 'experience_probe', assessment: 'unverified_experience', note: 'No verified experience is loaded yet.', clarify: null };
  }
  const acronyms = findAmbiguousAcronyms(req.question);
  if (acronyms.length > 0 && req.question.split(/\s+/).length < 6) {
    return {
      type: 'ambiguous',
      assessment: 'clarification_needed',
      note: `${acronyms[0]?.acronym} has several meanings.`,
      clarify: `Do you mean ${acronyms[0]?.meanings[0]}?`,
    };
  }
  if (/^(tell me about a time|describe a time|give me an example of when)/.test(q)) {
    return { type: 'behavioral', assessment: 'none', note: null, clarify: null };
  }
  return { type: req.isFollowUp ? 'follow_up' : 'technical', assessment: 'none', note: null, clarify: null };
}

/** Canned answers streamed word by word; used in CI, tests, and when no Groq key is set. */
export function createSimulatedAnswer(delayMs = 25): AnswerProvider {
  return async ({ request, signal }) => {
    const h = classify(request);
    const header = `TYPE: ${h.type}\nASSESSMENT: ${h.assessment}\nNOTE: ${h.note ?? '-'}\nCLARIFY: ${h.clarify ?? '-'}\nANSWER:\n`;
    const answer = [
      '(Simulated answer.) Sure, here is how I would put it.',
      ...BODY.slice(0, SENTENCES[request.length]),
      'That is the short version, and I am happy to go deeper on any part.',
    ].join(' ');
    async function* chunks(): AsyncGenerator<string> {
      yield header;
      for (const word of answer.split(' ')) {
        if (signal.aborted) return;
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        yield `${word} `;
      }
    }
    return { chunks: chunks(), usage: Promise.resolve(null), model: 'simulated' };
  };
}
