import { useState } from 'react';
import type { AnswerEngine } from '../../../shared/messages.ts';
import { weakestAreas } from '../practice/banks.ts';
import type { usePractice } from '../practice/usePractice.ts';
import type { PracticeQuestion } from '../profile/profiles.ts';

const CATEGORIES: PracticeQuestion['category'][] = ['technical', 'behavioral', 'scenario', 'troubleshooting', 'follow_up', 'misleading', 'made_up'];
const CATEGORY_LABEL: Record<PracticeQuestion['category'], string> = {
  technical: 'Technical',
  behavioral: 'Behavioral',
  scenario: 'Scenario',
  troubleshooting: 'Troubleshooting',
  follow_up: 'Follow-up',
  misleading: 'Misleading premise',
  made_up: 'Made-up term',
};

interface Props {
  practice: ReturnType<typeof usePractice>;
  /** Feedback engines: GPT-OSS 120B first (default), 20B as fast mode; Simulated without Groq. */
  engines: { value: AnswerEngine; label: string }[];
  /** The clean transcript of the current recording, to use as the spoken answer. */
  transcript: string;
}

/** Practice mode (Phase 6): the profile's question bank, an answer spoken or typed, and feedback on request. */
export function PracticePanel({ practice, engines, transcript }: Props) {
  const [category, setCategory] = useState<'all' | PracticeQuestion['category']>('all');
  const [current, setCurrent] = useState<PracticeQuestion | null>(null);
  const [answer, setAnswer] = useState('');
  const [engine, setEngine] = useState<AnswerEngine>(engines[0]?.value ?? 'simulated');
  const [showExpect, setShowExpect] = useState(false);
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState<PracticeQuestion['category']>('technical');

  const pool = practice.questions.filter((q) => category === 'all' || q.category === category);
  const next = () => {
    const others = pool.filter((q) => q.id !== current?.id);
    const pick = (others.length ? others : pool)[Math.floor(Math.random() * (others.length || pool.length))] ?? null;
    setCurrent(pick);
    setAnswer('');
    setShowExpect(false);
  };
  const fb = practice.feedback;
  const weak = weakestAreas(practice.scores);

  return (
    <details className="accuracy practice" data-testid="practice">
      <summary>Practice ({practice.questions.length} questions)</summary>
      <p className="muted">
        Questions are stored only in this browser and can be edited. Feedback is one request to the selected model, only when you ask, and
        uses verified knowledge-base items to check experience claims.
      </p>
      <div className="kb-form">
        <label>
          Category
          <select aria-label="Practice category" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
            <option value="all">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={next} disabled={pool.length === 0}>
          Next question
        </button>
      </div>

      {current && (
        <div className="practice-question" data-testid="practice-question">
          <span className="badge">{CATEGORY_LABEL[current.category]}</span> <strong>{current.text}</strong>
          {current.expect && (
            <div>
              <button type="button" className="link" onClick={() => setShowExpect((v) => !v)}>
                {showExpect ? 'Hide' : 'Show'} what a good answer notices
              </button>
              {showExpect && <p className="muted">{current.expect}</p>}
            </div>
          )}
          <textarea aria-label="Your answer" rows={5} placeholder="Answer aloud and use the transcript, or type" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <div className="actions">
            <button type="button" onClick={() => setAnswer(transcript)} disabled={!transcript.trim()}>
              Use transcript
            </button>
            <label>
              Feedback model
              <select aria-label="Feedback model" value={engine} onChange={(e) => setEngine(e.target.value as AnswerEngine)}>
                {engines.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => practice.requestFeedback(current.text, answer, engine)} disabled={!answer.trim() || fb?.status === 'streaming'}>
              Get feedback
            </button>
          </div>
        </div>
      )}

      {fb && (
        <div className="practice-feedback" data-testid="practice-feedback">
          {fb.header && fb.header.assessment !== 'none' && (
            <p className="assessment">
              <strong>About the question:</strong> {fb.header.note ?? fb.header.assessment}
            </p>
          )}
          {fb.scores && (
            <p data-testid="practice-scores">
              Accuracy {fb.scores.accuracy}/5 · Relevance {fb.scores.relevance}/5 · Communication {fb.scores.communication}/5 · Completeness{' '}
              {fb.scores.completeness}/5
            </p>
          )}
          <div className="answer-text">{fb.text.replace(/SCORES:[^\n]*\n?/, '')}</div>
          {fb.status === 'failed' && <p className="error">{fb.error}</p>}
          {fb.cached && <p className="muted">Reused from cache, no request.</p>}
        </div>
      )}
      {weak.length > 0 && (
        <p className="muted" data-testid="practice-weak">
          This session, weakest first: {weak.map((w) => `${w.area} ${w.average}`).join(' · ')} (not saved)
        </p>
      )}

      <details>
        <summary>Edit question bank</summary>
        <ul className="kb-list" data-testid="practice-bank">
          {practice.questions.map((q) => (
            <li key={q.id}>
              <span className="badge">{CATEGORY_LABEL[q.category]}</span> {q.text}{' '}
              <button type="button" className="link" onClick={() => practice.removeQuestion(q.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className="kb-form">
          <select aria-label="New question category" value={newCategory} onChange={(e) => setNewCategory(e.target.value as PracticeQuestion['category'])}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <input aria-label="New question" value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="Your own question" />
          <button
            type="button"
            disabled={!newText.trim()}
            onClick={() => {
              practice.addQuestion(newCategory, newText);
              setNewText('');
            }}
          >
            Add question
          </button>
        </div>
      </details>
    </details>
  );
}
