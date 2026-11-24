import { useEffect, useRef } from 'react';
import type { Assessment } from '../../../shared/answerFormat.ts';
import type { AnswerCard } from '../answers/useAnswers.ts';

const ASSESSMENT_LABEL: Record<Assessment, string | null> = {
  none: null,
  incorrect_premise: 'Incorrect premise',
  unrecognized_term: 'Unrecognized term',
  possible_transcription_error: 'Possibly misheard',
  clarification_needed: 'Needs clarification',
  unrealistic_requirement: 'Unrealistic requirement',
  insufficient_information: 'Not enough information',
  unverified_experience: 'Unverified experience',
  off_topic: 'Off-topic',
};
const ENGINE_LABEL: Record<AnswerCard['engine'], string> = {
  simulated: 'Simulated',
  'groq-120b': 'GPT-OSS 120B',
  'groq-20b': 'GPT-OSS 20B',
};

const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`);

interface Props {
  cards: AnswerCard[];
  autoScroll: boolean;
  onCancel: (questionId: string) => void;
  onRegenerate: (card: AnswerCard) => void;
}

export function AnswersPanel({ cards, autoScroll, onCancel, onRegenerate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [cards, autoScroll]);

  return (
    <section className="panel" aria-label="Suggested answers">
      <h2>Suggested answers</h2>
      <div className="answers-scroll" ref={scrollRef} data-testid="answers-scroll">
        {cards.length === 0 && <p className="muted">Answers stream here when a question is ready.</p>}
        {cards.map((c) => {
          const label = c.header ? ASSESSMENT_LABEL[c.header.assessment] : null;
          return (
            <article key={c.questionId} className={`answer status-${c.status}`} data-testid="answer">
              <p className="answer-question">{c.question}</p>
              {label && (
                <div className="assessment" data-testid="assessment">
                  <strong>{label}</strong>
                  {c.header?.note && <span> · {c.header.note}</span>}
                  {c.header?.clarify && <div className="clarify">Ask: “{c.header.clarify}”</div>}
                </div>
              )}
              <div className="answer-text" data-testid="answer-text">
                {c.text}
                {c.status === 'streaming' && <span className="cursor" aria-hidden="true">▍</span>}
              </div>
              {c.error && <p className="error">{c.error}</p>}
              <div className="answer-meta">
                <span>
                  {ENGINE_LABEL[c.engine]} · {c.length} · speech end → first word {seconds(c.firstTextAt === null ? null : c.firstTextAt - c.spokenAt)} ·
                  server first word {seconds(c.serverFirstTokenMs)} · total {seconds(c.totalMs)}
                </span>
                {c.status === 'streaming' ? (
                  <button type="button" onClick={() => onCancel(c.questionId)}>
                    Stop
                  </button>
                ) : (
                  <button type="button" className="link" onClick={() => onRegenerate(c)}>
                    Regenerate
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
