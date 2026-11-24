import type { FastifyBaseLogger } from 'fastify';
import { AnswerStreamParser } from '../../../shared/answerFormat.ts';
import type { AnswerEngine, ServerMessageBody } from '../../../shared/messages.ts';
import type { UsageLedger } from '../limits/usageLedger.ts';
import { MAX_COMPLETION_TOKENS, buildMessages, estimateTokens, type AnswerRequest } from './prompt.ts';
import { ProviderError, type AnswerProvider } from './types.ts';

const REMEMBERED_QUESTION_IDS = 200;

export interface AnswerDeps {
  providers: Partial<Record<AnswerEngine, AnswerProvider>>;
  /** Free-tier token ledger for Groq; null when Groq isn't configured. */
  ledger: UsageLedger | null;
  maxAnswers: number;
  log: FastifyBaseLogger;
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
    if (this.answered >= this.deps.maxAnswers) return fail('limit_reached', 'Answer limit for this session reached.');

    if (this.inFlight) this.cancel(this.inFlight.questionId, 'Replaced by a newer question.');

    const messages = buildMessages(req);
    const maxTokens = MAX_COMPLETION_TOKENS[req.length];
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
      const forward = (events: ReturnType<AnswerStreamParser['push']>) => {
        for (const e of events) {
          if (e.kind === 'header') {
            this.send({ type: 'answer.header', questionId: req.questionId, ...e.header });
          } else if (e.text) {
            firstTokenMs ??= Date.now() - started;
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
      if (ticket !== null && usage) this.deps.ledger?.settle(ticket, reserved, usage.promptTokens + usage.completionTokens);
      const totalMs = Date.now() - started;
      this.deps.log.info(
        { questionId: req.questionId, engine: req.engine, firstTokenMs, totalMs, tokens: usage },
        'answer streamed',
      );
      this.send({ type: 'answer.done', questionId: req.questionId, model: stream.model, firstTokenMs, totalMs, usage });
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
