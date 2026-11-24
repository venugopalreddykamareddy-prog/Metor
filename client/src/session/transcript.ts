import type { ServerMessage } from '../../../shared/messages.ts';

export type TranscriptLine =
  | { kind: 'final'; key: string; finalSeq: number; text: string }
  | { kind: 'gap'; key: string; seconds: number };

export interface Transcript {
  lines: TranscriptLine[];
  partial: string | null;
  lastFinalSeq: number;
}

export const emptyTranscript: Transcript = { lines: [], partial: null, lastFinalSeq: 0 };

type TranscriptMessage = Extract<ServerMessage, { type: 'transcript.partial' | 'transcript.final' | 'transcript.gap' }>;

export function applyTranscript(state: Transcript, msg: TranscriptMessage): Transcript {
  switch (msg.type) {
    case 'transcript.partial':
      return { ...state, partial: msg.text };
    case 'transcript.final':
      // Finals can be replayed after a reconnect; keep each one once.
      if (msg.finalSeq <= state.lastFinalSeq) return state;
      return {
        lines: [...state.lines, { kind: 'final', key: `f${msg.finalSeq}`, finalSeq: msg.finalSeq, text: msg.text }],
        partial: null,
        lastFinalSeq: msg.finalSeq,
      };
    case 'transcript.gap':
      return {
        ...state,
        lines: [...state.lines, { kind: 'gap', key: `g${msg.fromMs}`, seconds: (msg.toMs - msg.fromMs) / 1000 }],
      };
  }
}

/** Partials from before a disconnect are stale once the session resumes. */
export function dropPartial(state: Transcript): Transcript {
  return state.partial === null ? state : { ...state, partial: null };
}
