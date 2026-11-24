import { describe, expect, it } from 'vitest';
import { AudioBuffer, MAX_BUFFERED_FRAMES } from './audioBuffer.ts';

const frame = (n: number) => new Uint8Array([n]).buffer;
const ids = (frames: ArrayBuffer[]) => frames.map((f) => new Uint8Array(f)[0]);

describe('AudioBuffer', () => {
  it('returns frames from a given seq, in order', () => {
    const buf = new AudioBuffer();
    for (let i = 0; i < 5; i++) buf.add(i, frame(i));
    expect(ids(buf.from(2))).toEqual([2, 3, 4]);
  });

  it('frees acknowledged frames', () => {
    const buf = new AudioBuffer();
    for (let i = 0; i < 5; i++) buf.add(i, frame(i));
    buf.ack(2);
    expect(buf.size).toBe(2);
    expect(ids(buf.from(0))).toEqual([3, 4]);
  });

  it('drops the oldest frames beyond about 3 s', () => {
    const buf = new AudioBuffer();
    for (let i = 0; i < MAX_BUFFERED_FRAMES + 5; i++) buf.add(i, frame(i));
    expect(buf.size).toBe(MAX_BUFFERED_FRAMES);
    expect(ids(buf.from(0))[0]).toBe(5);
  });
});
