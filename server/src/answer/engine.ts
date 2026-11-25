import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { AnswerStreamParser, ClarificationLimiter, isClarifyOnly, type AnswerHeader } from '../../../shared/answerFormat.ts';
import { normalizeQuestion } from '../../../shared/extract.ts';
import type { AnswerEngine, AnswerLength, ServerMessageBody } from '../../../shared/messages.ts';
import type { UsageLedger } from '../limits/usageLedger.ts';
import { MAX_COMPLETION_TOKENS, buildMessages, estimateTokens, type AnswerRequest } from './prompt.ts';
import type { AnswerStats } from './stats.ts';
import { ProviderError, type AnswerProvider } from './types.ts';

const REMEMBERED_QUESTION_IDS = 200;
const MAX_WAITING = 5;
/**
 * Engines allowed to receive resume and KB excerpts. A new engine must decide here; the Gemini free
 * tier never may (hard rule 11). Groq needs Zero Data Retention turned on by the owner (SECURITY_PRIVACY).
 */
const RECEIVES_PERSONAL_DATA: Record<AnswerEngine, boolean> = { simulated: true, 'groq-120b': true, 'groq-20b': true };
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
  const parts = [req.engine, req.length, normalizeQuestion(req.question), req.heard ?? '', req.statements, req.turns, req.earlier ?? [], req.isFollowUp, req.kb ?? [], req.profile ?? null, req.practice ?? null];
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
 * Answers for one WebSocket connection. One answer streams at a time; others wait their turn. Each questionId is answered once; regenerating uses a new id (ARCHITECTURE §6.3).
 */
export class AnswerSession {
  private readonly deps: AnswerDeps;
  private readonly send: (body: ServerMessageBody) => void;
  private readonly seen: string[] = [];
  private inFlight: { questionId: string; controller: AbortController } | null = null;
  private answered = 0;
  /** Questions queued behind the one in flight, in order. */
  private readonly waiting = new Set<string>();
  private chain: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly cache = new Map<string, CachedAnswer>();

  constructor(deps: AnswerDeps, send: (body: ServerMessageBody) => void) {
    this.deps = deps;
    this.send = send;
  }

