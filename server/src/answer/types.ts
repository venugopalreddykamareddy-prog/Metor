import type { AnswerRequest, ChatMessage } from './prompt.ts';

/** Token counts as the provider reports them; reasoningTokens is null when not reported. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number | null;
}

/** A provider's streamed answer: raw text chunks (header + answer) and, if reported, token usage. */
export interface AnswerStream {
  chunks: AsyncIterable<string>;
  /** Resolves after the stream ends; null when the provider didn't report usage. */
  usage: Promise<TokenUsage | null>;
  /** Resolves after the stream ends: true when the completion-token budget cut the answer off. */
  truncated?: Promise<boolean>;
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
