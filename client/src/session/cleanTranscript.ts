import { TECH_TERMS, correctTerms, replacePhrase } from '../../../shared/vocabulary.ts';
import type { TranscriptLine } from './transcript.ts';

// Builds a readable transcript from raw recognizer fragments. Pure and local: no API calls,
// and the raw fragments are never modified.

/** Fragments separated by a shorter pause than this belong to the same sentence. */
export const JOIN_GAP_MS = 1200;
/** A fragment starting with a question word after this much pause starts a new sentence. */
export const QUESTION_GAP_MS = 600;
const MAX_SENTENCE_WORDS = 60;
const DUPLICATE_WINDOW_MS = 5000;

export interface Replacement {
  heard: string;
  correct: string;
}

export interface CleanOptions {
  /** The user's own corrections, applied to every sentence. */
  replacements?: Replacement[];
  /** Sentences the user edited by hand, by sentence key. */
  overrides?: Record<string, string>;
  /** More speech is coming for the last sentence (a partial is showing). */
  lastIsOpen?: boolean;
}

export type CleanItem =
  | { kind: 'sentence'; key: string; text: string; raw: string; isQuestion: boolean; edited: boolean; open: boolean }
  | { kind: 'gap'; key: string; seconds: number };

const QUESTION_WORDS = new Set([
  'what', 'why', 'how', 'when', 'where', 'which', 'who', 'whom', 'whose',
  'can', 'could', 'would', 'will', 'should', 'shall', 'do', 'does', 'did',
  'is', 'are', 'was', 'were', 'have', 'has', 'am', 'may', 'might',
]);
// Discourse words that can come before the real first word: "so how would you…".
const LEAD_INS = new Set(['so', 'and', 'okay', 'ok', 'right', 'now', 'well', 'alright', 'also', 'then', 'but']);
// A sentence ending on one of these was cut off, so it gets "…" rather than a period.
// Only words that almost never end a complete sentence ("for that", "I think so" are fine).
const DANGLING = new Set(['and', 'but', 'or', 'because', 'the', 'a', 'an', 'my', 'our', 'your', 'if', 'which', 'of']);
// Repeats that are normal English ("that that", "very very") are kept.
const KEEP_REPEATED = new Set(['that', 'had', 'very', 'really', 'no', 'yes', 'bye', 'ha']);
const FILLERS = /(?<![\w'])(?:u+m+|u+h+|e+r+m+|e+r|h+m+|m+h*m+)(?![\w'])[,.]?/gi;
const LOWERCASE_TERMS = new Set(TECH_TERMS.filter((t) => t[0] === t[0]?.toLowerCase()));

const bare = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}/-]/gu, '');
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function firstRealWord(text: string): string {
  const words = text.split(/\s+/).map(bare).filter(Boolean);
  return words.find((w) => !LEAD_INS.has(w)) ?? '';
}

export function looksLikeQuestion(text: string): boolean {
  return QUESTION_WORDS.has(firstRealWord(text));
}

/** "what is what is the SLO" → "what is the SLO". Checks longer phrases first. */
function collapseRepeats(words: string[]): string[] {
  const out = [...words];
  for (let n = 4; n >= 1; n--) {
    for (let i = 0; i + 2 * n <= out.length; i++) {
      const a = out.slice(i, i + n).map(bare);
      const b = out.slice(i + n, i + 2 * n).map(bare);
      if (n === 1 && KEEP_REPEATED.has(a[0] ?? '')) continue;
      if (a.every((w, k) => w !== '' && w === b[k])) {
        out.splice(i + n, n);
        i -= 1;
      }
    }
  }
  return out;
}

/** Fillers, repeats, terms, the user's corrections, capitals and end punctuation, in that order. */
export function cleanSentence(raw: string, replacements: Replacement[] = [], open = false): string {
  let text = raw.replace(FILLERS, ' ');
  text = collapseRepeats(text.split(/\s+/).filter(Boolean)).join(' ');
  text = correctTerms(text);
  for (const r of replacements) text = replacePhrase(text, r.heard, r.correct);
  text = text
    .replace(/\s+([,.?!…])/g, '$1')
    .replace(/,{2,}/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '');
  if (!text) return '';

  text = text.replace(/(?<![\w'])i(?=$|[\s,.?!']|'(?:m|ve|d|ll)\b)/g, 'I');
  const first = text.split(/\s/)[0] ?? '';
  if (!LOWERCASE_TERMS.has(first.replace(/[^\w-]/g, ''))) text = text[0]?.toUpperCase() + text.slice(1);

  if (/[.?!…]$/.test(text) || open) return text;
  const last = bare(text.split(/\s+/).at(-1) ?? '');
  if (DANGLING.has(last)) return `${text}…`;
  return `${text}${looksLikeQuestion(text) ? '?' : '.'}`;
}

/** Splits a fragment after ".", "?" or "!" so engine punctuation (Whisper adds some) is respected. */
function splitAtTerminalPunctuation(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/).filter(Boolean);
}

export function buildCleanTranscript(lines: TranscriptLine[], options: CleanOptions = {}): CleanItem[] {
  const { replacements = [], overrides = {}, lastIsOpen = false } = options;
  const items: CleanItem[] = [];
  let current: { key: string; parts: string[]; endMs: number; closed: boolean } | null = null;
  let lastFragment = { text: '', endMs: -Infinity };

  const finish = (open: boolean) => {
    if (!current) return;
    const raw = current.parts.join(' ');
    const override = overrides[current.key];
    const text = override ?? cleanSentence(raw, replacements, open);
    if (text) {
      items.push({
        kind: 'sentence',
        key: current.key,
        text,
        raw,
        isQuestion: text.endsWith('?'),
        edited: override !== undefined,
        open,
      });
    }
    current = null;
  };

  for (const line of lines) {
    if (line.kind === 'gap') {
      finish(false);
      items.push(line);
      continue;
    }
    const raw = line.text.trim();
    if (!raw) continue;
    // Recognizers sometimes repeat the last fragment after a restart.
    if (normalize(raw) === normalize(lastFragment.text) && line.startMs - lastFragment.endMs < DUPLICATE_WINDOW_MS) continue;
    lastFragment = { text: raw, endMs: line.endMs };

    splitAtTerminalPunctuation(raw).forEach((chunk, i) => {
      const gap = i === 0 && current ? line.startMs - current.endMs : 0;
      const startsNew =
        !current ||
        current.closed ||
        gap >= JOIN_GAP_MS ||
        (gap >= QUESTION_GAP_MS && looksLikeQuestion(chunk)) ||
        current.parts.join(' ').split(/\s+/).length >= MAX_SENTENCE_WORDS;
      if (startsNew) {
        finish(false);
        current = { key: `s${line.finalSeq}-${i}`, parts: [chunk], endMs: line.endMs, closed: false };
      } else if (current) {
        current.parts.push(chunk);
        current.endMs = line.endMs;
      }
      if (current && /[.?!]$/.test(chunk)) current.closed = true;
    });
  }
  finish(lastIsOpen);
  return items;
}

export function cleanTranscriptText(items: CleanItem[]): string {
  return items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : [])).join(' ');
}
