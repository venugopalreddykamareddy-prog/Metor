import { describe, expect, it } from 'vitest';
import { AnswerStreamParser, parseHeader, type ParserEvent } from './answerFormat.ts';

const run = (chunks: string[]) => {
  const parser = new AnswerStreamParser();
  const events: ParserEvent[] = chunks.flatMap((c) => parser.push(c));
  return [...events, ...parser.end()];
};
const textOf = (events: ParserEvent[]) => events.flatMap((e) => (e.kind === 'text' ? [e.text] : [])).join('');

describe('parseHeader', () => {
  it('reads known values and treats "-" as empty', () => {
    expect(parseHeader('TYPE: technical\nASSESSMENT: incorrect_premise\nNOTE: UDP has no ordering.\nCLARIFY: -')).toEqual({
      questionType: 'technical',
      assessment: 'incorrect_premise',
      note: 'UDP has no ordering.',
      clarify: null,
    });
  });

  it('falls back to safe defaults for unknown or missing values', () => {
    expect(parseHeader('TYPE: weird\nASSESSMENT: trick_question')).toEqual({
      questionType: 'unknown',
      assessment: 'none',
      note: null,
      clarify: null,
    });
  });
});

describe('AnswerStreamParser', () => {
  it('emits the header once, then the answer text, across arbitrary chunk splits', () => {
    const full = 'TYPE: technical\nASSESSMENT: none\nNOTE: -\nCLARIFY: -\nANSWER:\nSure. BGP picks the path with the highest local preference first.';
    for (const size of [1, 3, 7, 50]) {
      const chunks = full.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? [];
      const events = run(chunks);
      expect(events.filter((e) => e.kind === 'header')).toHaveLength(1);
      expect(textOf(events)).toBe('Sure. BGP picks the path with the highest local preference first.');
    }
  });

  it('accepts the answer on the same line as ANSWER:', () => {
    expect(textOf(run(['TYPE: off_topic\nASSESSMENT: off_topic\nANSWER: Happy to chat about that later.']))).toBe(
      'Happy to chat about that later.',
    );
  });

  it('treats output without a header as a plain answer', () => {
    const long = 'Here is an answer without any header. '.repeat(20);
    const events = run([long]);
    expect(events[0]).toEqual({ kind: 'header', header: { questionType: 'unknown', assessment: 'none', note: null, clarify: null } });
    expect(textOf(events)).toBe(long);
    expect(textOf(run(['Short answer, no header.']))).toBe('Short answer, no header.');
  });

  it('reads a header written on one line with | separators', () => {
    const events = run([
      'TYPE: technical | NOTE: I don\'t recognize "Hyperdrive mode". | ASSESSMENT: unrecognized_term | CLARIFY: Is it an internal tool? | ANS',
      'WER:\nI\'m not familiar with that mode.',
    ]);
    expect(events[0]).toEqual({
      kind: 'header',
      header: { questionType: 'technical', assessment: 'unrecognized_term', note: 'I don\'t recognize "Hyperdrive mode".', clarify: 'Is it an internal tool?' },
    });
    expect(textOf(events)).toBe("I'm not familiar with that mode.");
  });

  it('reads NOTE before ASSESSMENT', () => {
    const events = run(['TYPE: technical\nNOTE: UDP does not guarantee ordering.\nASSESSMENT: incorrect_premise\nCLARIFY: -\nANSWER:\nActually, it doesn\'t.']);
    expect(events[0]).toMatchObject({ header: { assessment: 'incorrect_premise', note: 'UDP does not guarantee ordering.', clarify: null } });
  });
});
