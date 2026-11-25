import type { Usage } from '../api.ts';
import type { TranscriptionMode } from './useRecorder.ts';

/**
 * Whether today's Groq transcription budget has room left. It's tracked apart from answer tokens
 * (audio seconds, its own ledger). Unknown usage counts as room: the server's ledger still refuses
 * a request that doesn't fit.
 */
export function whisperQuotaLeft(usage: Usage | null): boolean {
  const t = usage?.groq?.transcription;
  if (!t) return true;
  return t.lastDay.units < t.limits.perDay.units && t.lastDay.requests < t.limits.perDay.requests;
}

/**
 * The preselected mode when the user hasn't picked one: Groq Whisper when configured and within
 * its free quota (better accuracy and question separation in the owner's benchmark,
 * docs/STT_EVALUATION.md), then Browser speech as the fallback. Without Groq the default stays
 * Simulated (free-first). Preselecting never starts anything: every recording still needs the
 * consent dialog, which names the provider.
 */
export function preferredMode(available: readonly TranscriptionMode[], quotaLeft: boolean): TranscriptionMode {
  if (!available.includes('groq')) return 'simulated';
  if (quotaLeft) return 'groq';
  return available.includes('webspeech') ? 'webspeech' : 'simulated';
}

/** Daily budget left for one ledger, for the status line. */
export function leftToday(m: { lastDay: { requests: number; units: number }; limits: { perDay: { requests: number; units: number } } }) {
  return {
    requests: Math.max(0, m.limits.perDay.requests - m.lastDay.requests),
    units: Math.max(0, m.limits.perDay.units - m.lastDay.units),
  };
}
