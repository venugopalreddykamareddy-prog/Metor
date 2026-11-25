import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerHeader } from '../../../shared/answerFormat.ts';
import type { KbSnippet } from '../../../shared/kb.ts';
import type { AnswerEngine, ClientMessageBody } from '../../../shared/messages.ts';
import { profileContext, type Profile } from '../../../shared/profile.ts';
import { idbStore } from '../kb/db.ts';
import type { PracticeQuestion } from '../profile/profiles.ts';
import type { AnswerMessage } from '../session/useRecorder.ts';
import { load, save } from '../settings.ts';
import { parseScores, seedQuestions, type Scores } from './banks.ts';

export const questionStore = idbStore<PracticeQuestion>('questions');
export const seededKey = (profileId: string) => `practice.seeded.${profileId}`;

export interface Feedback {
  questionId: string;
  question: string;
  status: 'streaming' | 'done' | 'failed';
  header: AnswerHeader | null;
  text: string;
  scores: Scores | null;
  error: string | null;
  cached: boolean;
}

/** Practice for the active profile: its own question bank, and feedback only when asked (one request). */
export function usePractice(profile: Profile, send: (msg: ClientMessageBody) => boolean, pickKb: (text: string) => KbSnippet[]) {
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [scores, setScores] = useState<{ profileId: string; scores: Scores }[]>([]);
  const pendingRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const mine = (await questionStore.all()).filter((q) => q.profileId === profile.id);
    // The drafted bank is copied in once per profile; after that the user's edits stand.
    if (mine.length === 0 && !load(seededKey(profile.id))) {
      const seeded = seedQuestions(profile.role, profile.id, () => crypto.randomUUID());
      for (const q of seeded) await questionStore.put(q);
      save(seededKey(profile.id), '1');
      setQuestions(seeded);
      return;
    }
    setQuestions(mine);
  }, [profile.id, profile.role]);
  useEffect(() => {
    setFeedback(null);
    void reload().catch(() => setQuestions([]));
  }, [reload]);

  const addQuestion = (category: PracticeQuestion['category'], text: string) => {
    const q: PracticeQuestion = { id: crypto.randomUUID(), profileId: profile.id, category, text: text.trim(), source: 'user' };
    setQuestions((all) => [...all, q]);
    void questionStore.put(q);
  };
  const removeQuestion = (id: string) => {
    setQuestions((all) => all.filter((q) => q.id !== id));
    void questionStore.delete(id);
  };

  /** One feedback request for this answer; cached on the server by question, answer and profile. */
  const requestFeedback = (question: string, answer: string, engine: AnswerEngine): boolean => {
    const questionId = crypto.randomUUID();
    const kb = pickKb(`${question} ${answer}`);
    const sent = send({
      type: 'answer.request',
      questionId,
      question: question.slice(0, 1000),
      length: 'standard',
      engine,
      statements: [],
      turns: [],
      isFollowUp: false,
      ...(kb.length ? { kb } : {}),
      profile: profileContext(profile),
      practice: { answer: answer.slice(0, 4000) },
    });
    if (!sent) return false;
    pendingRef.current = questionId;
    setFeedback({ questionId, question, status: 'streaming', header: null, text: '', scores: null, error: null, cached: false });
    return true;
  };

  const owns = useCallback((questionId: string) => pendingRef.current === questionId, []);
  const handle = useCallback(
    (msg: AnswerMessage) => {
      setFeedback((f) => {
        if (!f || f.questionId !== msg.questionId) return f;
        switch (msg.type) {
          case 'answer.header':
            return { ...f, header: { questionType: msg.questionType, assessment: msg.assessment, note: msg.note, clarify: msg.clarify } };
          case 'answer.delta':
            return { ...f, text: f.text + msg.text };
          case 'answer.done':
            return { ...f, status: 'done', text: f.text.trim(), scores: parseScores(f.text), cached: msg.cached };
          case 'answer.failed':
            return { ...f, status: 'failed', error: msg.message };
        }
      });
    },
    [],
  );
  // Each finished feedback's scores are counted once, for this session's weak areas.
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (feedback?.status !== 'done' || !feedback.scores || counted.current === feedback.questionId) return;
    counted.current = feedback.questionId;
    const entry = { profileId: profile.id, scores: feedback.scores };
    setScores((all) => [...all, entry]);
  }, [feedback, profile.id]);

  return {
    questions,
    feedback,
    /** This session's scores for the active profile (kept in memory only). */
    scores: scores.filter((s) => s.profileId === profile.id).map((s) => s.scores),
    addQuestion,
    removeQuestion,
    requestFeedback,
    owns,
    handle,
  };
}
