// Finds the questions in a stretch of (clean or raw) speech, even without punctuation
// (ARCHITECTURE §5.2). Pure and local. Parts are word-for-word spans of the input: extraction
// cuts and trims, it never rewrites (FR-E4).

export type PartKind = 'question' | 'request' | 'follow_up' | 'statement' | 'greeting' | 'filler' | 'abandoned';

export interface Part {
  kind: PartKind;
  text: string;
  /** The speaker asked to hear this again ("sorry, let me ask again"). */
  repeatCue?: boolean;
}

export interface Extraction {
  parts: Part[];
  /** The last part trails off ("…help me to"); wait for more speech. */
  incomplete: boolean;
}

interface Token {
  raw: string;
  bare: string;
}

const bare = (w: string) => w.toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9'/-]/g, '');

const WH = new Set(['what', 'why', 'how', 'when', 'where', 'which', 'who', 'whose']);
// "What's the difference…": a contracted wh-word starts a question when it begins a part. It
// doesn't split mid-sentence ("that's what's going on").
const WH_CONTRACTED = new Set(["what's", "how's", "where's", "who's", "why's", "when's", "what're", "how're", "where're"]);
// Imperatives that ask for an answer when they start a part ("Design a payment system…").
const PART_REQUESTS = new Set(['design', 'compare', 'define', 'outline', 'sketch', 'propose', 'list']);
// "…, didn't you?" / "…, right?": a statement turned into a question.
const TAG_QUESTION = /(?:\b(?:didn't|don't|doesn't|haven't|hasn't|isn't|aren't|wasn't|weren't|won't|wouldn't|can't|couldn't|shouldn't)\s+(?:you|it|we|they|he|she|there)|\bright|\bcorrect|\bisn't that so)\?$/i;
// With earlier context, "I meant mutual TLS" corrects the last question.
const CORRECTION_OPENERS = [['i', 'meant'], ['i', 'mean'], ['no', 'i', 'meant'], ['what', 'i', 'meant', 'was']];
const AUX = new Set(['is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'would', 'will', 'should', 'have', 'has', 'shall', 'may']);
const PRONOUNS = new Set(['you', 'we', 'it', 'they', 'i', 'he', 'she', 'there', 'that', 'this', 'your', 'our']);
// Words after a wh-word that make it a question opener rather than a clause ("what happens when you…").
const WH_FOLLOWERS = new Set([...AUX, 'about', 'if', 'happens', "what's", 'many', 'much', 'long', 'often', 'one', 'kind', 'type', "'s"]);
// Request openers, matched as word sequences.
const REQUESTS = [
  ['walk', 'me', 'through'],
  ['tell', 'me'],
  ['talk', 'about'],
  ['talk', 'me', 'through'],
  ['explain'],
  ['describe'],
  ['give', 'me', 'an', 'example'],
  ['give', 'an', 'example'],
  ['take', 'me', 'through'],
];
const ENUMERATORS = new Set(['first', 'second', 'third', 'also', 'next', 'then', 'lastly', 'finally']);
const CONJUNCTIONS = new Set(['and', 'or', 'but', 'then', 'so']);
const ENUMERATOR_PHRASES = [['another', 'question'], ['next', 'question'], ['one', 'more', 'question'], ['and', 'also']];
const ABANDON_CUES = [
  ['actually', 'wait', 'let', 'me', 'rephrase'],
  ['let', 'me', 'rephrase'],
  ['let', 'me', 'rephrase', 'that'],
  ['never', 'mind', 'that'],
  ['never', 'mind'],
  ['scratch', 'that'],
  ['forget', 'that'],
];
const REPEAT_CUES = [['sorry', 'let', 'me', 'ask', 'again'], ['let', 'me', 'ask', 'again'], ['let', 'me', 'repeat'], ['let', 'me', 'repeat', 'that'], ['i', 'will', 'ask', 'again']];
// Greetings, logistics and small talk, matched at the start of a part.
const GREETINGS = [
  ['hi'], ['hello'], ['hey'], ['good', 'morning'], ['good', 'afternoon'],
  ['thanks', 'for', 'joining'], ['thank', 'you', 'for', 'joining'], ['nice', 'to', 'meet', 'you'],
  ['can', 'you', 'hear', 'me', 'okay'], ['can', 'you', 'hear', 'me', 'ok'], ['can', 'you', 'hear', 'me'],
  ['can', 'you', 'see', 'my', 'screen'], ['okay', 'can', 'you', 'see', 'it'], ['can', 'you', 'see', 'it'],
  ['let', 'me', 'share', 'my', 'screen'], ['how', 'are', 'you', 'doing'], ['how', 'are', 'you'],
  ['how', 'was', 'your', 'weekend'], ["how's", 'it', 'going'], ['how', 'is', 'it', 'going'],
];
const FILLERS = new Set([
  'okay', 'ok', 'great', 'so', 'right', 'yeah', 'yes', 'um', 'uh', 'erm', 'hmm', 'alright', 'cool', 'perfect',
  'sure', 'well', 'thanks', 'awesome', 'good', 'nice', 'sorry',
]);
const ACK_PHRASES = [['that', 'makes', 'sense'], ['got', 'it'], ['thank', 'you'], ['makes', 'sense'], ['i', 'see']];
// A part ending on one of these is unfinished.
const DANGLING = new Set(['to', 'for', 'the', 'a', 'an', 'and', 'or', 'but', 'of', 'with', 'about', 'my', 'your', 'our', 'because', 'if', 'was', 'into', 'from', 'like', 'that']);
// Back-references that make "… and <question>" depend on the first part (a compound question).
const BACK_REFERENCES = new Set(['it', 'its', "it's", 'that', 'this', 'they', 'them', 'those', 'these', 'one', 'first', 'then']);

function startsWith(tokens: Token[], at: number, phrase: string[]): boolean {
  return phrase.every((w, k) => tokens[at + k]?.bare === w);
}

function matchAny(tokens: Token[], at: number, phrases: string[][]): number {
  let best = 0;
  for (const p of phrases) if (p.length > best && startsWith(tokens, at, p)) best = p.length;
  return best;
}

/** Does a question or request start at `at`? */
function opensQuestion(tokens: Token[], at: number): 'question' | 'request' | null {
  const w = tokens[at]?.bare ?? '';
  const next = tokens[at + 1]?.bare ?? '';
  if (matchAny(tokens, at, REQUESTS)) return 'request';
  // "…for speed, so what extra encryption should we add": a wh-word after "so" or a comma, with
  // an auxiliary within the next few words.
  const before = tokens[at - 1];
  if (WH.has(w) && before && (before.bare === 'so' || before.raw.endsWith(',')) && tokens.slice(at + 1, at + 5).some((t) => AUX.has(t.bare))) {
    return 'question';
  }
  if (WH.has(w) && (WH_FOLLOWERS.has(next) || next === '')) return 'question';
  if (WH.has(w) && w === 'how' && /^(do|does|would|can|is|are|should|will|did)$/.test(next)) return 'question';
  // "…what a service mesh is and when…": an auxiliary followed by a conjunction ends a clause.
  if (AUX.has(w) && (PRONOUNS.has(next) || (next !== '' && !AUX.has(next) && !WH.has(next) && !CONJUNCTIONS.has(next)))) {
    return 'question';
  }
  return null;
}

/** A part can stand on its own: enough words and no dangling last word. */
function complete(tokens: Token[]): boolean {
  return tokens.length >= 3 && !DANGLING.has(tokens.at(-1)?.bare ?? '');
}

function text(tokens: Token[]): string {
  return tokens.map((t) => t.raw).join(' ');
}

/** Removes greetings and fillers from the front of a part; returns what was removed as their own parts. */
function stripLeading(tokens: Token[]): { leading: Part[]; rest: Token[]; repeatCue: boolean } {
  const leading: Part[] = [];
  let rest = tokens;
  let repeatCue = false;
  for (;;) {
    const greet = matchAny(rest, 0, GREETINGS);
    if (greet) {
      // A greeting followed straight away by fillers ("can you hear me okay great so"): keep together as two parts.
      leading.push({ kind: 'greeting', text: text(rest.slice(0, greet)) });
      rest = rest.slice(greet);
      continue;
    }
    const repeat = matchAny(rest, 0, REPEAT_CUES);
    if (repeat) {
      leading.push({ kind: 'filler', text: text(rest.slice(0, repeat)) });
      rest = rest.slice(repeat);
      repeatCue = true;
      continue;
    }
    let n = 0;
    while (n < rest.length && FILLERS.has(rest[n]?.bare ?? '') && !opensQuestion(rest, n)) n++;
    if (n > 0 && n < rest.length) {
      leading.push({ kind: 'filler', text: text(rest.slice(0, n)) });
      rest = rest.slice(n);
      continue;
    }
    const enumerator = matchAny(rest, 0, ENUMERATOR_PHRASES) || (ENUMERATORS.has(rest[0]?.bare ?? '') && opensQuestion(rest, 1) ? 1 : 0);
    if (enumerator && rest.length > enumerator) {
      rest = rest.slice(enumerator); // "first", "and also": boundary markers, not content
      continue;
    }
    return { leading, rest, repeatCue };
  }
}

function classify(tokens: Token[]): PartKind {
  const opener = opensQuestion(tokens, 0);
  if (opener) return opener;
  // Splitting needs a strong cue, but any part that starts with a wh-word is a question.
  if (WH.has(tokens[0]?.bare ?? '') || WH_CONTRACTED.has(tokens[0]?.bare ?? '')) return 'question';
  if (PART_REQUESTS.has(tokens[0]?.bare ?? '') && tokens.length >= 3) return 'request';
  if (TAG_QUESTION.test(text(tokens))) return 'question';
  if (tokens.every((t) => FILLERS.has(t.bare))) return 'filler';
  let i = 0;
  while (i < tokens.length) {
    if (FILLERS.has(tokens[i]?.bare ?? '')) i++;
    else {
      const ack = matchAny(tokens, i, ACK_PHRASES);
      if (!ack) break;
      i += ack;
    }
  }
  if (i === tokens.length) return 'filler';
  const first = tokens[0]?.bare ?? '';
  if ((first === 'and' || first === 'what') && (tokens[1]?.bare === 'if' || tokens[1]?.bare === 'about')) return 'follow_up';
  if (first === 'and' && opensQuestion(tokens, 1)) return 'follow_up';
  return 'statement';
}

/**
 * Splits `input` into parts. `hasContext` marks short "and if…" continuations as follow-ups.
 */
export function extractQuestions(input: string, opts: { hasContext?: boolean } = {}): Extraction {
  const tokens: Token[] = input
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, bare: bare(raw) }))
    .filter((t) => t.bare !== '' || /[?.!]/.test(t.raw));
  if (tokens.length === 0) return { parts: [], incomplete: false };

  // 1. Cut into segments at punctuation, abandon cues, enumerators, and new question openers.
  const segments: { tokens: Token[]; abandonedBefore?: boolean }[] = [];
  let current: Token[] = [];
  let abandonNext = false;
  const flush = () => {
    if (current.length) segments.push({ tokens: current, ...(abandonNext ? { abandonedBefore: true } : {}) });
    abandonNext = false;
    current = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    const abandon = matchAny(tokens, i, ABANDON_CUES);
    if (abandon) {
      // Everything said since the last boundary is dropped; the cue itself is filler.
      let start = i;
      while (start > 0 && FILLERS.has(tokens[start - 1]?.bare ?? '') && current.length && current.at(-1) === tokens[start - 1]) {
        start--;
        current.pop();
      }
      if (current.length) segments.push({ tokens: current, abandonedBefore: true });
      current = tokens.slice(start, i + abandon);
      segments.push({ tokens: current });
      current = [];
      i += abandon - 1;
      continue;
    }
    if (current.length > 0) {
      const enumerator = matchAny(tokens, i, ENUMERATOR_PHRASES) || (ENUMERATORS.has(tok.bare) && opensQuestion(tokens, i + 1) ? 1 : 0);
      const opener = opensQuestion(tokens, i);
      const prev = tokens[i - 1]?.bare ?? '';
      // Judge the earlier part without a joining "and"/"or" ("what about ospf | and how…").
      const joined = prev === 'and' || prev === 'or';
      const prevRest = stripLeading(joined ? current.slice(0, -1) : current).rest;
      // An auxiliary ("is etcd encrypted…") only starts a new question right after a complete
      // question; after a wh-word it's part of the same one ("how would you").
      const auxOpener = opener === 'question' && AUX.has(tok.bare);
      // "…which node a pod | is scheduled on": an embedded wh-clause still needs its verb.
      const embeddedWh = prevRest.slice(1).slice(-4).some((t) => WH.has(t.bare));
      const auxAllowed = !auxOpener || (!WH.has(prev) && !embeddedWh && prevRest.length >= 4 && opensQuestion(prevRest, 0) !== null);
      if (enumerator && (complete(prevRest) || current.length >= 3)) {
        flush();
      } else if (opener && auxAllowed && complete(prevRest)) {
        if (prev === 'and' || prev === 'or') {
          // "… and how is it different": a compound question when the second part leans on the first.
          const restWords = tokens.slice(i).map((t) => t.bare);
          const leans = restWords.some((w) => BACK_REFERENCES.has(w)) || restWords.length < 6;
          if (!leans) {
            current.pop(); // drop the joining "and"
            flush();
          }
        } else if (!(tok.bare === 'what' && prev === 'know') && !(PRONOUNS.has(prev) && AUX.has(tok.bare))) {
          flush();
        }
      }
    }
    current.push(tok);
    if (/[?.!]$/.test(tok.raw)) flush();
  }
  flush();

  // 2. Strip leading greetings/fillers from each segment and classify what's left.
  const parts: Part[] = [];
  let pendingRepeat = false; // a repeat cue can end up in its own segment, before the question
  for (const segment of segments) {
    const stripped = stripLeading(segment.tokens);
    const { leading, rest } = stripped;
    const repeatCue: boolean = stripped.repeatCue || pendingRepeat;
    parts.push(...leading);
    if (rest.length === 0) {
      pendingRepeat = repeatCue;
      continue;
    }
    pendingRepeat = false;
    if (segment.abandonedBefore) {
      parts.push({ kind: 'abandoned', text: text(rest) });
      continue;
    }
    if (matchAny(rest, 0, ABANDON_CUES) || (rest.every((t) => FILLERS.has(t.bare) || ['never', 'mind', 'that', 'wait', 'actually', 'let', 'me', 'rephrase', 'scratch', 'forget'].includes(t.bare)))) {
      parts.push({ kind: 'filler', text: text(rest) });
      continue;
    }
    let kind = classify(rest);
    if (kind === 'question' && opts.hasContext && rest.length <= 8 && rest[0]?.bare === 'and') kind = 'follow_up';
    if (kind === 'statement' && opts.hasContext && matchAny(rest, 0, CORRECTION_OPENERS) && rest.length >= 3) kind = 'follow_up';
    parts.push({ kind, text: text(rest), ...(repeatCue ? { repeatCue: true } : {}) });
  }

  // 3. A trailing question or request that dangles isn't ready; drop duplicates said back to back.
  const last = parts.at(-1);
  // Trailing fillers don't finish a sentence: "what I wanted to ask was, uh" still dangles.
  const lastTokens = last ? last.text.split(/\s+/).map(bare).filter(Boolean) : [];
  while (lastTokens.length > 1 && FILLERS.has(lastTokens.at(-1) ?? '')) lastTokens.pop();
  const incomplete = !!last && last.kind !== 'filler' && last.kind !== 'greeting' && DANGLING.has(lastTokens.at(-1) ?? '') && !/[?.!]$/.test(last.text);
  const kept: Part[] = [];
  for (const p of incomplete ? parts.slice(0, -1) : parts) {
    const prev = kept.at(-1);
    if (prev && isAnswerable(prev) && isAnswerable(p) && normalizeQuestion(prev.text) === normalizeQuestion(p.text)) continue;
    kept.push(p);
  }
  return { parts: kept, incomplete };
}

export function isAnswerable(part: Part): boolean {
  return part.kind === 'question' || part.kind === 'request' || part.kind === 'follow_up';
}

/** Lowercase words only, for comparing questions. */
export function normalizeQuestion(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
