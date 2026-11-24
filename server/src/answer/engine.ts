import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { AnswerStreamParser, type AnswerHeader } from '../../../shared/answerFormat.ts';
import { normalizeQuestion } from '../../../shared/extract.ts';
import type { AnswerEngine, AnswerLength, ServerMessageBody } from '../../../shared/messages.ts';
import type { UsageLedger } from '../limits/usageLedger.ts';
import { MAX_COMPLETION_TOKENS, buildMessages, estimateTokens, type AnswerRequest } from './prompt.ts';
import type { AnswerStats } from './stats.ts';
import { ProviderError, type AnswerProvider } from './types.ts';

const REMEMBERED_QUESTION_IDS = 200;
/** Finished answers kept per connection for reuse; memory only, gone on disconnect or logout. */
const CACHE_ENTRIES = 50;
const CACHE_TTL_MS = 30 * 60_000;

interface CachedAnswer {
  header: AnswerHeader;
  text: string;
  model: string;
  at: number;
}

/**
 * Same engine, length, question words, and the context actually sent (statements, turns, earlier
 * topics, raw text) → same answer. The client sends turns only when the question needs them.
 */
export function cacheKey(req: AnswerRequest): string {
  const parts = [req.engine, req.length, normalizeQuestion(req.question), req.heard ?? '', req.statements, req.turns, req.earlier ?? [], req.isFollowUp];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export interface AnswerDeps {
  providers: Partial<Record<AnswerEngine, AnswerProvider>>;
  /** Free-tier token ledger for Groq; null when Groq isn't configured. */
  ledger: UsageLedger | null;
  maxAnswers: number;
  log: FastifyBaseLogger;
  /** Completion-token budgets per engine and length (default MAX_COMPLETION_TOKENS). */
  maxTokens?: Partial<Record<AnswerEngine, Record<AnswerLength, number>>>;
  stats?: AnswerStats;
}

/**
 * Answers for one WebSocket connection. One answer streams at a time: a new question cancels the
 * one in flight. Each questionId is answered once; regenerating uses a new id (ARCHITECTURE §6.3).
 */
export class AnswerSession {
  private readonly deps: AnswerDeps;
  private readonly send: (body: ServerMessageBody) => void;
  private readonly seen: string[] = [];
  private inFlight: { questionId: string; controller: AbortController } | null = null;
  private answered = 0;
  private readonly cache = new Map<string, CachedAnswer>();

  constructor(deps: AnswerDeps, send: (body: ServerMessageBody) => void) {
    this.deps = deps;
    this.send = send;
  }

  async handle(req: AnswerRequest): Promise<void> {
    const fail = (code: Extract<ServerMessageBody, { type: 'answer.failed' }>['code'], message: string) =>
      this.send({ type: 'answer.failed', questionId: req.questionId, code, message });

    if (this.seen.includes(req.questionId)) return fail('duplicate', 'This question was already answered.');
    this.seen.push(req.questionId);
    if (this.seen.length > REMEMBERED_QUESTION_IDS) this.seen.shift();

    const provider = this.deps.providers[req.engine];
    if (!provider) return fail('provider_unavailable', `${req.engine} isn't configured on the server.`);

    if (this.inFlight) this.cancel(this.inFlight.questionId, 'Replaced by a newer question.');

    const key = cacheKey(req);
    const hit = this.cache.get(key);
    if (hit && !req.fresh && Date.now() - hit.at < CACHE_TTL_MS) {
      // Same question and context: replay without a provider request or quota.
      this.deps.stats?.recordCached(req.engine);
      this.send({ type: 'answer.header', questionId: req.questionId, ...hit.header });
      this.send({ type: 'answer.delta', questionId: req.questionId, text: hit.text });
      this.send({ type: 'answer.done', questionId: req.questionId, model: hit.model, firstTokenMs: 0, totalMs: 0, usage: null, truncated: false, cached: true });
      return;
    }
    if (this.answered >= this.deps.maxAnswers) return fail('limit_reached', 'Answer limit for this session reached.');

    const messages = buildMessages(req);
    const maxTokens = (this.deps.maxTokens?.[req.engine] ?? MAX_COMPLETION_TOKENS)[req.length];
    const reserved = estimateTokens(messages) + maxTokens;
    const usesQuota = req.engine !== 'simulated';
    let ticket: number | null = null;
    if (usesQuota) {
      ticket = this.deps.ledger?.reserveTicket({ requests: 1, units: reserved }) ?? null;
      if (ticket === null) {
        return fail('quota_exhausted', "Metor's Groq free-tier budget is used up for now. Try again shortly or use Simulated.");
      }
    }

    this.answered += 1;
    const controller = new AbortController();
    this.inFlight = { questionId: req.questionId, controller };
    const started = Date.now();
    let firstTokenMs: number | null = null;

    try {
      const stream = await provider({ request: req, messages, maxTokens, signal: controller.signal });
      const parser = new AnswerStreamParser();
      let header: AnswerHeader | null = null;
      let text = '';
      const forward = (events: ReturnType<AnswerStreamParser['push']>) => {
        for (const e of events) {
          if (e.kind === 'header') {
            header = e.header;
            this.send({ type: 'answer.header', questionId: req.questionId, ...e.header });
          } else if (e.text) {
            firstTokenMs ??= Date.now() - started;
            text += e.text;
            this.send({ type: 'answer.delta', questionId: req.questionId, text: e.text });
          }
        }
      };
      for await (const chunk of stream.chunks) {
        if (controller.signal.aborted) break;
        forward(parser.push(chunk));
      }
      if (controller.signal.aborted) return;
      forward(parser.end());
      const usage = await stream.usage;
      const truncated = (await stream.truncated) ?? false;
      if (ticket !== null && usage) this.deps.ledger?.settle(ticket, reserved, usage.promptTokens + usage.completionTokens);
      this.deps.stats?.record(req.engine, usage, truncated);
      if (firstTokenMs === null) {
        // Header only, or nothing: the model spent its budget reasoning. Say so instead of an empty card.
        this.deps.log.warn({ questionId: req.questionId, engine: req.engine, tokens: usage }, 'answer had no text');
        return fail('provider_unavailable', 'The model returned no answer text (it may have run out of tokens while reasoning). Try Regenerate.');
      }
      const totalMs = Date.now() - started;
      this.deps.log.info(
        { questionId: req.questionId, engine: req.engine, firstTokenMs, totalMs, tokens: usage, truncated },
        'answer streamed',
      );
      // A cut-off answer isn't worth reusing.
      if (header && !truncated) this.remember(key, { header, text: text.trim(), model: stream.model, at: Date.now() });
      this.send({ type: 'answer.done', questionId: req.questionId, model: stream.model, firstTokenMs, totalMs, usage, truncated, cached: false });
    } catch (err) {
      if (controller.signal.aborted) return; // cancel() already told the client
      // Usage is unknown after a failure, so the reservation stays charged (ARCHITECTURE §11.1).
      if (err instanceof ProviderError) fail(err.code, err.message);
      else {
        this.deps.log.warn({ err: (err as Error).name, engine: req.engine }, 'answer failed');
        fail('provider_unavailable', 'The answer could not be generated.');
      }
    } finally {
      if (this.inFlight?.controller === controller) this.inFlight = null;
    }
  }

  private remember(key: string, entry: CachedAnswer): void {
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
  }

  cancel(questionId: string, message = 'Cancelled.'): void {
    if (this.inFlight?.questionId !== questionId) return;
    this.inFlight.controller.abort();
    this.inFlight = null;
    this.send({ type: 'answer.failed', questionId, code: 'cancelled', message });
  }

  /** Connection closed or login ended. */
  close(): void {
    this.inFlight?.controller.abort();
    this.inFlight = null;
  }
}
