import { describe, expect, it } from 'vitest';
import { buildMessages, estimateTokens, type AnswerRequest } from './prompt.ts';

const base: AnswerRequest = {
  type: 'answer.request',
  id: 'r1',
  ts: 1,
  questionId: 'q1',
  question: 'How does BGP choose the best path?',
  length: 'standard',
  engine: 'simulated',
  statements: [],
  turns: [],
  isFollowUp: false,
};

const user = (req: AnswerRequest) => buildMessages(req)[1]?.content ?? '';
const system = buildMessages(base)[0]?.content ?? '';

describe('buildMessages', () => {
  it('asks for the header format and the validation and style rules', () => {
    for (const phrase of ['ASSESSMENT:', 'CLARIFY:', 'ANSWER:', 'do I specifically know this exists', 'Never describe what it does', 'Never claim you checked documentation', 'No verified resume or experience', 'first person']) {
      expect(system).toContain(phrase);
    }
  });

  it('asks for a spoken, conversational style rather than textbook text', () => {
    for (const phrase of ['contractions', 'No dictionary-definition opener', 'no markdown', 'Great question', 'plays a crucial role', 'Spoken (aim for)']) {
      expect(system).toContain(phrase);
    }
  });

  it('forbids claimed experience in every answer and keeps every validation label', () => {
    expect(system).toContain('In every answer, say what you would do');
    expect(system).toContain("what's your experience with X");
    for (const label of ['incorrect_premise', 'unrecognized_term', 'possible_transcription_error', 'clarification_needed', 'unrealistic_requirement', 'insufficient_information', 'unverified_experience', 'off_topic']) {
      expect(system).toContain(`${label}`);
    }
    expect(system).toContain('If NOTE names a problem, ASSESSMENT must not be none.');
  });

  it('keeps the system prompt concise', () => {
    expect(system.length).toBeLessThan(3200);
  });

  it('wraps interviewer text as data and states the length', () => {
    expect(user(base)).toContain('<interviewer>How does BGP choose the best path?</interviewer>');
    expect(user(base)).toContain('120 to 170 words');
    expect(user({ ...base, length: 'short' })).toContain('50 to 80 words');
  });

  it('includes earlier turns, statements, and the follow-up flag', () => {
    const text = user({
      ...base,
      question: 'And if local preference is equal?',
      isFollowUp: true,
      statements: ['We peer with two ISPs.'],
      turns: [{ question: 'How does BGP choose a path?', answer: 'Highest local preference first…' }],
    });
    expect(text).toContain('Q1: How does BGP choose a path?');
    expect(text).toContain('We peer with two ISPs.');
    expect(text).toContain('This is a follow-up');
  });

  it('adds older questions as a short rolling summary, before the full turns', () => {
    const text = user({
      ...base,
      earlier: ['What is an SLI?', 'How do you alert on burn rate?'],
      turns: [{ question: 'How does BGP choose a path?', answer: 'Highest local preference first…' }],
    });
    expect(text).toContain('Asked earlier in this conversation: What is an SLI? | How do you alert on burn rate?');
    expect(text.indexOf('Asked earlier')).toBeLessThan(text.indexOf('Q1:'));
    expect(user(base)).not.toContain('Asked earlier');
  });

  it('adds the raw text only when cleaning changed it', () => {
    expect(user({ ...base, heard: 'how does b g p choose the best path' })).toContain('<heard>how does b g p choose the best path</heard>');
    expect(user({ ...base, heard: 'How does BGP choose the best path?' })).not.toContain('<heard>');
  });

  it('flags ambiguous acronyms so the answer states its assumption', () => {
    expect(user({ ...base, question: 'How would you configure AAA on the firewall?' })).toContain(
      'AAA (authentication, authorization and accounting',
    );
    expect(user(base)).not.toContain('Ambiguous acronyms');
  });

  it('estimates tokens at roughly four characters each', () => {
    expect(estimateTokens([{ role: 'user', content: 'x'.repeat(400) }])).toBe(110);
  });
});
