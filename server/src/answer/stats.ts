import type { AnswerEngine } from '../../../shared/messages.ts';
import type { TokenUsage } from './types.ts';

interface EngineTotals {
  /** Provider requests that finished. */
  answers: number;
  /** Of those, how many reported usage (the averages use only these). */
  withUsage: number;
  promptTokens: number;
  completionTokens: number;
  /** Summed only over answers whose provider reported a reasoning count. */
  reasoningTokens: number;
  withReasoning: number;
  truncated: number;
  /** Answers replayed from the cache: no provider request. */
  cached: number;
}

/** Token counts per answer engine since the server started (memory only, no question text). */
export class AnswerStats {
  private readonly totals = new Map<AnswerEngine, EngineTotals>();

  private get(engine: AnswerEngine): EngineTotals {
    let t = this.totals.get(engine);
    if (!t) {
      t = { answers: 0, withUsage: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, withReasoning: 0, truncated: 0, cached: 0 };
      this.totals.set(engine, t);
    }
    return t;
  }

  record(engine: AnswerEngine, usage: TokenUsage | null, truncated: boolean): void {
    const t = this.get(engine);
    t.answers += 1;
    if (truncated) t.truncated += 1;
    if (!usage) return;
    t.withUsage += 1;
    t.promptTokens += usage.promptTokens;
    t.completionTokens += usage.completionTokens;
    if (usage.reasoningTokens !== null) {
      t.reasoningTokens += usage.reasoningTokens;
      t.withReasoning += 1;
    }
  }

  recordCached(engine: AnswerEngine): void {
    this.get(engine).cached += 1;
  }

  snapshot() {
    const avg = (sum: number, n: number) => (n === 0 ? null : Math.round(sum / n));
    return Object.fromEntries(
      [...this.totals].map(([engine, t]) => [
        engine,
        {
          ...t,
          totalTokens: t.promptTokens + t.completionTokens,
          averagePerAnswer: {
            prompt: avg(t.promptTokens, t.withUsage),
            completion: avg(t.completionTokens, t.withUsage),
            reasoning: avg(t.reasoningTokens, t.withReasoning),
            total: avg(t.promptTokens + t.completionTokens, t.withUsage),
          },
        },
      ]),
    );
  }
}
