import type { ServerMessage } from '../../../shared/messages.ts';

/** Raw recognizer output, exactly as received. The cleaned view is derived from it (cleanTranscript.ts). */
export type TranscriptLine =
  | { kind: 'final'; key: string; finalSeq: number; text: string; startMs: number; endMs: number }
  | { kind: 'gap'; key: string; seconds: number };

export interface Transcript {
  lines: TranscriptLine[];
  partial: string | null;
  lastFinalSeq: number;
}

export const emptyTranscript: Transcript = { lines: [], partial: null, lastFinalSeq: 0 };

export type TranscriptMessage = Extract<
  ServerMessage,
  { type: 'transcript.partial' | 'transcript.final' | 'transcript.gap' }
>;

export function applyTranscript(state: Transcript, msg: TranscriptMessage): Transcript {
  switch (msg.type) {
    case 'transcript.partial':
      return { ...state, partial: msg.text || null };
    case 'transcript.final': {
      // Finals can be replayed after a reconnect; keep each one once.
      if (msg.finalSeq <= state.lastFinalSeq) return state;
      const line: TranscriptLine = {
        kind: 'final',
        key: `f${msg.finalSeq}`,
        finalSeq: msg.finalSeq,
        text: msg.text,
        startMs: msg.startMs,
        endMs: msg.endMs,
      };
      return { lines: [...state.lines, line], partial: null, lastFinalSeq: msg.finalSeq };
    }
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

/** Clear Transcript keeps lastFinalSeq so replayed finals don't reappear. */
export function clearTranscript(state: Transcript): Transcript {
  return { lines: [], partial: null, lastFinalSeq: state.lastFinalSeq };
}

/** The raw text, fragments joined with spaces. */
export function transcriptText(state: Transcript): string {
  return state.lines.flatMap((l) => (l.kind === 'final' ? [l.text] : [])).join(' ');
}

/**
 * Whether a server transcript message belongs on screen: the current recording's, or the one just
 * stopped while its last segment finishes. Once another recording starts, late text from the old
 * one is dropped so the two never mix. Messages without a sessionId (older servers) are accepted.
 */
export function acceptsTranscript(msgSessionId: string | undefined, current: string | null, finishing: string | null): boolean {
  return msgSessionId === undefined || msgSessionId === current || msgSessionId === finishing;
}
