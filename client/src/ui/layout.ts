// Widths of the three workspace panels (transcript, questions, answers), as percentages of the
// space they share. Pure functions so resizing and collapsing are unit-testable.

export type Widths = [transcript: number, questions: number, answers: number];

export interface Layout {
  widths: Widths;
  /** Collapsed panels shrink to a narrow rail; the answers panel can't be collapsed. */
  collapsed: { transcript: boolean; questions: boolean };
}

/** The answers panel gets about 55% by default. */
export const DEFAULT_LAYOUT: Layout = { widths: [25, 20, 55], collapsed: { transcript: false, questions: false } };
/** No panel gets narrower than this while expanded. */
export const MIN_PERCENT = 12;
/** Arrow keys move a divider this much. */
export const KEY_STEP = 2;

const round = (n: number) => Math.round(n * 10) / 10;

export type PanelIndex = 0 | 1 | 2;

/**
 * Moves the boundary between panels `left` and `right` by `delta` percentage points (positive
 * widens `left`), keeping both at least MIN_PERCENT wide. Other panels don't change.
 */
export function moveDivider(widths: Widths, left: PanelIndex, right: PanelIndex, delta: number): Widths {
  const next: Widths = [...widths];
  const l = next[left];
  const r = next[right];
  const d = Math.max(MIN_PERCENT - l, Math.min(r - MIN_PERCENT, delta));
  next[left] = round(l + d);
  next[right] = round(r - d);
  return next;
}

const isCollapsed = (layout: Layout, i: PanelIndex) =>
  (i === 0 && layout.collapsed.transcript) || (i === 1 && layout.collapsed.questions);

/**
 * The two expanded panels a divider resizes. Divider 0 sits after the transcript, divider 1 after
 * the questions; collapsed panels are skipped. Null when there's nothing to resize on one side.
 */
export function dividerNeighbours(layout: Layout, divider: 0 | 1): [PanelIndex, PanelIndex] | null {
  const before = ([0, 1] as const).filter((i) => i <= divider && !isCollapsed(layout, i)).at(-1);
  const after = ([1, 2] as const).find((i) => i > divider && !isCollapsed(layout, i));
  return before === undefined || after === undefined ? null : [before, after];
}

/** CSS grid-template-columns for the layout; dividers are 0.5rem columns between panels. */
export function gridColumns(layout: Layout): string {
  const [t, q, a] = layout.widths;
  const col = (pct: number, collapsed: boolean) => (collapsed ? '2.25rem' : `minmax(0, ${pct}fr)`);
  return [col(t, layout.collapsed.transcript), '0.5rem', col(q, layout.collapsed.questions), '0.5rem', col(a, false)].join(' ');
}

/** Reads a stored layout, falling back to the default for anything missing or out of range. */
export function parseLayout(stored: string | null): Layout {
  if (!stored) return DEFAULT_LAYOUT;
  try {
    const value = JSON.parse(stored) as Partial<Layout>;
    const w = value.widths;
    const valid =
      Array.isArray(w) &&
      w.length === 3 &&
      w.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= MIN_PERCENT) &&
      Math.abs(w.reduce((s, n) => s + n, 0) - 100) < 0.5;
    return {
      widths: valid ? (w as Widths) : DEFAULT_LAYOUT.widths,
      collapsed: {
        transcript: value.collapsed?.transcript === true,
        questions: value.collapsed?.questions === true,
      },
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}
