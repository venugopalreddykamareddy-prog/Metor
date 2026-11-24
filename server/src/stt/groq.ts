import type { FastifyBaseLogger } from 'fastify';
import { FRAME_MS } from '../../../shared/audio.ts';
import { levelDb } from '../../../shared/messages.ts';
import { WHISPER_PROMPT } from '../../../shared/vocabulary.ts';
import type { UsageLedger } from '../limits/usageLedger.ts';
import type { SttFactory, SttStream, TranscriptSink } from './types.ts';
import { encodeWav } from './wav.ts';

export const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// Segment sizing (ARCHITECTURE §4.3). Groq bills each request as at least 10 s of audio, so
// segments close at a pause only once they hold 8 s; up to 2 short ones a minute may close after
// a longer pause so short answers don't wait.
export const MIN_SEGMENT_MS = 8000;
export const MAX_SEGMENT_MS = 30_000;
const END_PAUSE_MS = 700;
const SHORT_END_PAUSE_MS = 1500;
const SHORT_SEGMENTS_PER_MINUTE = 2;
const MIN_SPEECH_MS = 300;
const PRE_ROLL_FRAMES = 3;
const BILLED_MIN_SECONDS = 10;
const REQUEST_TIMEOUT_MS = 20_000;
/** Whisper segments more likely silence than speech are dropped (it invents text on silence). */
const MAX_NO_SPEECH_PROB = 0.6;
const HALLUCINATIONS = /^(thank you|thanks for watching|thank you for watching|you|bye)[.!]?$/i;

interface GroqResponse {
  text?: string;
  segments?: { text: string; no_speech_prob?: number }[];
}

export interface GroqOptions {
  apiKey: string;
  model: string;
  ledger: UsageLedger;
  log: FastifyBaseLogger;
  fetch?: typeof fetch;
}

/** Simple energy-based voice detection with a slowly adapting noise floor. */
class VoiceDetector {
  private noiseFloorDb = -60;

  isSpeech(samples: Int16Array): boolean {
    let sumSquares = 0;
    for (const s of samples) sumSquares += s * s;
    const level = levelDb(sumSquares, samples.length);
    const speech = level > Math.max(-50, this.noiseFloorDb + 12);
    // Drop quickly to quieter levels, rise slowly, so steady background noise becomes the floor.
    this.noiseFloorDb = level < this.noiseFloorDb ? level : this.noiseFloorDb + (level - this.noiseFloorDb) * 0.02;
    return speech;
  }
}

export function createGroqStt(opts: GroqOptions): SttFactory {
  const doFetch = opts.fetch ?? fetch;

  return (sink: TranscriptSink): SttStream => {
    const vad = new VoiceDetector();
    let frames: Int16Array[] = [];
    let preRoll: Int16Array[] = [];
    let startMs = 0;
    let speechMs = 0;
    let silenceMs = 0;
    let shortCloses: number[] = [];
    let blockedUntil = 0;
    let queue = Promise.resolve();

    const reset = () => {
      frames = [];
      speechMs = 0;
      silenceMs = 0;
    };

    const close = () => {
      const segment = { frames, startMs, endMs: startMs + frames.length * FRAME_MS, speechMs };
      reset();
      if (segment.speechMs < MIN_SPEECH_MS) {
        sink.partial('');
        return;
      }
      const closedAt = Date.now();
      queue = queue.then(() => upload(segment, closedAt));
    };

    const upload = async (
      segment: { frames: Int16Array[]; startMs: number; endMs: number; speechMs: number },
      closedAt: number,
    ) => {
      const durationS = (segment.endMs - segment.startMs) / 1000;
      if (Date.now() < blockedUntil) {
        sink.partial('');
        return;
      }
      if (!opts.ledger.reserve({ requests: 1, units: Math.max(BILLED_MIN_SECONDS, Math.ceil(durationS)) })) {
        sink.partial('');
        sink.error('quota_exhausted', "Metor's Groq free-tier budget is used up for now. Switch to Simulated or Browser speech, or wait.");
        return;
      }

      const samples = new Int16Array(segment.frames.reduce((n, f) => n + f.length, 0));
      let offset = 0;
      for (const f of segment.frames) {
        samples.set(f, offset);
        offset += f.length;
      }
      const form = new FormData();
      form.append('file', new Blob([encodeWav(samples)], { type: 'audio/wav' }), 'segment.wav');
      form.append('model', opts.model);
      form.append('language', 'en');
      form.append('temperature', '0');
      form.append('response_format', 'verbose_json');
      form.append('prompt', WHISPER_PROMPT);

      let res: Response;
      try {
        res = await doFetch(GROQ_TRANSCRIPTIONS_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        opts.log.warn({ err: (err as Error).name, durationS }, 'groq request failed');
        sink.partial('');
        sink.error('provider_unavailable', 'Could not reach Groq. Transcription will retry with the next segment.');
        return;
      }
      const ms = Date.now() - closedAt;
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? 60);
        blockedUntil = Date.now() + retryAfter * 1000;
        opts.log.warn({ retryAfter }, 'groq rate limited');
        sink.partial('');
        sink.error('quota_exhausted', `Groq free-tier limit reached; try again in about ${Math.ceil(retryAfter)} s. Metor will not switch to a paid service.`);
        return;
      }
      if (!res.ok) {
        opts.log.warn({ status: res.status, durationS }, 'groq error response');
        sink.partial('');
        sink.error('provider_unavailable', `Groq returned HTTP ${res.status}.`);
        return;
      }
      const body = (await res.json()) as GroqResponse;
      const parts = body.segments
        ? body.segments.filter((s) => (s.no_speech_prob ?? 0) < MAX_NO_SPEECH_PROB).map((s) => s.text)
        : [body.text ?? ''];
      // Raw Whisper text; term fixes and cleanup happen in the client's cleaned view.
      let text = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (segment.speechMs < 1500 && HALLUCINATIONS.test(text)) text = '';
      // The request limit header shows which plan's limits the account really has.
      const planRequestsPerDay = res.headers.get('x-ratelimit-limit-requests');
      opts.log.info({ durationS, latencyMs: ms, chars: text.length, planRequestsPerDay }, 'groq transcribed segment');
      if (text) sink.final(text, segment.startMs, segment.endMs, ms);
      else sink.partial('');
    };

    return {
      push(samples, atMs) {
        const speech = vad.isSpeech(samples);
        if (frames.length === 0) {
          if (!speech) {
            // Keep a little audio from before speech starts so the first word isn't clipped.
            preRoll = [...preRoll, samples].slice(-PRE_ROLL_FRAMES);
            return;
          }
          frames = preRoll;
          startMs = atMs - preRoll.length * FRAME_MS;
          preRoll = [];
          sink.partial('…');
        }
        frames.push(samples);
        if (speech) {
          speechMs += FRAME_MS;
          silenceMs = 0;
        } else {
          silenceMs += FRAME_MS;
        }
        const lengthMs = frames.length * FRAME_MS;
        const now = Date.now();
        shortCloses = shortCloses.filter((t) => now - t < 60_000);
        if (lengthMs >= MAX_SEGMENT_MS || (lengthMs >= MIN_SEGMENT_MS && silenceMs >= END_PAUSE_MS)) {
          close();
        } else if (silenceMs >= SHORT_END_PAUSE_MS && shortCloses.length < SHORT_SEGMENTS_PER_MINUTE) {
          shortCloses.push(now);
          close();
        }
      },
      finalizeNow() {
        if (frames.length > 0) close();
      },
      discardPartial() {
        reset();
        preRoll = [];
      },
    };
  };
}
