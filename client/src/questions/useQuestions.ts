import { useCallback, useEffect, useRef, useState } from 'react';
import type { CleanItem } from '../session/cleanTranscript.ts';
import { READY_AFTER_MS, addManual, emptyTracker, setStatus, updateTracker, type DetectedQuestion, type TrackerState } from './tracker.ts';

/**
 * Detected questions from the clean transcript. When `autoAnswer` is on, each question is passed to
 * `onReady` once, when it becomes ready.
 */
export function useQuestions(clean: CleanItem[], autoAnswer: boolean, onReady: (q: DetectedQuestion) => boolean) {
  const [state, setState] = useState<TrackerState>(emptyTracker);
  const cleanRef = useRef(clean);
  cleanRef.current = clean;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    setState((s) => updateTracker(s, clean, Date.now()));
  }, [clean]);

  // Re-check after the pause window so waiting questions can become ready without new speech.
  const waiting = state.questions.some((q) => q.status === 'waiting');
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setState((s) => updateTracker(s, cleanRef.current, Date.now())), READY_AFTER_MS + 50);
    return () => clearTimeout(timer);
  }, [waiting, state]);

  useEffect(() => {
    if (!autoAnswer) return;
    const ready = state.questions.filter((q) => q.status === 'ready');
    if (ready.length === 0) return;
    let next = state;
    for (const q of ready) if (onReadyRef.current(q)) next = setStatus(next, q.id, 'answered');
    if (next !== state) setState(next);
  }, [state, autoAnswer]);

  const answer = useCallback((q: DetectedQuestion) => {
    if (onReadyRef.current(q)) setState((s) => setStatus(s, q.id, 'answered'));
  }, []);

  const dismiss = useCallback((id: string) => setState((s) => setStatus(s, id, 'dismissed')), []);

  /** Joins a question with the one before it, for when extraction split it wrongly. */
  const mergeWithPrevious = useCallback((id: string) => {
    setState((s) => {
      const visible = s.questions.filter((q) => q.status !== 'superseded' && q.status !== 'dismissed');
      const index = visible.findIndex((q) => q.id === id);
      const prev = visible[index - 1];
      const current = visible[index];
      if (!prev || !current) return s;
      return addManual(s, `${prev.text} ${current.text}`, Date.now(), [prev.id, current.id]);
    });
  }, []);

  const ask = useCallback((text: string) => setState((s) => addManual(s, text, Date.now())), []);
  const reset = useCallback(() => setState(emptyTracker), []);

  return { questions: state.questions, answer, dismiss, mergeWithPrevious, ask, reset };
}
