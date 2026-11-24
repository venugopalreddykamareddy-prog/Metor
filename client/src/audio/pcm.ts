import { FRAME_SAMPLES, SAMPLE_RATE } from '../../../shared/audio.ts';

export function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

/**
 * Downsamples mic audio to 16 kHz PCM16 and cuts it into 100 ms frames.
 * Each output sample averages the input samples it covers, a cheap low-pass that is fine for speech.
 * Browsers pick the capture rate (usually 44.1 or 48 kHz), so resampling happens here.
 */
export class Pcm16Framer {
  private readonly ratio: number;
  private readonly frame = new Int16Array(FRAME_SAMPLES);
  private filled = 0;
  private position = 0; // fractional input position of the next output sample
  private sum = 0;
  private count = 0;

  constructor(inputRate: number) {
    if (inputRate < SAMPLE_RATE) throw new Error(`input rate ${inputRate} is below ${SAMPLE_RATE}`);
    this.ratio = inputRate / SAMPLE_RATE;
  }

  /** Feeds input samples; returns any frames completed by them. */
  push(input: Float32Array): Int16Array[] {
    const frames: Int16Array[] = [];
    for (const sample of input) {
      this.sum += sample;
      this.count += 1;
      this.position += 1;
      if (this.position < this.ratio) continue;
      this.position -= this.ratio;
      this.frame[this.filled++] = floatToInt16(this.sum / this.count);
      this.sum = 0;
      this.count = 0;
      if (this.filled === FRAME_SAMPLES) {
        frames.push(this.frame.slice());
        this.filled = 0;
      }
    }
    return frames;
  }
}
