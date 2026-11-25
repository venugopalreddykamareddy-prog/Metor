import { randomUUID } from 'node:crypto';
import type { WebSocket } from '@fastify/websocket';
import { FRAME_MS, levelDb, type ServerMessageBody } from '../../../shared/messages.ts';
import type { SttFactory, SttOptions, SttStream } from '../stt/types.ts';

const MAX_REPLAY_FINALS = 50;
const ACK_INTERVAL_MS = 1000;
/** No audio for this long counts as end of speech (also covers Pause). */
const IDLE_FINALIZE_MS = 1000;
const STATS_INTERVAL_MS = 1000;
/** Upper bound for Stop to wait on the last transcription (Groq requests time out at 20 s). */
const STOP_FLUSH_MS = 25_000;

type FinalMessage = Extract<ServerMessageBody, { type: 'transcript.final' }>;

export function send(socket: WebSocket, body: ServerMessageBody): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ ...body, id: randomUUID(), ts: Date.now() }));
  }
}

/** One recording session: sequence tracking, transcript stream, and resume state (ARCHITECTURE §6.3). */
export class Recording {
  readonly id = randomUUID();
  readonly authId: string;
  private socket: WebSocket | null;
  private lastSeq = -1;
  private lastAckedSeq = -1;
  private lastAckAt = 0;
  private finalSeq = 0;
  private segmentCount = 0;
  private readonly finals: FinalMessage[] = [];
  private readonly stt: SttStream;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly statsTimer: NodeJS.Timeout;
  private readonly maxAudioMs: number;
  private limitReported = false;
  private stats = { frames: 0, bytes: 0, sumSquares: 0, samples: 0 };

  constructor(authId: string, socket: WebSocket, createStt: SttFactory, maxAudioMs: number, sttOptions: SttOptions = {}) {
    this.authId = authId;
    this.socket = socket;
    this.maxAudioMs = maxAudioMs;
    this.stt = createStt({
      partial: (text) => this.emit({ type: 'transcript.partial', sessionId: this.id, segmentId: this.segmentId(), text }),
      final: (text, startMs, endMs, latencyMs) => {
        this.finalSeq += 1;
        const final: FinalMessage = {
          type: 'transcript.final',
          sessionId: this.id,
          segmentId: this.segmentId(),
          finalSeq: this.finalSeq,
          text,
          startMs,
          endMs,
          ...(latencyMs === undefined ? {} : { latencyMs }),
        };
        this.segmentCount += 1;
        this.finals.push(final);
        if (this.finals.length > MAX_REPLAY_FINALS) this.finals.shift();
        this.emit(final);
      },
      error: (code, message) => this.emit({ type: 'error', code, message, retryable: true }),
    }, sttOptions);
    // Reports every second, including zeros while paused, so the debug line never shows stale numbers.
    this.statsTimer = setInterval(() => this.emitStats(), STATS_INTERVAL_MS);
    this.statsTimer.unref();
  }

  isAttachedTo(socket: WebSocket): boolean {
    return this.socket === socket;
  }

  get nextAudioSeq(): number {
    return this.lastSeq + 1;
  }

  /** `byteLength` is the whole binary message, header included. */
  handleAudio(seq: number, samples: Int16Array, byteLength: number): void {
    this.stats.frames += 1;
    this.stats.bytes += byteLength;
    for (const s of samples) this.stats.sumSquares += s * s;
    this.stats.samples += samples.length;
    if (seq <= this.lastSeq) return; // duplicate resent after a reconnect
    if ((seq + 1) * FRAME_MS > this.maxAudioMs) {
      if (!this.limitReported) {
        this.limitReported = true;
        this.stt.finalizeNow();
        this.emit({ type: 'error', code: 'limit_reached', message: 'Maximum recording length reached.', retryable: false });
      }
      return;
    }
    if (seq > this.lastSeq + 1) {
      this.emit({ type: 'transcript.gap', sessionId: this.id, fromMs: (this.lastSeq + 1) * FRAME_MS, toMs: seq * FRAME_MS });
    }
    this.lastSeq = seq;
    this.stt.push(samples, seq * FRAME_MS);
    if (Date.now() - this.lastAckAt >= ACK_INTERVAL_MS) this.ack();
    this.resetIdleTimer();
  }

