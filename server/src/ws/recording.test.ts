import { describe, expect, it } from 'vitest';
import type { WebSocket } from '@fastify/websocket';
import type { SttFactory, TranscriptSink } from '../stt/types.ts';
import { Recordings } from './recording.ts';

// Stop must not drop the last transcription (review finding 1), and disposal must stop the
// transcription stream (finding 2).

function fakeSocket() {
  const sent: { type: string; text?: string }[] = [];
  const socket = { OPEN: 1, readyState: 1, send: (data: string) => sent.push(JSON.parse(data) as { type: string }), close() {} };
  return { socket: socket as unknown as WebSocket, sent };
}

/** An STT stream whose finalization completes later, like a Groq upload. */
function slowStt(delayMs: number | null) {
  const state = { disposed: false };
  const factory: SttFactory = (sink: TranscriptSink) => {
    let pending: Promise<void> = Promise.resolve();
    return {
      push() {},
      discardPartial() {},
      finalizeNow() {
        pending = delayMs === null ? new Promise(() => undefined) : new Promise((r) => setTimeout(() => (state.disposed || sink.final('last words', 0, 1000), r()), delayMs));
      },
      flush: () => pending,
      dispose() {
        state.disposed = true;
      },
    };
  };
  return { factory, state };
}

describe('Recording stop and dispose', () => {
  it('waits for the last transcription before it is removed, so the final reaches the client', async () => {
    const { socket, sent } = fakeSocket();
    const { factory, state } = slowStt(30);
    const recordings = new Recordings(60_000, 60_000);
    const rec = recordings.start('auth', socket, factory);
    await rec.stop();
    recordings.remove(rec.id);
    expect(sent.some((m) => m.type === 'transcript.final' && m.text === 'last words')).toBe(true);
    expect(state.disposed).toBe(true);
  });

  it('gives up waiting after the bound', async () => {
    const { socket } = fakeSocket();
    const { factory } = slowStt(null); // never finishes
    const rec = new Recordings(60_000, 60_000).start('auth', socket, factory);
    const started = Date.now();
    await rec.stop(50);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('logout disposes the transcription stream at once (no grace period)', () => {
    const { socket } = fakeSocket();
    const { factory, state } = slowStt(30);
    const recordings = new Recordings(60_000, 60_000);
    recordings.start('auth', socket, factory);
    recordings.removeForAuth('auth');
    expect(state.disposed).toBe(true);
    expect(recordings.size).toBe(0);
  });
});
