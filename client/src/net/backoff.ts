// ARCHITECTURE §6.3: 0.5 s → 8 s.

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 8000;

/**
 * Delay before reconnect attempt `attempt` (0-based). The ceiling doubles each attempt up to 8 s,
 * and the delay is a random 50–100% of it so many clients don't reconnect in lockstep.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(safeAttempt, 30));
  const r = Math.min(Math.max(random(), 0), 1);
  return Math.round(ceiling / 2 + (ceiling / 2) * r);
}
