// Knowledge base (Phase 5, FR-K1–K5): the candidate's own resume, job descriptions, stories,
// projects, internal terms and reference notes. Items live only in the browser (IndexedDB); per
// question, a few relevant excerpts are picked locally and sent with the answer request. Never the
// whole KB.

import { z } from 'zod';

export const KB_KINDS = ['resume', 'job', 'story', 'project', 'skill', 'term', 'reference'] as const;
export const PROVENANCES = ['verified', 'theoretical', 'hypothetical'] as const;
export type KbKind = (typeof KB_KINDS)[number];
/** verified = hands-on, theoretical = knows it without hands-on, hypothetical = illustration only (FR-K3). */
export type Provenance = (typeof PROVENANCES)[number];

export interface KbItem {
  id: string;
  kind: KbKind;
  provenance: Provenance;
  title: string;
  text: string;
  /** Used in answers; unticked items stay stored but are never sent (e.g. an older resume). */
  active: boolean;
  updatedAt: number;
}

/** Kinds that describe the candidate; the others are context (a job ad, a term, a doc excerpt). */
export const hasProvenance = (kind: KbKind): boolean => !['job', 'term', 'reference'].includes(kind);

export const SNIPPET_CHARS = 700;
export const MAX_SNIPPETS = 6;

export const kbSnippetSchema = z.strictObject({
  kind: z.enum(KB_KINDS),
  provenance: z.enum(PROVENANCES),
  title: z.string().max(120),
  text: z.string().min(1).max(SNIPPET_CHARS),
});
export type KbSnippet = z.infer<typeof kbSnippetSchema>;

const KIND_LABEL: Record<KbKind, string> = {
  resume: 'resume',
  job: 'job description',
  story: 'story',
  project: 'project',
  skill: 'skill',
  term: 'internal term',
  reference: 'reference',
};

/** "[verified story]", "[internal term]": the label the prompt rules refer to. */
export function snippetLabel(s: Pick<KbSnippet, 'kind' | 'provenance'>): string {
  return hasProvenance(s.kind) ? `[${s.provenance} ${KIND_LABEL[s.kind]}]` : `[${KIND_LABEL[s.kind]}]`;
}

// Behavioral openers, checked locally so the STAR rule is only sent when it applies (FR-Q8).
const BEHAVIORAL =
  /^(?:(?:so|okay|ok|and|now)[,\s]+)*(?:tell me about a (?:time|situation)|describe a (?:time|situation)|give me an example of (?:a time|when)|walk me through a time|have you ever|share an example of|what's an example of a time)|\ba time (?:when|you)\b/i;
export const isBehavioral = (question: string): boolean => BEHAVIORAL.test(question.trim());

const STOP = new Set(
  (
    'a an the and or but if then so of to in on at by for with from as is are was were be been being do does did have has had ' +
    'i me my we our you your it its this that these those there here what which who whom whose when where why how would could ' +
    'should can will shall may might must not no yes about into over under up down out than too very just also any some all ' +
    'each more most other such only own same few both tell time describe example give walk through share like get got use used ' +
    'using one two work worked working think know make made way thing things lot really well okay ok'
  ).split(' '),
);

/** Lowercase keywords: stop words dropped, a trailing plural "s" removed. Keeps p99, k8s, ci/cd. */
export function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/’/g, "'")
    .split(/[^a-z0-9/+#.-]+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, '').replace(/'s$/, ''))
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** Cuts long text at a sentence or word boundary. */
export function clip(text: string, max = SNIPPET_CHARS): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sentence = cut.lastIndexOf('. ');
  return `${cut.slice(0, sentence > max / 2 ? sentence + 1 : cut.lastIndexOf(' ')).trim()}…`;
}

/**
 * Long items (a resume, a job ad, a doc excerpt) split into chunks: paragraphs never merge, and a
 * long paragraph splits at its lines or bullets, which are grouped up to `size` characters.
 */
export function chunks(item: KbItem, size = 350): string[] {
  if (item.text.length <= size) return [item.text.trim()].filter(Boolean);
  const out: string[] = [];
  for (const paragraph of item.text.split(/\n\s*\n/)) {
    let current = '';
    for (const line of paragraph.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (current && current.length + line.length + 1 > size) {
        out.push(current);
        current = '';
      }
      current = current ? `${current}\n${line}` : line;
    }
    if (current) out.push(current);
  }
  return out.map((c) => clip(c));
}

/**
 * Picks the excerpts that share the most keywords with the question and its context (FR-K2):
 * at most `max` snippets and `maxChars` characters. Internal terms named in the question always
 * come along, so they aren't flagged as unrecognized. Inactive items are never sent.
 */
export function retrieve(items: readonly KbItem[], query: string, opts: { max?: number; maxChars?: number } = {}): KbSnippet[] {
  const max = opts.max ?? 5;
  const maxChars = opts.maxChars ?? 2400;
  const q = new Set(keywords(query));
  if (q.size === 0) return [];
  const scored: { snippet: KbSnippet; score: number }[] = [];
  for (const item of items) {
    if (!item.active || !item.text.trim()) continue;
    const titleWords = new Set(keywords(item.title));
    const termHit = item.kind === 'term' && [...titleWords].length > 0 && [...titleWords].every((w) => q.has(w));
    for (const text of chunks(item)) {
      const words = new Set(keywords(text));
      let score = 0;
      for (const w of q) score += (words.has(w) ? 1 : 0) + (titleWords.has(w) ? 0.5 : 0);
      if (termHit) score += 10;
      if (score < 1) continue;
      if (item.provenance === 'verified' && hasProvenance(item.kind)) score += 0.25;
      scored.push({ snippet: { kind: item.kind, provenance: item.provenance, title: clip(item.title, 120), text }, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.snippet.text.length - b.snippet.text.length);
  const picked: KbSnippet[] = [];
  let used = 0;
  for (const { snippet } of scored) {
    if (picked.length >= max) break;
    if (used + snippet.text.length > maxChars) continue;
    picked.push(snippet);
    used += snippet.text.length;
  }
  return picked;
}