  /** Reattach after a reconnect and replay finals the client missed. */
  attach(socket: WebSocket, lastFinalSeq: number): void {
    // After a network drop the server may not have noticed the old socket is dead yet.
    if (this.socket && this.socket !== socket) this.socket.close(4000, 'replaced by resume');
    this.socket = socket;
    this.emit({ type: 'session.resumed', sessionId: this.id, nextAudioSeq: this.nextAudioSeq });
    for (const final of this.finals) {
      if (final.finalSeq > lastFinalSeq) this.emit(final);
    }
  }

  /** Connection lost: partials are stale by the time the client comes back. */
  detach(): void {
    this.socket = null;
    this.clearIdleTimer();
    this.stt.discardPartial();
  }

  /**
   * Stop: close the last segment and wait (bounded) for its transcription, so the final text still
   * reaches the client. The caller disposes afterwards.
   */
  async stop(maxWaitMs = STOP_FLUSH_MS): Promise<void> {
    this.clearIdleTimer();
    this.stt.finalizeNow();
    this.ack();
    if (!this.stt.flush) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.stt.flush(), new Promise<void>((r) => (timer = setTimeout(r, maxWaitMs)))]);
    clearTimeout(timer);
  }

  dispose(): void {
    this.clearIdleTimer();
    clearInterval(this.statsTimer);
    this.stt.dispose?.();
    this.socket = null;
  }

  private emitStats(): void {
    const { frames, bytes, sumSquares, samples } = this.stats;
    this.stats = { frames: 0, bytes: 0, sumSquares: 0, samples: 0 };
    this.emit({ type: 'audio.stats', frames, bytes, levelDb: levelDb(sumSquares, samples) });
  }

  private ack(): void {
    if (this.lastSeq < 0 || this.lastSeq === this.lastAckedSeq) return;
    this.lastAckedSeq = this.lastSeq;
    this.lastAckAt = Date.now();
    this.emit({ type: 'audio.ack', seq: this.lastSeq });
  }

  private segmentId(): string {
    return `${this.id.slice(0, 8)}-${this.segmentCount}`;
  }

  private emit(body: ServerMessageBody): void {
    if (this.socket) send(this.socket, body);
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.stt.finalizeNow();
      this.ack();
    }, IDLE_FINALIZE_MS);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

/** All recordings, with the grace period that keeps a disconnected one resumable. */
export class Recordings {
  private readonly byId = new Map<string, Recording>();
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  private readonly graceMs: number;
  private readonly maxAudioMs: number;

  constructor(graceMs: number, maxAudioMs: number) {
    this.graceMs = graceMs;
    this.maxAudioMs = maxAudioMs;
  }

  start(authId: string, socket: WebSocket, createStt: SttFactory, sttOptions: SttOptions = {}): Recording {
    const recording = new Recording(authId, socket, createStt, this.maxAudioMs, sttOptions);
    this.byId.set(recording.id, recording);
    return recording;
  }

  /** Only the login session that started a recording may resume it. */
  resume(authId: string, sessionId: string, socket: WebSocket, lastFinalSeq: number): Recording | undefined {
    const recording = this.byId.get(sessionId);
    if (!recording || recording.authId !== authId) return undefined;
    this.clearGrace(sessionId);
    recording.attach(socket, lastFinalSeq);
    return recording;
  }

  /** Ignored when another socket has already taken the recording over. */
  disconnected(recording: Recording, socket: WebSocket): void {
    if (!this.byId.has(recording.id) || !recording.isAttachedTo(socket)) return;
    recording.detach();
    const timer = setTimeout(() => this.remove(recording.id), this.graceMs);
    timer.unref();
    this.graceTimers.set(recording.id, timer);
  }

  remove(sessionId: string): void {
    this.clearGrace(sessionId);
    this.byId.get(sessionId)?.dispose();
    this.byId.delete(sessionId);
  }

  /** Logout or expiry: no grace period. */
  removeForAuth(authId: string): void {
    for (const recording of [...this.byId.values()]) {
      if (recording.authId === authId) this.remove(recording.id);
    }
  }

  get size(): number {
    return this.byId.size;
  }

  private clearGrace(sessionId: string): void {
    const timer = this.graceTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(sessionId);
  }
}
