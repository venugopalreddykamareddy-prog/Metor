import { FRAME_MS } from '../../../shared/messages.ts';
import type { SttFactory, SttStream, TranscriptSink } from './types.ts';

// Canned interview-style lines. The text never depends on the audio content.
const SCRIPT = [
  'Can you walk me through how you would define an SLO for a payments API',
  'What would you check first if latency doubled after a deploy',
  'Tell me about a time you handled a difficult incident',
  'How does BGP choose the best path between two routes',
];

/** Adds one word per this much received audio. */
export const MS_PER_WORD = 300;

export const createSimulatedStt: SttFactory = (sink: TranscriptSink): SttStream => {
  let line = 0;
  let words: string[] = [];
  let audioSinceWord = 0;
  let segmentStartMs = 0;
  let lastAudioEndMs = 0;

  const emitFinal = () => {
    if (words.length === 0) return;
    sink.final(words.join(' '), segmentStartMs, lastAudioEndMs);
    words = [];
    audioSinceWord = 0;
  };

  return {
    push(_samples, atMs) {
      if (words.length === 0 && audioSinceWord === 0) segmentStartMs = atMs;
      lastAudioEndMs = atMs + FRAME_MS;
      audioSinceWord += FRAME_MS;
      if (audioSinceWord < MS_PER_WORD) return;
      audioSinceWord = 0;
      const lineWords = (SCRIPT[line % SCRIPT.length] ?? '').split(' ');
      words.push(lineWords[words.length] ?? '');
      if (words.length >= lineWords.length) {
        emitFinal();
        line += 1;
      } else {
        sink.partial(words.join(' '));
      }
    },
    finalizeNow() {
      if (words.length > 0) line += 1;
      emitFinal();
      audioSinceWord = 0;
    },
    discardPartial() {
      words = [];
      audioSinceWord = 0;
    },
  };
};
