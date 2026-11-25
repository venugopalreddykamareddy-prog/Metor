// The answer model writes a short header and then the answer (ARCHITECTURE §5.4):
//   TYPE: technical
//   ASSESSMENT: none
//   NOTE: -
//   CLARIFY: -
//   ANSWER:
//   <answer text…>
// AnswerStreamParser reads that from streamed chunks and hands back the header once, then answer text.

export const QUESTION_TYPES = ['technical', 'behavioral', 'follow_up', 'ambiguous', 'off_topic', 'experience_probe'] as const;
export const ASSESSMENTS = [
  'none',
  'incorrect_premise',
  'unrecognized_term',
  'possible_transcription_error',
  'clarification_needed',
  'unrealistic_requirement',
  'insufficient_information',
  'unverified_experience',
  'off_topic',
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];
export type Assessment = (typeof ASSESSMENTS)[number];

export interface AnswerHeader {
  questionType: QuestionType | 'unknown';
  assessment: Assessment;
  note: string | null;
  clarify: string | null;
}

/** If no "ANSWER:" line shows up within this many characters, treat everything as the answer. */
const MAX_HEADER_CHARS = 600;

const field = (header: string, name: string): string | null => {
  const match = new RegExp(`^\\s*${name}\\s*:\\s*(.*)$`, 'im').exec(header);
  const value = match?.[1]?.trim() ?? '';
  return value && value !== '-' ? value : null;
};

const FIELD_NAMES = 'TYPE|NOTE|ASSESSMENT|CLARIFY|ANSWER';

/** Models sometimes put the whole header on one line: "TYPE: x | NOTE: y | ASSESSMENT: z". */
function splitInlineFields(text: string): string {
  return text.replace(new RegExp(`\\s*\\|\\s*(?=(?:${FIELD_NAMES})\\s*:)`, 'g'), '\n');
}

export function parseHeader(raw: string): AnswerHeader {
  const header = splitInlineFields(raw);
  const type = field(header, 'TYPE')?.toLowerCase();
  const assessment = field(header, 'ASSESSMENT')?.toLowerCase();
  return {
    questionType: QUESTION_TYPES.find((t) => t === type) ?? 'unknown',
    assessment: ASSESSMENTS.find((a) => a === assessment) ?? 'none',
    note: field(header, 'NOTE'),
    clarify: field(header, 'CLARIFY'),
  };
}

export type ParserEvent = { kind: 'header'; header: AnswerHeader } | { kind: 'text'; text: string };

export class AnswerStreamParser {
  private buffer = '';
  private inAnswer = false;
  // "ANSWER:" can end one chunk with its newline arriving in the next; drop that newline.
  private skipNewline = false;

  push(chunk: string): ParserEvent[] {
    if (this.inAnswer) {
      let text = chunk;
      if (this.skipNewline && text) {
        text = text.replace(/^\r?\n/, '');
        this.skipNewline = false;
      }
      return text ? [{ kind: 'text', text }] : [];
    }
    this.buffer += chunk;
    const marker = /(?:^|\|)[ \t]*ANSWER\s*:[ \t]*\n?/im.exec(this.buffer);
    if (marker) {
      this.inAnswer = true;
      const header = parseHeader(this.buffer.slice(0, marker.index));
      const rest = this.buffer.slice(marker.index + marker[0].length);
      this.skipNewline = !marker[0].includes('\n') && rest === '';
      this.buffer = '';
      return rest ? [{ kind: 'header', header }, { kind: 'text', text: rest }] : [{ kind: 'header', header }];
    }
    if (this.buffer.length > MAX_HEADER_CHARS) return this.giveUpOnHeader();
    return [];
  }

  /** Call when the stream ends; flushes a short answer that never had a header. */
  end(): ParserEvent[] {
    return this.inAnswer || !this.buffer ? [] : this.giveUpOnHeader();
  }

