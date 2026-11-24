import type { AnswerRequest, ChatMessage } from './prompt.ts';

/** A provider's streamed answer: raw text chunks (header + answer) and, if reported, token usage. */
export interface AnswerStream {
  chunks: AsyncIterable<string>;
  /** Resolves after the stream ends; null when the provider didn't report usage. */
  usage: Promise<{ promptTokens: number; completionTokens: number } | null>;
  model: string;
}

export type AnswerProvider = (input: {
  request: AnswerRequest;
  messages: ChatMessage[];
  maxTokens: number;
  signal: AbortSignal;
}) => Promise<AnswerStream>;

/** Thrown by providers for failures the user should see; never triggers a fallback. */
export class ProviderError extends Error {
  readonly code: 'quota_exhausted' | 'provider_unavailable';
  constructor(code: 'quota_exhausted' | 'provider_unavailable', message: string) {
    super(message);
    this.code = code;
  }
}
