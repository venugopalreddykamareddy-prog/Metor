import { describe, expect, it } from 'vitest';
import { AnswerStreamParser, ClarificationLimiter, assessmentDetails, parseHeader, type ParserEvent } from './answerFormat.ts';

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

const limit = (chunks: string[], clarify: string | null = null) => {
  const l = new ClarificationLimiter(clarify);
  return chunks.map((c) => l.push(c)).join('') + l.end();
};

describe('ClarificationLimiter', () => {
  it('keeps a statement and its question, drops what follows, across any chunk split', () => {
    const full = "I'm not familiar with Kubeflux. What does it do? It's probably a GitOps tool. Set sync=true.";
    const want = "I'm not familiar with Kubeflux. What does it do?";
    for (const size of [1, 3, 7, 200]) {
      const chunks = full.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? [];
      expect(limit(chunks), `size ${size}`).toBe(want);
    }
  });

  it('streams the first sentence live', () => {
    const l = new ClarificationLimiter(null);
    expect(l.push("I'm not familiar ")).toBe("I'm not familiar ");
    expect(l.push('with it. ')).toBe('with it.');
  });

  it('stops at a leading question', () => {
    expect(limit(['Do you mean the Cluster Autoscaler? It scales nodes.'])).toBe('Do you mean the Cluster Autoscaler?');
  });

  it('replaces a speculative second sentence with the header question', () => {
    expect(limit(["I don't know Helm autopilot mode. It probably automates upgrades."], 'What does it do?')).toBe(
      "I don't know Helm autopilot mode. What does it do?",
    );
  });

  it('adds the header question to an empty or unfinished answer', () => {
    expect(limit([], 'Which CA do you mean?')).toBe('Which CA do you mean?');
    expect(limit(['Not sure which one you mean'], 'Which CA?')).toBe('Not sure which one you mean Which CA?');
  });

  it('keeps a question that ends the stream', () => {
    expect(limit(["I'm not familiar with it. What does it do?"], 'Ignored?')).toBe("I'm not familiar with it. What does it do?");
  });
});

describe('assessmentDetails', () => {
  const h = (assessment: 'unrecognized_term' | 'clarification_needed' | 'incorrect_premise', note: string | null, clarify: string | null) => ({ assessment, note, clarify });

  it('drops a note that restates the label', () => {
    expect(assessmentDetails('Unrecognized term', h('unrecognized_term', 'Unrecognized term: Kubeflux.', null), '').note).toBe('Kubeflux.');
    expect(assessmentDetails('Unrecognized term', h('unrecognized_term', 'unrecognized_term - kubeflux', null), '').note).toBe('Kubeflux');
    expect(assessmentDetails('Needs clarification', h('clarification_needed', 'Needs clarification.', null), '').note).toBeNull();
    expect(assessmentDetails('Incorrect premise', h('incorrect_premise', 'OSPF is link-state.', null), '').note).toBe('OSPF is link-state.');
  });

  it('hides the Ask line when the answer already asks or it repeats the note', () => {
    expect(assessmentDetails('Unrecognized term', h('unrecognized_term', 'Unknown tool.', 'What does it do?'), "I'm not familiar with it. What does it do in your setup?").clarify).toBeNull();
    expect(assessmentDetails('Needs clarification', h('clarification_needed', 'Which CA?', 'Which CA?'), '').clarify).toBeNull();
    expect(assessmentDetails('Incorrect premise', h('incorrect_premise', 'Wrong protocol class.', 'Did you mean UDP?'), 'TCP is connection-oriented.').clarify).toBe('Did you mean UDP?');
  });
});
