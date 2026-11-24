import { useEffect } from 'react';
import type { AnswerGroup } from '../answers/grouping.ts';
import type { AnswerCard } from '../answers/useAnswers.ts';
import type { FontSize, LineSpacing, AnswerDisplay } from '../settings.ts';
import { AnswerDisplayControls } from './AnswersPanel.tsx';
import { AnswerView } from './AnswerView.tsx';

interface Props {
  /** The newest answered question; earlier ones stay in the answers panel. */
  latest: AnswerGroup | null;
  /** A question heard after it that isn't answered yet, if any. */
  pending: string | null;
  display: AnswerDisplay;
  onFontSize: (v: FontSize) => void;
  onLineSpacing: (v: LineSpacing) => void;
  onCancel: (questionId: string) => void;
  onRegenerate: (card: AnswerCard) => void;
  onExit: () => void;
}

/**
 * Practice focus mode: only the latest question and answer, large. The header with the recording
 * indicator stays on screen above it; this view never covers or replaces it.
 */
export function FocusView({ latest, pending, onExit, ...rest }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  return (
    <section className="focus-view" aria-label="Focus mode" data-testid="focus-view">
      <div className="focus-tools">
        <AnswerDisplayControls display={rest.display} onFontSize={rest.onFontSize} onLineSpacing={rest.onLineSpacing} />
        <button type="button" onClick={onExit}>
          Exit focus (Esc)
        </button>
      </div>
      {pending && (
        <p className="focus-pending" data-testid="focus-pending">
          Listening: {pending}
        </p>
      )}
      {latest ? (
        <AnswerView key={latest.sourceId} group={latest} display={rest.display} onCancel={rest.onCancel} onRegenerate={rest.onRegenerate} focus />
      ) : (
        <p className="muted">The next answer will show here.</p>
      )}
    </section>
  );
}
