import { useCallback, useRef, useState } from 'react';
import type { AnswerHeader } from '../../../shared/answerFormat.ts';
import type { AnswerEngine, AnswerLength, ClientMessageBody } from '../../../shared/messages.ts';
import type { DetectedQuestion } from '../questions/tracker.ts';
import type { AnswerMessage } from '../session/useRecorder.ts';

export interface AnswerCard {
  questionId: string;
  /** The detected question this answers (repeats and regenerations share it). */
  sourceId: string;
  question: string;
  engine: AnswerEngine;
  length: AnswerLength;
  status: 'streaming' | 'done' | 'failed' | 'cancelled';
  header: AnswerHeader | null;
  text: string;
  error: string | null;
  model: string | null;
  /** When the question's sentence last changed (≈ speech end). */
  spokenAt: number;
  sentAt: number;
  firstTextAt: number | null;
  serverFirstTokenMs: number | null;
  totalMs: number | null;
}

const CONTEXT_TURNS = 3;
const CONTEXT_ANSWER_CHARS = 1200;
const MAX_CARDS = 50;

export function useAnswers(send: (msg: ClientMessageBody) => boolean) {
  const [cards, setCards] = useState<AnswerCard[]>([]);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const update = (questionId: string, fn: (c: AnswerCard) => AnswerCard) =>
    setCards((cs) => cs.map((c) => (c.questionId === questionId ? fn(c) : c)));

  const ask = useCallback(
    (q: DetectedQuestion, engine: AnswerEngine, length: AnswerLength): boolean => {
      const questionId = crypto.randomUUID();
      // Recent finished answers give the model context for follow-ups.
      const turns = cardsRef.current
        .filter((c) => c.status === 'done' && c.text)
        .slice(-CONTEXT_TURNS)
        .map((c) => ({ question: c.question.slice(0, 1000), answer: c.text.slice(0, CONTEXT_ANSWER_CHARS) }));
      const sent = send({
        type: 'answer.request',
        questionId,
        question: q.text.slice(0, 1000),
        ...(q.heard ? { heard: q.heard.slice(0, 1000) } : {}),
        length,
        engine,
        statements: q.statements.slice(-5).map((s) => s.slice(0, 500)),
        turns,
        isFollowUp: q.kind === 'follow_up',
      });
      if (!sent) return false;
      const now = Date.now();
      const card: AnswerCard = {
        questionId,
        sourceId: q.repeatOf ?? q.id,
        question: q.text,
        engine,
        length,
        status: 'streaming',
        header: null,
        text: '',
        error: null,
        model: null,
        spokenAt: q.spokenAt,
        sentAt: now,
        firstTextAt: null,
        serverFirstTokenMs: null,
        totalMs: null,
      };
      setCards((cs) => [...cs.slice(-(MAX_CARDS - 1)), card]);
      return true;
    },
    [send],
  );

  const cancel = useCallback((questionId: string) => send({ type: 'answer.cancel', questionId }), [send]);

  const handleMessage = useCallback((msg: AnswerMessage) => {
    switch (msg.type) {
      case 'answer.header':
        update(msg.questionId, (c) => ({
          ...c,
          header: { questionType: msg.questionType, assessment: msg.assessment, note: msg.note, clarify: msg.clarify },
        }));
        break;
      case 'answer.delta':
        update(msg.questionId, (c) => ({ ...c, text: c.text + msg.text, firstTextAt: c.firstTextAt ?? Date.now() }));
        break;
      case 'answer.done':
        update(msg.questionId, (c) => ({
          ...c,
          status: 'done',
          text: c.text.trim(),
          model: msg.model,
          serverFirstTokenMs: msg.firstTokenMs,
          totalMs: msg.totalMs,
        }));
        break;
      case 'answer.failed':
        update(msg.questionId, (c) => ({ ...c, status: msg.code === 'cancelled' ? 'cancelled' : 'failed', error: msg.message }));
        break;
    }
  }, []);

  /** Answer timings for the debug line: speech end → first word, per answer. */
  const latencies = cards.flatMap((c) => (c.firstTextAt ? [c.firstTextAt - c.spokenAt] : []));

  return { cards, ask, cancel, handleMessage, latencies };
}
