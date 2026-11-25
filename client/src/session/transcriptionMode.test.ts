import { describe, expect, it } from 'vitest';
import type { Usage } from '../api.ts';
import { leftToday, preferredMode, whisperQuotaLeft } from './transcriptionMode.ts';

const w = (requests: number, units: number) => ({ requests, units });
const metered = (dayUsed: number, dayLimit: number) => ({
  lastMinute: w(0, 0),
  lastHour: w(0, 0),
  lastDay: w(1, dayUsed),
  limits: { perMinute: w(20, 100), perHour: w(100, 1000), perDay: w(1000, dayLimit) },
  unit: 'x',
});
const usage = (sttUsed: number, answersUsed = 0): Usage => ({
  groq: { transcription: metered(sttUsed, 20_000), answers: metered(answersUsed, 160_000) },
});

describe('preferredMode', () => {
  it('prefers Groq Whisper when configured and within quota', () => {
    expect(preferredMode(['simulated', 'webspeech', 'groq'], true)).toBe('groq');
  });

  it('falls back to Browser speech when the Whisper quota is used up', () => {
    expect(preferredMode(['simulated', 'webspeech', 'groq'], false)).toBe('webspeech');
    expect(preferredMode(['simulated', 'groq'], false)).toBe('simulated');
  });

  it('stays Simulated without Groq (free-first default)', () => {
    expect(preferredMode(['simulated', 'webspeech'], true)).toBe('simulated');
  });
});

describe('whisperQuotaLeft', () => {
  it('reads the transcription ledger, not the answer ledger', () => {
    expect(whisperQuotaLeft(usage(5_000, 160_000))).toBe(true); // answers spent, audio left
    expect(whisperQuotaLeft(usage(20_000, 0))).toBe(false); // audio spent, answers left
  });

  it('treats unknown usage as room left (the server ledger still enforces)', () => {
    expect(whisperQuotaLeft(null)).toBe(true);
    expect(whisperQuotaLeft({ groq: null })).toBe(true);
  });
});

describe('leftToday', () => {
  it('never goes negative', () => {
    expect(leftToday(metered(25_000, 20_000))).toEqual({ requests: 999, units: 0 });
  });
});
