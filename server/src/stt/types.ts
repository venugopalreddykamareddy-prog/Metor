/** Receives transcript events from a speech-to-text stream. */
export interface TranscriptSink {
  partial(text: string): void;
  final(text: string, startMs: number, endMs: number): void;
}

/** One live transcription stream. Phase 3 adds a Groq implementation behind the same shape. */
export interface SttStream {
  /** `atMs` is the frame's position on the session timeline (seq × frame length). */
  push(samples: Int16Array, atMs: number): void;
  /** Turn the current partial into a final (end of speech or stop). */
  finalizeNow(): void;
  /** Drop the current partial without finalizing it (connection lost). */
  discardPartial(): void;
}

export type SttFactory = (sink: TranscriptSink) => SttStream;