  private giveUpOnHeader(): ParserEvent[] {
    this.inAnswer = true;
    const text = this.buffer;
    this.buffer = '';
    return [{ kind: 'header', header: parseHeader('') }, { kind: 'text', text }];
  }
}

/** Assessments where the answer is only a clarification: no explanation until the interviewer replies. */
export const CLARIFY_ONLY: readonly Assessment[] = ['unrecognized_term', 'clarification_needed'];

export const isClarifyOnly = (a: Assessment): boolean => CLARIFY_ONLY.includes(a);

/** End offsets of complete sentences; a terminator at the very end only counts once the text is final. */
function sentenceEnds(text: string, final: boolean): number[] {
  const re = final ? /[.?!]+["'”’)]*(?=\s|$)/g : /[.?!]+["'”’)]*(?=\s)/g;
  return [...text.matchAll(re)].map((m) => m.index + m[0].length);
}

/**
 * Keeps a clarification-only answer to its clarification, even when the model goes on to explain
 * the unknown term anyway: the first sentence streams live, a second is kept only if it's the
 * question, and anything after is dropped. With no question asked, the header's CLARIFY is added.
 */
export class ClarificationLimiter {
  private text = '';
  private forwarded = 0;
  private firstEnd: number | null = null;
  private done = false;
  private asked = false;

  private readonly clarify: string | null;

  constructor(clarify: string | null) {
    this.clarify = clarify;
  }

  /** True once the clarification is complete; later text is dropped. */
  get finished(): boolean {
    return this.done;
  }

  push(chunk: string): string {
    if (this.done) return '';
    this.text += chunk;
    return this.advance(false);
  }

  /** Call when the stream ends: flushes what's left and adds CLARIFY if no question was asked. */
  end(): string {
    const rest = this.done ? '' : this.advance(true);
    this.done = true;
    if (this.asked || !this.clarify) return rest;
    return `${rest}${this.forwarded > 0 || rest ? ' ' : ''}${this.clarify}`;
  }

  private advance(final: boolean): string {
    const ends = sentenceEnds(this.text, final);
    let out = '';
    if (this.firstEnd === null) {
      const first = ends[0];
      if (first === undefined) {
        out = this.text.slice(this.forwarded);
        this.forwarded = this.text.length;
        if (final) this.done = true;
        if (final && out.includes('?')) this.asked = true;
        return out;
      }
      out = this.text.slice(this.forwarded, first);
      this.forwarded = this.firstEnd = first;
      if (this.text.slice(0, first).trimEnd().replace(/["'”’)]+$/, '').endsWith('?')) {
        this.done = this.asked = true;
        return out;
      }
    }
    const second = ends[1];
    if (second === undefined && !final) return out;
    this.done = true;
    const sentence = this.text.slice(this.firstEnd, second ?? this.text.length);
    if (!sentence.includes('?')) return out;
    this.asked = true;
    this.forwarded += sentence.length;
    return out + sentence;
  }
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The note and clarify question to show under an assessment label, without repeating the label
 * ("Unrecognized term · Unrecognized term: X"), each other, or a question the answer already asks.
 */
export function assessmentDetails(
  label: string,
  header: Pick<AnswerHeader, 'assessment' | 'note' | 'clarify'>,
  answer: string,
): { note: string | null; clarify: string | null } {
  const names = [label, header.assessment, header.assessment.replace(/_/g, ' ')].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  let note = header.note?.replace(new RegExp(`^(?:${names.join('|')})\\s*(?:[:\\-–—·.,]\\s*|$)`, 'i'), '').trim() ?? null;
  if (note) note = note.charAt(0).toUpperCase() + note.slice(1);
  if (!note || names.some((n) => normalize(n) === normalize(note ?? ''))) note = null;
  let clarify = header.clarify;
  if (clarify) {
    const c = normalize(clarify);
    const asked = isClarifyOnly(header.assessment) && answer.includes('?');
    if (asked || (note && normalize(note) === c) || normalize(answer).includes(c)) clarify = null;
  }
  return { note, clarify };
}
