import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { load, save } from '../settings.ts';
import { DEFAULT_LAYOUT, KEY_STEP, dividerNeighbours, gridColumns, moveDivider, parseLayout, type Layout } from './layout.ts';

const STORAGE_KEY = 'layout';

function useLayout() {
  const [layout, setLayout] = useState<Layout>(() => parseLayout(load(STORAGE_KEY)));
  const update = (fn: (l: Layout) => Layout) =>
    setLayout((l) => {
      const next = fn(l);
      save(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  return [layout, update] as const;
}

interface Props {
  transcript: (onCollapse: () => void) => ReactNode;
  questions: (onCollapse: () => void) => ReactNode;
  answers: ReactNode;
}

const LABEL = { transcript: 'transcript', questions: 'questions' } as const;

/**
 * Three panels side by side on wide screens: transcript, questions, answers (≈55% by default).
 * Dividers drag or take arrow keys; transcript and questions collapse to a rail. On narrow screens
 * the panels stack and the dividers hide.
 */
export function Workspace({ transcript, questions, answers }: Props) {
  const [layout, update] = useLayout();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ divider: 0 | 1; x: number; layout: Layout } | null>(null);

  const collapse = (panel: keyof Layout['collapsed'], value: boolean) =>
    update((l) => ({ ...l, collapsed: { ...l.collapsed, [panel]: value } }));

  /** Percentage points per pixel, among the expanded panels. */
  const pctPerPx = (l: Layout) => {
    const el = ref.current;
    if (!el) return 0;
    const panels = el.querySelectorAll<HTMLElement>(':scope > .ws-panel:not(.collapsed)');
    const px = [...panels].reduce((sum, p) => sum + p.getBoundingClientRect().width, 0);
    const pct = l.widths.filter((_, i) => !(i === 0 && l.collapsed.transcript) && !(i === 1 && l.collapsed.questions)).reduce((a, b) => a + b, 0);
    return px > 0 ? pct / px : 0;
  };

  const divider = (d: 0 | 1) => {
    const pair = dividerNeighbours(layout, d);
    if (!pair) return <div className="ws-divider disabled" aria-hidden="true" />;
    const [left, right] = pair;
    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { divider: d, x: e.clientX, layout };
    };
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      if (!start || start.divider !== d) return;
      const delta = (e.clientX - start.x) * pctPerPx(start.layout);
      update(() => ({ ...start.layout, widths: moveDivider(start.layout.widths, left, right, delta) }));
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      const step = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0;
      if (step) {
        e.preventDefault();
        update((l) => ({ ...l, widths: moveDivider(l.widths, left, right, step) }));
      } else if (e.key === 'Home') {
        e.preventDefault();
        update((l) => ({ ...l, widths: DEFAULT_LAYOUT.widths }));
      }
    };
    return (
      <div
        className="ws-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label={d === 0 ? 'Resize transcript and questions' : 'Resize questions and answers'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(layout.widths[left])}
        tabIndex={0}
        data-testid={`divider-${d}`}
        title="Drag or use the arrow keys to resize. Double-click to reset."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => update((l) => ({ ...l, widths: DEFAULT_LAYOUT.widths }))}
        onKeyDown={onKeyDown}
      />
    );
  };

  const panel = (key: keyof Layout['collapsed'], render: (onCollapse: () => void) => ReactNode) =>
    layout.collapsed[key] ? (
      <div className="ws-panel collapsed">
        <button type="button" className="rail" aria-expanded={false} aria-label={`Show ${LABEL[key]}`} onClick={() => collapse(key, false)}>
          <span>{key === 'transcript' ? 'Transcript' : 'Questions'} ▸</span>
        </button>
      </div>
    ) : (
      <div className="ws-panel">{render(() => collapse(key, true))}</div>
    );

  return (
    <div className="workspace" ref={ref} style={{ '--ws-columns': gridColumns(layout) } as CSSProperties} data-testid="workspace">
      {panel('transcript', transcript)}
      {divider(0)}
      {panel('questions', questions)}
      {divider(1)}
      <div className="ws-panel ws-answers" data-testid="answers-column">
        {answers}
      </div>
    </div>
  );
}
