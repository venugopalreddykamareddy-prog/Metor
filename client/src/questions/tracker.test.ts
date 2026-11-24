import { describe, expect, it } from 'vitest';
import type { CleanItem } from '../session/cleanTranscript.ts';
import { DUPLICATE_WINDOW_MS, READY_AFTER_MS, addManual, emptyTracker, setStatus, updateTracker, type TrackerState } from './tracker.ts';

const sentence = (key: string, text: string, open = false, raw = text.toLowerCase()): CleanItem => ({
  kind: 'sentence',
  key,
  text,
  raw,
  isQuestion: text.endsWith('?'),
  edited: false,
  open,
});
const summary = (s: TrackerState) => s.questions.map((q) => `${q.status}: ${q.text}`);

describe('updateTracker', () => {
  it('extracts several questions from one sentence and waits for a pause before they are ready', () => {
    const items = [sentence('s1', 'How does BGP pick a path what about OSPF')];
    let s = updateTracker(emptyTracker, items, 0);
    expect(summary(s)).toEqual(['waiting: How does BGP pick a path', 'waiting: what about OSPF']);
    s = updateTracker(s, items, READY_AFTER_MS - 1);
    expect(s.questions.every((q) => q.status === 'waiting')).toBe(true);
    s = updateTracker(s, items, READY_AFTER_MS);
    expect(s.questions.every((q) => q.status === 'ready')).toBe(true);
  });

  it('is ready at once when the recognizer ended it with a question mark', () => {
    const s = updateTracker(emptyTracker, [sentence('s1', 'What is an error budget?')], 0);
    expect(summary(s)).toEqual(['ready: What is an error budget?']);
  });

  it('never readies a sentence that is still open or trails off', () => {
    let s = updateTracker(emptyTracker, [sentence('s1', 'How would you scale the', true)], 0);
    s = updateTracker(s, [sentence('s1', 'Can you please help me to…')], 5000);
    expect(s.questions.filter((q) => q.status === 'ready')).toEqual([]);
  });

  it('updates a pending question as its sentence grows instead of adding another', () => {
    let s = updateTracker(emptyTracker, [sentence('s1', 'How would you scale', true)], 0);
    s = updateTracker(s, [sentence('s1', 'How would you scale the database')], 400);
    expect(summary(s)).toEqual(['waiting: How would you scale the database']);
  });

  it('replaces an earlier incomplete question that a later sentence completes', () => {
    let s = updateTracker(emptyTracker, [sentence('s1', 'Can you please help me')], 0);
    s = updateTracker(s, [sentence('s1', 'Can you please help me'), sentence('s2', 'Can you please help me understand BGP communities?')], 1500);
    expect(summary(s)).toEqual(['superseded: Can you please help me', 'ready: Can you please help me understand BGP communities?']);
  });

  it('drops a duplicate transcript event but keeps a genuine repeat, linked to the first answer', () => {
    let s = updateTracker(emptyTracker, [sentence('s1', 'How does DNS resolution work?')], 0);
    s = setStatus(s, s.questions[0]?.id ?? '', 'answered');
    s = updateTracker(s, [sentence('s1', 'How does DNS resolution work?'), sentence('s2', 'How does DNS resolution work?')], 800);
    expect(s.questions).toHaveLength(1); // same words 0.8 s later: one event arriving twice

    const later = DUPLICATE_WINDOW_MS + 40_000;
    s = updateTracker(s, [...['s1', 's2'].map((k) => sentence(k, 'How does DNS resolution work?')), sentence('s3', 'Sorry, let me ask again, how does DNS resolution work?')], later);
    const repeat = s.questions.at(-1);
    expect(repeat).toMatchObject({ status: 'answered', repeatOf: s.questions[0]?.id });
  });

  it('carries statements as context and marks follow-ups', () => {
    let s = updateTracker(emptyTracker, [sentence('s1', 'We run payments on AKS with forty nodes how would you plan the upgrade?')], 0);
    expect(s.questions[0]).toMatchObject({ text: 'how would you plan the upgrade?', statements: ['We run payments on AKS with forty nodes'] });
    s = setStatus(s, s.questions[0]?.id ?? '', 'answered');
    s = updateTracker(s, [sentence('s1', 'We run payments on AKS with forty nodes how would you plan the upgrade?'), sentence('s2', 'And what about the database?')], 3000);
    expect(s.questions.at(-1)?.kind).toBe('follow_up');
  });

  it('keeps the raw words only when cleaning changed words', () => {
    const fixed = updateTracker(emptyTracker, [sentence('s1', 'How do I use kubectl?', false, 'how do i use cube cuddle')], 0);
    expect(fixed.questions[0]?.heard).toBe('how do i use cube cuddle');
    const punctuated = updateTracker(emptyTracker, [sentence('s1', 'How do I use Helm?', false, 'how do i use helm')], 0);
    expect(punctuated.questions[0]?.heard).toBeUndefined();
  });
});

describe('manual questions', () => {
  it('adds a typed question ready to answer, and can replace merged ones', () => {
    let s = updateTracker(emptyTracker, [sentence('s1', 'How does BGP pick a path what about OSPF')], 0);
    const ids = s.questions.map((q) => q.id);
    s = addManual(s, 'How does BGP pick a path compared with OSPF?', 10, ids);
    expect(summary(s)).toEqual([
      'dismissed: How does BGP pick a path',
      'dismissed: what about OSPF',
      'ready: How does BGP pick a path compared with OSPF?',
    ]);
  });
});
