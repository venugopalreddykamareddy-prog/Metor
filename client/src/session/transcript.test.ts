import { describe, expect, it } from 'vitest';
import { applyTranscript, dropPartial, emptyTranscript } from './transcript.ts';

const env = { id: 'x', ts: 1 };
const partial = (text: string) => ({ type: 'transcript.partial' as const, ...env, segmentId: 's', text });
const final = (finalSeq: number, text: string) =>
  ({ type: 'transcript.final' as const, ...env, segmentId: 's', finalSeq, text, startMs: 0, endMs: 100 });

describe('applyTranscript', () => {
  it('shows a partial until the final replaces it', () => {
    let t = applyTranscript(emptyTranscript, partial('how does'));
    expect(t.partial).toBe('how does');
    t = applyTranscript(t, final(1, 'how does BGP work'));
    expect(t.partial).toBeNull();
    expect(t.lines).toEqual([{ kind: 'final', key: 'f1', finalSeq: 1, text: 'how does BGP work' }]);
  });

  it('ignores finals replayed after a reconnect', () => {
    let t = applyTranscript(emptyTranscript, final(1, 'a'));
    t = applyTranscript(t, final(2, 'b'));
    t = applyTranscript(t, final(2, 'b'));
    t = applyTranscript(t, final(1, 'a'));
    expect(t.lines.map((l) => l.kind === 'final' && l.text)).toEqual(['a', 'b']);
    expect(t.lastFinalSeq).toBe(2);
  });

  it('adds a gap marker with its length', () => {
    const t = applyTranscript(emptyTranscript, { type: 'transcript.gap', ...env, fromMs: 1000, toMs: 2500 });
    expect(t.lines).toEqual([{ kind: 'gap', key: 'g1000', seconds: 1.5 }]);
  });

  it('dropPartial clears a stale partial and keeps finals', () => {
    const t = dropPartial(applyTranscript(applyTranscript(emptyTranscript, final(1, 'a')), partial('b')));
    expect(t.partial).toBeNull();
    expect(t.lines).toHaveLength(1);
  });
});
