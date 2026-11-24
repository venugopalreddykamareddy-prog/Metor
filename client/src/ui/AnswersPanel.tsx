import { useEffect, useRef } from 'react';
import type { AnswerGroup } from '../answers/grouping.ts';
import type { AnswerCard } from '../answers/useAnswers.ts';
import { FONT_SIZES, LINE_SPACINGS, type AnswerDisplay, type FontSize, type LineSpacing } from '../settings.ts';
import { AnswerView } from './AnswerView.tsx';

interface DisplayProps {
  display: AnswerDisplay;
  onFontSize: (v: FontSize) => void;
  onLineSpacing: (v: LineSpacing) => void;
}

/** Text size and line spacing for answers; shared by the panel and focus mode. */
export function AnswerDisplayControls({ display, onFontSize, onLineSpacing }: DisplayProps) {
  return (
    <span className="display-controls">
      <label>
        Text size
        <select value={display.fontSize} onChange={(e) => onFontSize(e.target.value as FontSize)}>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} px
            </option>
          ))}
        </select>
      </label>
      <label>
        Line spacing
        <select value={display.lineSpacing} onChange={(e) => onLineSpacing(e.target.value as LineSpacing)}>
          {LINE_SPACINGS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    </span>
  );
}

interface Props extends DisplayProps {
  groups: AnswerGroup[];
  autoScroll: boolean;
  onCancel: (questionId: string) => void;
  onRegenerate: (card: AnswerCard) => void;
  onFocus: () => void;
}

export function AnswersPanel({ groups, autoScroll, onCancel, onRegenerate, onFocus, ...display }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [groups, autoScroll]);

  return (
    <section className="panel answers-panel" aria-label="Suggested answers">
      <h2>
        Suggested answers
        <span className="panel-tools">
          <AnswerDisplayControls {...display} />
          <button type="button" onClick={onFocus}>
            Focus
          </button>
        </span>
      </h2>
      <div className="answers-scroll" ref={scrollRef} data-testid="answers-scroll">
        {groups.length === 0 && <p className="muted">Answers stream here when a question is ready.</p>}
        {groups.map((g) => (
          <AnswerView key={g.sourceId} group={g} display={display.display} onCancel={onCancel} onRegenerate={onRegenerate} />
        ))}
      </div>
    </section>
  );
}
