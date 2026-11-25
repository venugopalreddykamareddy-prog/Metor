import type { ErrorCode } from '../../../shared/messages.ts';

/** Receives transcript events from a speech-to-text stream. */
export interface TranscriptSink {
  partial(text: string): void;
  final(text: string, startMs: number, endMs: number, latencyMs?: number): void;
  /** A problem the user should see; the stream keeps running. */
  error(code: ErrorCode, message: string): void;
}

/** One live transcription stream. */
export interface SttStream {
  /** `atMs` is the frame's position on the session timeline (seq × frame length). */
  push(samples: Int16Array, atMs: number): void;
  /** Turn the current partial into a final (end of speech or stop). */
  finalizeNow(): void;
  /** Drop the current partial without finalizing it (connection lost). */
  discardPartial(): void;
  /** Resolves when queued and in-flight transcription has finished (Stop waits for it, bounded). */
  flush?(): Promise<void>;
  /** Logout, expiry or end of session: drop queued work and abort requests in flight. */
  dispose?(): void;
}

export interface SttOptions {
  /** Profile terms for the Whisper prompt (spelling hints only). */
  vocabulary?: string[];
}

export type SttFactory = (sink: TranscriptSink, options?: SttOptions) => SttStream;
