/** About 3 s of audio at 100 ms per frame (ARCHITECTURE §6.3). */
export const MAX_BUFFERED_FRAMES = 30;

/**
 * Frames sent or waiting to be sent but not yet acknowledged by the server.
 * When full, the oldest frame is dropped; the server sees the missing seq and reports a gap.
 */
export class AudioBuffer {
  private frames: { seq: number; data: ArrayBuffer }[] = [];

  add(seq: number, data: ArrayBuffer): void {
    this.frames.push({ seq, data });
    if (this.frames.length > MAX_BUFFERED_FRAMES) this.frames.shift();
  }

  /** Server confirmed everything up to and including `seq`. */
  ack(seq: number): void {
    this.frames = this.frames.filter((f) => f.seq > seq);
  }

  /** Frames to (re)send, starting at `seq`. */
  from(seq: number): ArrayBuffer[] {
    return this.frames.filter((f) => f.seq >= seq).map((f) => f.data);
  }

  get size(): number {
    return this.frames.length;
  }

  clear(): void {
    this.frames = [];
  }
}
