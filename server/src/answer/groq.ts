import type { FastifyBaseLogger } from 'fastify';
import { ProviderError, type AnswerProvider } from './types.ts';

export const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 60_000;

interface StreamChunk {
  choices?: { delta?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number } };
}

/** Streams a chat completion from Groq (OpenAI-compatible server-sent events). */
export function createGroqAnswer(opts: {
  apiKey: string;
  model: string;
  log: FastifyBaseLogger;
  fetch?: typeof fetch;
  /**
   * GPT-OSS reasoning effort. "medium" (default) caught wrong premises that "low" missed for about
   * 0.3 s more to the first word (docs/ANSWER_EVALUATION.md).
   */
  reasoningEffort?: 'low' | 'medium' | 'high';
}): AnswerProvider {
  const doFetch = opts.fetch ?? fetch;
  return async ({ messages, maxTokens, signal }) => {
    let res: Response;
    try {
      res = await doFetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: opts.model,
          messages,
          stream: true,
          temperature: 0.4,
          max_completion_tokens: maxTokens,
          // GPT-OSS models reason before answering (hidden; not needed in the answer).
          reasoning_effort: opts.reasoningEffort ?? 'medium',
          include_reasoning: false,
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
    } catch (err) {
      if (signal.aborted) throw err;
      opts.log.warn({ err: (err as Error).name }, 'groq answer request failed');
      throw new ProviderError('provider_unavailable', 'Could not reach Groq.');
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? 60);
      opts.log.warn({ retryAfter }, 'groq answers rate limited');
      throw new ProviderError(
        'quota_exhausted',
        `Groq free-tier limit reached; try again in about ${Math.ceil(retryAfter)} s. Metor will not switch to a paid service.`,
      );
    }
    if (!res.ok || !res.body) {
      opts.log.warn({ status: res.status }, 'groq answer error response');
      throw new ProviderError('provider_unavailable', `Groq returned HTTP ${res.status}.`);
    }

    let resolveUsage: (u: { promptTokens: number; completionTokens: number } | null) => void = () => {};
    const usage = new Promise<{ promptTokens: number; completionTokens: number } | null>((r) => (resolveUsage = r));
    const body = res.body;

    async function* chunks(): AsyncGenerator<string> {
      const decoder = new TextDecoder();
      let buffer = '';
      let reported: { promptTokens: number; completionTokens: number } | null = null;
      try {
        for await (const bytes of body) {
          buffer += decoder.decode(bytes, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            for (const line of event.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (data === '[DONE]') continue;
              let chunk: StreamChunk;
              try {
                chunk = JSON.parse(data) as StreamChunk;
              } catch {
                continue;
              }
              // Usage location isn't documented for streams; accept either place.
              const u = chunk.x_groq?.usage ?? chunk.usage;
              if (u?.prompt_tokens !== undefined && u.completion_tokens !== undefined) {
                reported = { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens };
              }
              const text = chunk.choices?.[0]?.delta?.content;
              if (text) yield text;
            }
          }
        }
      } finally {
        resolveUsage(reported);
      }
    }

    return { chunks: chunks(), usage, model: opts.model };
  };
}
