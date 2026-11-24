import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav.ts';

describe('encodeWav', () => {
  it('writes a 16 kHz mono PCM16 header followed by the samples', () => {
    const wav = encodeWav(Int16Array.from([1, -2, 300]));
    const view = new DataView(wav.buffer);
    const text = (at: number, n: number) => String.fromCharCode(...wav.slice(at, at + n));
    expect(wav.byteLength).toBe(44 + 6);
    expect([text(0, 4), text(8, 4), text(12, 4), text(36, 4)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint32(4, true)).toBe(36 + 6);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([1, -2, 300]);
  });
});
