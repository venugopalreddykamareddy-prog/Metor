import { describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { GROQ_CHAT_URL, createGroqAnswer } from './groq.ts';
import type { AnswerRequest } from './prompt.ts';
import { ProviderError } from './types.ts';

const log = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger;
const request = {} as AnswerRequest;

function sse(events: unknown[], split = 7): Response {
  const text = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(provider: ReturnType<typeof createGroqAnswer>) {
  const stream = await provider({ request, messages: [{ role: 'user', content: 'hi' }], maxTokens: 500, signal: new AbortController().signal });
  let text = '';
  for await (const chunk of stream.chunks) text += chunk;
  return { text, usage: await stream.usage, model: stream.model };
}

describe('Groq answer provider', () => {
  it('sends a streaming request with medium reasoning effort and hidden reasoning, and joins the deltas', async () => {
    let sent: { url: string; body: Record<string, unknown>; auth: string | null } | null = null;
    const provider = createGroqAnswer({
      apiKey: 'k',
      model: 'openai/gpt-oss-20b',
      log,
      fetch: (async (url: string, init: RequestInit) => {
        sent = { url, body: JSON.parse(String(init.body)) as Record<string, unknown>, auth: new Headers(init.headers).get('authorization') };
        return sse([
          { choices: [{ delta: { content: 'TYPE: technical\nASSESSMENT: none\n' } }] },
          { choices: [{ delta: { content: 'ANSWER:\nHello' } }] },
          { choices: [{ delta: { content: ' world.' } }] },
          { choices: [{ delta: {} }], x_groq: { usage: { prompt_tokens: 120, completion_tokens: 40 } } },
          '[DONE]',
        ]);
      }) as unknown as typeof fetch,
    });
    const result = await collect(provider);
    expect(result.text).toBe('TYPE: technical\nASSESSMENT: none\nANSWER:\nHello world.');
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 40 });
    expect(result.model).toBe('openai/gpt-oss-20b');
    expect(sent).toMatchObject({
      url: GROQ_CHAT_URL,
      auth: 'Bearer k',
      body: { model: 'openai/gpt-oss-20b', stream: true, max_completion_tokens: 500, reasoning_effort: 'medium', include_reasoning: false },
    });
  });

  it('reports null usage when the stream has none', async () => {
    const provider = createGroqAnswer({
      apiKey: 'k',
      model: 'm',
      log,
      fetch: (async () => sse([{ choices: [{ delta: { content: 'ANSWER: ok' } }] }, '[DONE]'])) as unknown as typeof fetch,
    });
    expect((await collect(provider)).usage).toBeNull();
  });

  it('turns 429 into quota_exhausted and other failures into provider_unavailable', async () => {
    const respond = (res: Response | Error) =>
      createGroqAnswer({
        apiKey: 'k',
        model: 'm',
        log,
        fetch: (async () => {
          if (res instanceof Error) throw res;
          return res;
        }) as unknown as typeof fetch,
      });
    await expect(collect(respond(new Response('', { status: 429, headers: { 'retry-after': '30' } })))).rejects.toMatchObject({
      code: 'quota_exhausted',
    });
    await expect(collect(respond(new Response('', { status: 503 })))).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(collect(respond(new TypeError('fetch failed')))).rejects.toBeInstanceOf(ProviderError);
  });
});
