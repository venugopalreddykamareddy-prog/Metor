import { useState, type FormEvent } from 'react';
import type { DetectedQuestion } from '../questions/tracker.ts';

const KIND_LABEL: Record<DetectedQuestion['kind'], string | null> = { question: null, request: 'request', follow_up: 'follow-up' };

interface Props {
  questions: DetectedQuestion[];
  onAnswer: (q: DetectedQuestion) => void;
  onDismiss: (id: string) => void;
  onMerge: (id: string) => void;
  onAsk: (text: string) => void;
  onCollapse?: () => void;
}

export function QuestionsPanel({ questions, onAnswer, onDismiss, onMerge, onAsk, onCollapse }: Props) {
  const [typed, setTyped] = useState('');
  const visible = questions.filter((q) => q.status !== 'superseded' && q.status !== 'dismissed');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim()) onAsk(typed);
    setTyped('');
  };

  return (
    <section className="panel" aria-label="Detected questions">
      <h2>
        Questions
        {onCollapse && (
          <button type="button" className="link" aria-label="Hide questions" onClick={onCollapse}>
            ◂ Hide
          </button>
        )}
      </h2>
      {visible.length === 0 && <p className="muted">Questions you're asked will show up here.</p>}
      <ol className="questions" data-testid="questions">
        {visible.map((q, i) => (
          <li key={q.id} className={`question-item status-${q.status}`}>
            <span className="q-text">{q.text}</span>
            <span className="q-meta">
              {KIND_LABEL[q.kind] && <span className="badge">{KIND_LABEL[q.kind]}</span>}
              {q.repeatOf && <span className="badge">asked again</span>}
              {q.manual && <span className="badge">typed</span>}
              <span className="muted">{q.status === 'waiting' ? 'waiting for the end…' : q.status === 'ready' ? 'ready' : ''}</span>
            </span>
            <span className="q-actions">
              {q.status !== 'answered' && (
                <button type="button" onClick={() => onAnswer(q)}>
                  Answer
                </button>
              )}
              {q.status === 'answered' && (
                <button type="button" className="link" onClick={() => onAnswer(q)}>
                  Answer again
                </button>
              )}
              {i > 0 && q.status !== 'answered' && (
                <button type="button" className="link" onClick={() => onMerge(q.id)}>
                  Merge with previous
                </button>
              )}
              {q.status !== 'answered' && (
                <button type="button" className="link" aria-label={`Dismiss: ${q.text}`} onClick={() => onDismiss(q.id)}>
                  Dismiss
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="ask">
        <input aria-label="Type a question" placeholder="Type a question to answer" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button type="submit" disabled={!typed.trim()}>
          Ask
        </button>
      </form>
    </section>
  );
}
