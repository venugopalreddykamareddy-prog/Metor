// Message schemas for /ws (ARCHITECTURE §6.2). JSON messages are { type, id, ts, ...payload }.
// Audio travels as binary frames: 4-byte big-endian sequence number + PCM16 mono samples.
import { z } from 'zod';
import { FRAME_SAMPLES } from './audio.ts';

export { FRAME_MS, FRAME_SAMPLES, SAMPLE_RATE } from './audio.ts';
export const AUDIO_HEADER_BYTES = 4;
/** Max WebSocket frame size accepted by the server, in bytes. */
export const MAX_PAYLOAD_BYTES = 16 * 1024;

/** Close code the server uses when the login session ends (logout or expiry). */
export const CLOSE_AUTH_ENDED = 4401;

const envelope = {
  id: z.string().min(1).max(64),
  ts: z.number().int().nonnegative(),
};
const sessionId = z.uuid();

// Client → server
export const clientMessageSchema = z.discriminatedUnion('type', [
  // Web Speech runs in the browser, so only server-side transcription modes start a session here.
  z.strictObject({ type: z.literal('session.start'), ...envelope, mode: z.enum(['simulated', 'groq']), source: z.literal('mic') }),
  z.strictObject({ type: z.literal('session.resume'), ...envelope, sessionId, lastFinalSeq: z.number().int().min(0) }),
  z.strictObject({ type: z.literal('session.stop'), ...envelope }),
]);

// Server → client
export const errorCodeSchema = z.enum([
  'bad_request',
  'no_session',
  'session_expired',
  'rate_limited',
  'limit_reached',
  'quota_exhausted',
  'provider_unavailable',
]);

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('session.started'), ...envelope, sessionId }),
  z.strictObject({ type: z.literal('session.resumed'), ...envelope, sessionId, nextAudioSeq: z.number().int().min(0) }),
  z.strictObject({ type: z.literal('audio.ack'), ...envelope, seq: z.number().int().min(0) }),
  // What the server received in the last second; levelDb is the RMS level (-100 = silence, 0 = full scale).
  z.strictObject({
    type: z.literal('audio.stats'),
    ...envelope,
    frames: z.number().int().min(0),
    bytes: z.number().int().min(0),
    levelDb: z.number().min(-100).max(0),
  }),
  z.strictObject({ type: z.literal('transcript.partial'), ...envelope, segmentId: z.string(), text: z.string() }),
  z.strictObject({
    type: z.literal('transcript.final'),
    ...envelope,
    segmentId: z.string(),
    finalSeq: z.number().int().min(1),
    text: z.string(),
    startMs: z.number().min(0),
    endMs: z.number().min(0),
    /** Time from the end of the audio segment to this final, when the provider measures it. */
    latencyMs: z.number().min(0).optional(),
  }),
  z.strictObject({ type: z.literal('transcript.gap'), ...envelope, fromMs: z.number().min(0), toMs: z.number().min(0) }),
  z.strictObject({
    type: z.literal('error'),
    ...envelope,
    code: errorCodeSchema,
    message: z.string().max(200),
    retryable: z.boolean(),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Distributes Omit over a union, so each message type keeps its own fields. */
type OmitEnvelope<T> = T extends unknown ? Omit<T, 'id' | 'ts'> : never;
export type ClientMessageBody = OmitEnvelope<ClientMessage>;
export type ServerMessageBody = OmitEnvelope<ServerMessage>;

/**
 * `error` may quote user input (zod names unrecognized keys), so it is only sent back to the
 * sender. `issue` is a fixed code that is safe to log.
 */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; issue: string };

function parseWith<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid JSON', issue: 'invalid_json' };
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.') || '(root)';
    return {
      ok: false,
      error: `${path}: ${issue?.message ?? 'invalid message'}`,
      issue: issue?.code ?? 'invalid',
    };
  }
  return { ok: true, value: result.data };
}

/** Parse and validate a raw client→server frame. Never throws. */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  return parseWith(clientMessageSchema, raw);
}

/** Parse and validate a raw server→client frame. Never throws. */
export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  return parseWith(serverMessageSchema, raw);
}

/** RMS level in dBFS from a sum of squared int16 samples, floored at -100. */
export function levelDb(sumSquares: number, sampleCount: number): number {
  if (sampleCount === 0 || sumSquares === 0) return -100;
  const rms = Math.sqrt(sumSquares / sampleCount) / 32768;
  return Math.max(-100, Math.round(20 * Math.log10(rms) * 10) / 10);
}

/** Builds a binary audio frame: big-endian uint32 seq followed by PCM16 samples. */
export function encodeAudioFrame(seq: number, samples: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(AUDIO_HEADER_BYTES + samples.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, seq, false);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(AUDIO_HEADER_BYTES + i * 2, samples[i] ?? 0, true);
  }
  return buffer;
}

export type DecodedFrame = { ok: true; seq: number; samples: Int16Array } | { ok: false; error: string };

/** Parses a binary audio frame. Samples are little-endian PCM16; at most one frame's worth. */
export function decodeAudioFrame(data: Uint8Array): DecodedFrame {
  const sampleBytes = data.byteLength - AUDIO_HEADER_BYTES;
  if (sampleBytes <= 0 || sampleBytes % 2 !== 0 || sampleBytes > FRAME_SAMPLES * 2) {
    return { ok: false, error: 'bad audio frame size' };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const seq = view.getUint32(0, false);
  const samples = new Int16Array(sampleBytes / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(AUDIO_HEADER_BYTES + i * 2, true);
  }
  return { ok: true, seq, samples };
}
