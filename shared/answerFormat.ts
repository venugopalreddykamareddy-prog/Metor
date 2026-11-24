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
