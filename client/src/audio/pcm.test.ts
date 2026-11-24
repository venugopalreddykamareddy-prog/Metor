import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES } from '../../../shared/audio.ts';
import { Pcm16Framer, floatToInt16 } from './pcm.ts';

describe('floatToInt16', () => {
  it('maps the float range to int16 and clamps', () => {
    expect([floatToInt16(0), floatToInt16(1), floatToInt16(-1), floatToInt16(2), floatToInt16(-2)])
      .toEqual([0, 32767, -32768, 32767, -32768]);
  });
});

describe('Pcm16Framer', () => {
  it.each([48_000, 44_100, 16_000])('emits one 100 ms frame per 100 ms of %i Hz input', (rate) => {
    const framer = new Pcm16Framer(rate);
    const frames: Int16Array[] = [];
    // Feed 1 s in browser-sized 128-sample blocks.
    for (let i = 0; i < rate / 128; i++) frames.push(...framer.push(new Float32Array(128).fill(0.5)));
    expect(frames.length).toBeGreaterThanOrEqual(9);
    expect(frames.length).toBeLessThanOrEqual(10);
    for (const frame of frames) {
      expect(frame.length).toBe(FRAME_SAMPLES);
      expect(frame.every((s) => s === floatToInt16(0.5))).toBe(true);
    }
  });

  it('averages input samples when downsampling', () => {
    const framer = new Pcm16Framer(48_000);
    const input = new Float32Array(3 * FRAME_SAMPLES);
    for (let i = 0; i < input.length; i++) input[i] = i % 3 === 0 ? 0.9 : 0; // average 0.3
    const [frame] = framer.push(input);
    expect(frame?.[0]).toBe(floatToInt16(0.3));
  });

  it('rejects input rates below 16 kHz', () => {
    expect(() => new Pcm16Framer(8000)).toThrow();
  });
});
