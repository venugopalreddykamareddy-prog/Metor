import { extractQuestions, isAnswerable, normalizeQuestion } from '../../../shared/extract.ts';
import type { CleanItem } from '../session/cleanTranscript.ts';

// Turns the clean transcript into a list of detected questions over time: when each is ready to
// answer, which ones replace earlier incomplete versions, and which are repeats (ARCHITECTURE §5.2).

/** Speech must pause this long after a question before it counts as finished (unless it ends with "?"). */
export const READY_AFTER_MS = 900;
/** The same words within this window are one transcript event arriving twice, not a repeat. */
export const DUPLICATE_WINDOW_MS = 5000;

export type QuestionStatus = 'waiting' | 'ready' | 'answered' | 'dismissed' | 'superseded';

export interface DetectedQuestion {
  id: string;
  text: string;
  /** Raw words it came from, when cleaning changed them. */
  heard?: string;
  kind: 'question' | 'request' | 'follow_up';
  status: QuestionStatus;
  /** Statements said just before it, sent as context. */
  statements: string[];
  /** When its sentence last changed: the best guess at when the speaker finished. */
  spokenAt: number;
  firstSeenAt: number;
  /** Set when this asks again something answered earlier. */
  repeatOf?: string;
  manual?: boolean;
}

export interface TrackerState {
  questions: DetectedQuestion[];
  /** Last text and change time per clean sentence key. */
  sentences: Record<string, { text: string; changedAt: number }>;
}

export const emptyTracker: TrackerState = { questions: [], sentences: {} };

const isOpen = (q: DetectedQuestion) => q.status === 'waiting' || q.status === 'ready';

export function updateTracker(state: TrackerState, items: CleanItem[], now: number): TrackerState {
  const sentences: TrackerState['sentences'] = {};
  for (const item of items) {
    if (item.kind !== 'sentence') continue;
    const prev = state.sentences[item.key];
    sentences[item.key] = prev && prev.text === item.text ? prev : { text: item.text, changedAt: now };
  }

  const questions = [...state.questions];
  const byId = new Map(questions.map((q, i) => [q.id, i]));
  let statements: string[] = [];

  for (const item of items) {
    if (item.kind !== 'sentence') continue;
    const sentence = sentences[item.key];
    if (!sentence) continue;
    const hasContext = questions.some((q) => q.status === 'answered');
    // Pass on the raw words only when cleaning changed words (a term fix), not just capitals or punctuation.
    const heard = normalizeQuestion(item.raw) !== normalizeQuestion(item.text) ? item.raw : undefined;
    const { parts, incomplete } = extractQuestions(item.text, { hasContext });
    let n = 0;
    for (const part of parts) {
      if (part.kind === 'statement') {
        statements = [...statements, part.text].slice(-3);
        continue;
      }
      if (!isAnswerable(part)) continue;
      const id = `${item.key}#${n++}`;
      const norm = normalizeQuestion(part.text);
      const existingIndex = byId.get(id);
      const existing = existingIndex === undefined ? undefined : questions[existingIndex];
      const fields = {
        text: part.text,
        kind: part.kind as DetectedQuestion['kind'],
        statements,
        spokenAt: sentence.changedAt,
        ...(heard ? { heard } : {}),
      };

      if (existing) {
        // The sentence grew or was re-cleaned: update a pending question in place (FR-E6).
        if (isOpen(existing) && existing.text !== part.text) questions[existingIndex ?? 0] = { ...existing, ...fields, status: 'waiting' };
        continue;
      }

      // An open question this one completes ("…help me to" → "…help me to understand X") is replaced (FR-E9).
      for (const [i, q] of questions.entries()) {
        const qn = normalizeQuestion(q.text);
        if (isOpen(q) && norm.length > qn.length && norm.startsWith(qn)) questions[i] = { ...q, status: 'superseded' };
      }

      const same = [...questions].reverse().find((q) => normalizeQuestion(q.text) === norm && q.status !== 'superseded');
      if (same && now - same.firstSeenAt < DUPLICATE_WINDOW_MS && !part.repeatCue) continue; // duplicate event (FR-E8)

      const question: DetectedQuestion = { id, ...fields, status: 'waiting', firstSeenAt: now };
      if (same && same.status === 'answered') {
        question.repeatOf = same.repeatOf ?? same.id;
        question.status = 'answered'; // a genuine repeat re-shows the earlier answer
      }
      byId.set(id, questions.length);
      questions.push(question);
      statements = [];
    }

    // Pending questions in this sentence become ready once it's finished.
    for (const [i, q] of questions.entries()) {
      if (!q.id.startsWith(`${item.key}#`) || q.status !== 'waiting') continue;
      const isLast = q.id === `${item.key}#${n - 1}`;
      const endsWithMark = /\?\s*$/.test(q.text);
      const settled = now - sentence.changedAt >= READY_AFTER_MS;
      if (!(isLast && incomplete) && !item.open && (endsWithMark || settled)) questions[i] = { ...q, status: 'ready' };
    }
  }

  return { questions, sentences };
}

/** Mark questions answered, dismissed, etc. */
export function setStatus(state: TrackerState, id: string, status: QuestionStatus): TrackerState {
  return { ...state, questions: state.questions.map((q) => (q.id === id ? { ...q, status } : q)) };
}

/** Adds a question typed by the user, or the merge of two detected ones. */
export function addManual(state: TrackerState, text: string, now: number, replaces: string[] = []): TrackerState {
  const question: DetectedQuestion = {
    id: `manual-${now}-${state.questions.length}`,
    text: text.trim(),
    kind: 'question',
    status: 'ready',
    statements: [],
    spokenAt: now,
    firstSeenAt: now,
    manual: true,
  };
  const questions = state.questions.map((q) => (replaces.includes(q.id) ? { ...q, status: 'dismissed' as const } : q));
  return { ...state, questions: [...questions, question] };
}
