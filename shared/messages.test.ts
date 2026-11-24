import { describe, expect, it } from 'vitest';
import {
  FRAME_SAMPLES,
  decodeAudioFrame,
  encodeAudioFrame,
  parseClientMessage,
  parseServerMessage,
} from './messages.ts';

const env = { id: 'abc', ts: 1 };
const start = { type: 'session.start', ...env, mode: 'simulated', source: 'mic' };
const resume = { type: 'session.resume', ...env, sessionId: '0b7e1c52-7c4f-4d3c-9a43-0e7b6f0b2a11', lastFinalSeq: 3 };

describe('parseClientMessage', () => {
  it.each([
    ['session.start', start],
    ['session.resume', resume],
    ['session.stop', { type: 'session.stop', ...env }],
  ])('accepts %s', (_name, msg) => {
    expect(parseClientMessage(JSON.stringify(msg))).toEqual({ ok: true, value: msg });
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['null', 'null'],
    ['unknown type', JSON.stringify({ ...start, type: 'echo.request' })],
    ['live mode (not available yet)', JSON.stringify({ ...start, mode: 'live' })],
    ['tab source (not available yet)', JSON.stringify({ ...start, source: 'tab' })],
    ['non-uuid sessionId', JSON.stringify({ ...resume, sessionId: 'abc' })],
    ['negative lastFinalSeq', JSON.stringify({ ...resume, lastFinalSeq: -1 })],
    ['missing id', JSON.stringify({ type: 'session.stop', ts: 1 })],
    ['extra field', JSON.stringify({ ...start, admin: true })],
  ])('rejects %s', (_label, raw) => {
    expect(parseClientMessage(raw).ok).toBe(false);
  });

  it('gives a fixed issue code alongside the readable error', () => {
    expect(parseClientMessage('{bad')).toMatchObject({ ok: false, issue: 'invalid_json' });
    expect(parseClientMessage(JSON.stringify({ ...start, extra: 1 }))).toMatchObject({
      ok: false,
      issue: 'unrecognized_keys',
      error: expect.stringContaining('extra'),
    });
  });
});

describe('parseServerMessage', () => {
  it('accepts transcript messages and rejects unknown error codes', () => {
    const final = { type: 'transcript.final', ...env, segmentId: 's', finalSeq: 1, text: 'hi', startMs: 0, endMs: 100 };
    expect(parseServerMessage(JSON.stringify(final)).ok).toBe(true);
    const err = { type: 'error', ...env, code: 'boom', message: 'x', retryable: false };
    expect(parseServerMessage(JSON.stringify(err)).ok).toBe(false);
  });
});

describe('audio frames', () => {
  it('round-trips seq and samples', () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768]);
    const decoded = decodeAudioFrame(new Uint8Array(encodeAudioFrame(70000, samples)));
    expect(decoded).toEqual({ ok: true, seq: 70000, samples });
  });

  it('writes the seq big-endian in the first 4 bytes', () => {
    const bytes = new Uint8Array(encodeAudioFrame(0x01020304, new Int16Array(1)));
    expect([...bytes.slice(0, 4)]).toEqual([1, 2, 3, 4]);
  });

  it.each([
    ['header only', 4],
    ['odd sample bytes', 7],
    ['more than one frame', 4 + FRAME_SAMPLES * 2 + 2],
  ])('rejects %s', (_label, size) => {
    expect(decodeAudioFrame(new Uint8Array(size)).ok).toBe(false);
  });
});
