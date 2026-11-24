// Runs on the audio rendering thread. Converts mic input to 16 kHz PCM16 frames for the main thread.
import { Pcm16Framer } from './pcm.ts';

// Minimal declarations for the AudioWorkletGlobalScope; TypeScript's DOM lib doesn't include them.
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessorLike): void;
declare class AudioWorkletProcessorLike {
  readonly port: MessagePort;
}
declare const AudioWorkletProcessor: typeof AudioWorkletProcessorLike;

class Pcm16Processor extends AudioWorkletProcessor {
  private readonly framer = new Pcm16Framer(sampleRate);

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (const frame of this.framer.push(channel)) this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm16-framer', Pcm16Processor);