  /**
   * Questions are answered one at a time, in order: several detected together each get an answer.
   * Only `replace` (the user typed a new question) or answer.cancel stops one early.
   */
  handle(req: AnswerRequest): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.seen.includes(req.questionId)) {
      this.send({ type: 'answer.failed', questionId: req.questionId, code: 'duplicate', message: 'This question was already answered.' });
      return Promise.resolve();
    }
    this.seen.push(req.questionId);
    if (this.seen.length > REMEMBERED_QUESTION_IDS) this.seen.shift();
    if (req.replace) {
      for (const id of [...this.waiting]) this.cancel(id, 'Replaced by a newer question.');
      if (this.inFlight) this.cancel(this.inFlight.questionId, 'Replaced by a newer question.');
    }
    if (this.waiting.size >= MAX_WAITING) {
      this.send({ type: 'answer.failed', questionId: req.questionId, code: 'limit_reached', message: 'Too many questions waiting for an answer.' });
      return Promise.resolve();
    }
    this.waiting.add(req.questionId);
    const run = this.chain.then(() => (this.waiting.delete(req.questionId) ? this.answer(req) : undefined));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async answer(req: AnswerRequest): Promise<void> {
    const fail = (code: Extract<ServerMessageBody, { type: 'answer.failed' }>['code'], message: string) =>
      this.send({ type: 'answer.failed', questionId: req.questionId, code, message });

    // KB excerpts are personal data: only engines cleared for it may receive them (FR-K4).
    if (req.kb?.length && !RECEIVES_PERSONAL_DATA[req.engine]) {
      return fail('provider_unavailable', `${req.engine} may not receive knowledge-base content.`);
    }
    const provider = this.deps.providers[req.engine];
    if (!provider) return fail('provider_unavailable', `${req.engine} isn't configured on the server.`);

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
    // Registered before any wait, so Stop answer, a typed replacement or logout during the quota
    // write still prevents the provider request.
    const controller = new AbortController();
    this.inFlight = { questionId: req.questionId, controller };
    let started = Date.now();
    let firstTokenMs: number | null = null;

    try {
      if (usesQuota) {
        // Durable before the request: a failed ledger write means no provider call (fail closed).
        const r = this.deps.ledger ? await this.deps.ledger.reserveDurable({ requests: 1, units: reserved }) : ({ ok: false, reason: 'quota' } as const);
        if (r.ok) ticket = r.ticket;
        if (controller.signal.aborted || this.closed) {
          // Cancelled while reserving: no request was made, so no tokens were used.
          if (r.ok) this.deps.ledger?.settle(r.ticket, reserved, 0);
          return;
        }
        if (!r.ok && r.reason === 'storage') {
          return fail('provider_unavailable', "Metor couldn't record quota usage, so it didn't call Groq. Check the server's data folder.");
        }
        if (!r.ok) return fail('quota_exhausted', "Metor's Groq free-tier budget is used up for now. Try again shortly or use Simulated.");
      }
      this.answered += 1;
      started = Date.now(); // first-word timing starts at the provider request, as before

      // Every wait is raced with cancellation, so a provider that ignores the abort can't hold the queue.
      const cancelled = new Promise<null>((r) => controller.signal.addEventListener('abort', () => r(null), { once: true }));
      const stream = await Promise.race([provider({ request: req, messages, maxTokens, signal: controller.signal }), cancelled]);
      if (!stream) return;
      const parser = new AnswerStreamParser();
      let header: AnswerHeader | null = null;
      let text = '';
      // Unknown terms and unclear acronyms get only a clarification (ARCHITECTURE §5.4).
      const clip: { limiter: ClarificationLimiter | null } = { limiter: null };
      const emit = (t: string) => {
        if (!t) return;
        firstTokenMs ??= Date.now() - started;
        text += t;
        this.send({ type: 'answer.delta', questionId: req.questionId, text: t });
      };
      const forward = (events: ReturnType<AnswerStreamParser['push']>) => {
        for (const e of events) {
          if (e.kind === 'header') {
            header = e.header;
            // Practice feedback is never clipped: its header judges the question, not the reply.
            if (isClarifyOnly(e.header.assessment) && !req.practice) clip.limiter = new ClarificationLimiter(e.header.clarify);
            this.send({ type: 'answer.header', questionId: req.questionId, ...e.header });
          } else {
            emit(clip.limiter ? clip.limiter.push(e.text) : e.text);
          }
        }
      };
      const reader = stream.chunks[Symbol.asyncIterator]();
      for (;;) {
        const next = await Promise.race([reader.next(), cancelled]);
        if (!next || next.done || controller.signal.aborted) break;
        forward(parser.push(next.value));
      }
      if (controller.signal.aborted) {
        void reader.return?.(undefined).catch(() => undefined);
        return;
      }
      forward(parser.end());
      // The stream is still read to the end, so the ledger settles on the reported usage.
      const clipped = clip.limiter?.finished ?? false;
      if (clip.limiter) emit(clip.limiter.end());
      const usage = await stream.usage;
      // A clarification cut short on purpose is complete, even if the model ran on to the budget.
      const modelTruncated = (await stream.truncated) ?? false;
      const truncated = !clipped && modelTruncated;
      if (ticket !== null && usage) this.deps.ledger?.settle(ticket, reserved, usage.promptTokens + usage.completionTokens);
      this.deps.stats?.record(req.engine, usage, modelTruncated);
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
    if (this.waiting.delete(questionId)) {
      this.send({ type: 'answer.failed', questionId, code: 'cancelled', message });
      return;
    }
    if (this.inFlight?.questionId !== questionId) return;
    this.inFlight.controller.abort();
    this.inFlight = null;
    this.send({ type: 'answer.failed', questionId, code: 'cancelled', message });
  }

  /** Connection closed or login ended. */
  close(): void {
    this.closed = true;
    this.waiting.clear();
    this.inFlight?.controller.abort();
    this.inFlight = null;
  }
}
