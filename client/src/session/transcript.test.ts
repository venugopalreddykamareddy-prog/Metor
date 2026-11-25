import { describe, expect, it } from 'vitest';
import { acceptsTranscript, applyTranscript, clearTranscript, dropPartial, emptyTranscript, transcriptText } from './transcript.ts';

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
    expect(t.lines).toEqual([{ kind: 'final', key: 'f1', finalSeq: 1, text: 'how does BGP work', startMs: 0, endMs: 100 }]);
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

  it('keeps repeated fragments in the raw transcript (the cleaned view drops them)', () => {
    let t = applyTranscript(emptyTranscript, final(1, 'run kubectl get pods'));
    t = applyTranscript(t, final(2, 'run kubectl get pods'));
    expect(transcriptText(t)).toBe('run kubectl get pods run kubectl get pods');
  });

  it('treats an empty partial as no partial', () => {
    const t = applyTranscript(applyTranscript(emptyTranscript, partial('…')), partial(''));
    expect(t.partial).toBeNull();
  });

  it('clearTranscript empties lines but still ignores replayed finals', () => {
    const cleared = clearTranscript(applyTranscript(emptyTranscript, final(1, 'a')));
    expect(cleared.lines).toEqual([]);
    expect(applyTranscript(cleared, final(1, 'a')).lines).toEqual([]);
    expect(applyTranscript(cleared, final(2, 'b')).lines).toHaveLength(1);
  });
});

describe('acceptsTranscript (recording isolation)', () => {
  it("shows the current recording's text and the stopped one's late final, until a new recording starts", () => {
    expect(acceptsTranscript('new', 'new', null)).toBe(true);
    expect(acceptsTranscript('old', null, 'old')).toBe(true); // idle after Stop: last segment still welcome
    expect(acceptsTranscript('old', 'new', null)).toBe(false); // a new recording started: never mixed in
    expect(acceptsTranscript('old', null, null)).toBe(false); // e.g. Browser speech now active
    expect(acceptsTranscript(undefined, 'new', null)).toBe(true);
  });
});

