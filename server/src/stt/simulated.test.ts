import { describe, expect, it } from 'vitest';
import { FRAME_MS, FRAME_SAMPLES } from '../../../shared/messages.ts';
import { MS_PER_WORD, createSimulatedStt } from './simulated.ts';

function setup() {
  const events: string[] = [];
  const finals: { text: string; startMs: number; endMs: number }[] = [];
  const stt = createSimulatedStt({
    partial: (text) => events.push(`partial:${text}`),
    final: (text, startMs, endMs) => {
      events.push(`final:${text}`);
      finals.push({ text, startMs, endMs });
    },
    error: () => {},
  });
  let seq = 0;
  const pushMs = (ms: number) => {
    for (let i = 0; i < ms / FRAME_MS; i++, seq++) stt.push(new Int16Array(FRAME_SAMPLES), seq * FRAME_MS);
  };
  return { stt, events, finals, pushMs };
}

describe('simulated STT', () => {
  it('adds one word per 300 ms of audio as growing partials', () => {
    const { events, pushMs } = setup();
    pushMs(MS_PER_WORD * 3);
    expect(events).toEqual(['partial:Can', 'partial:Can you', 'partial:Can you walk']);
  });

  it('emits a final with timing when the scripted line completes', () => {
    const { finals, pushMs } = setup();
    pushMs(MS_PER_WORD * 15); // the first line has 15 words
    expect(finals).toEqual([
      {
        text: 'Can you walk me through how you would define an SLO for a payments API?',
        startMs: 0,
        endMs: MS_PER_WORD * 15,
      },
    ]);
  });

  it('finalizeNow turns the partial into a final and moves to the next line', () => {
    const { stt, events, pushMs } = setup();
    pushMs(MS_PER_WORD * 2);
    stt.finalizeNow();
    pushMs(MS_PER_WORD);
    expect(events.slice(-2)).toEqual(['final:Can you', 'partial:What']);
  });

  it('discardPartial drops words without a final', () => {
    const { stt, events, pushMs } = setup();
    pushMs(MS_PER_WORD * 2);
    stt.discardPartial();
    stt.finalizeNow();
    expect(events.some((e) => e.startsWith('final:'))).toBe(false);
  });
});
