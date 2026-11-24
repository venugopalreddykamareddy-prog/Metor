// Answer evaluation runner (docs/ANSWER_EVALUATION.md).
//
//   pnpm eval:answers                      simulated engine, all questions, no network (CI runs this with --check)
//   pnpm eval:answers --engine groq-120b --category fabricated,incorrect_premise --confirm-free-tier
//
// Questions go through the same steps as in the app: term fixes, local extraction (skipped when
// nothing answerable is found), then one request through AnswerSession, so the prompt, the header
// parser, and the free-tier ledger are exactly what users get. Groq runs need GROQ_API_KEY and
// --confirm-free-tier; there is no paid provider and no fallback.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { FastifyBaseLogger } from 'fastify';
import { ANSWER_ENGINES, type AnswerEngine, type ServerMessageBody } from '../shared/messages.ts';
import { extractQuestions, isAnswerable } from '../shared/extract.ts';
import { findExperienceClaims } from '../shared/experienceClaims.ts';
import { correctTerms } from '../shared/vocabulary.ts';
import { GROQ_CHAT_LIMITS, scaled } from '../server/src/app.ts';
import { AnswerSession } from '../server/src/answer/engine.ts';
import { parseAnswerMaxTokens } from '../server/src/config.ts';
import { summarize, styleIssues, suspectedHallucination, toCsv, type EvalQuestion, type EvalResult } from '../server/src/answer/evaluate.ts';
import { createGroqAnswer } from '../server/src/answer/groq.ts';
import type { AnswerRequest } from '../server/src/answer/prompt.ts';
import { createSimulatedAnswer } from '../server/src/answer/simulated.ts';
import type { AnswerProvider } from '../server/src/answer/types.ts';
import { UsageLedger } from '../server/src/limits/usageLedger.ts';

const { values: args } = parseArgs({
  options: {
    engine: { type: 'string', default: 'simulated' },
    file: { type: 'string', default: 'eval/answer-questions.json' },
    category: { type: 'string' },
    ids: { type: 'string' },
    limit: { type: 'string' },
    length: { type: 'string', default: 'standard' },
    out: { type: 'string', default: 'test-results/eval' },
    check: { type: 'boolean', default: false },
    reasoning: { type: 'string', default: 'low' },
    'max-tokens': { type: 'string' },
    'confirm-free-tier': { type: 'boolean', default: false },
  },
});

const engine = args.engine as AnswerEngine;
if (!ANSWER_ENGINES.includes(engine)) throw new Error(`--engine must be one of ${ANSWER_ENGINES.join(', ')}`);
const length = args.length as AnswerRequest['length'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The server logger is pino; the runner only needs these calls. Messages never include keys.
const log = {
  info() {},
  debug() {},
  warn: (obj: unknown, msg?: string) => console.warn('warn:', msg ?? '', JSON.stringify(obj)),
  error: (obj: unknown, msg?: string) => console.error('error:', msg ?? '', JSON.stringify(obj)),
} as unknown as FastifyBaseLogger;

const providers: Partial<Record<AnswerEngine, AnswerProvider>> = { simulated: createSimulatedAnswer(0) };
let ledger: UsageLedger | null = null;
if (engine !== 'simulated') {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set; Groq runs need the free-tier key on the server side.');
  if (!args['confirm-free-tier']) {
    throw new Error('This sends real requests to the Groq free tier. Re-run with --confirm-free-tier to go ahead.');
  }
  // Same ledger file and limits as the server, so evaluation and live use share one budget.
  const base = process.env.SPEND_LEDGER_PATH || './data/usage-ledger.json';
  const ratio = Math.min(1, Number(process.env.FREE_QUOTA_SAFETY_RATIO || 0.8));
  ledger = new UsageLedger(base.replace(/(\.json)?$/, '-answers.json'), scaled(GROQ_CHAT_LIMITS, ratio));
  await ledger.load();
  const model = engine === 'groq-20b' ? 'openai/gpt-oss-20b' : 'openai/gpt-oss-120b';
  const reasoningEffort = args.reasoning as 'low' | 'medium' | 'high';
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) throw new Error('--reasoning must be low, medium or high');
  providers[engine] = createGroqAnswer({ apiKey, model, log, reasoningEffort });
}

// Same default budgets as the server (ANSWER_MAX_TOKENS), unless --max-tokens overrides.
const maxTokens = parseAnswerMaxTokens(args['max-tokens'] ?? process.env.ANSWER_MAX_TOKENS);

const { questions: all } = JSON.parse(await readFile(args.file, 'utf8')) as { questions: EvalQuestion[] };
const categories = args.category?.split(',');
const ids = args.ids?.split(',');
let questions = all.filter((q) => (!categories || categories.includes(q.category)) && (!ids || ids.includes(q.id)));
if (args.limit) questions = questions.slice(0, Number(args.limit));
console.log(`${questions.length} questions · engine ${engine} · length ${length}`);

/** Runs one request through AnswerSession and collects what the client would receive. */
async function ask(req: AnswerRequest) {
  const got = { header: null as Extract<ServerMessageBody, { type: 'answer.header' }> | null, text: '', done: null as Extract<ServerMessageBody, { type: 'answer.done' }> | null, failed: null as Extract<ServerMessageBody, { type: 'answer.failed' }> | null };
  const session = new AnswerSession({ providers, ledger, maxAnswers: Number.POSITIVE_INFINITY, log, maxTokens }, (msg) => {
    if (msg.type === 'answer.header') got.header = msg;
    else if (msg.type === 'answer.delta') got.text += msg.text;
    else if (msg.type === 'answer.done') got.done = msg;
    else if (msg.type === 'answer.failed') got.failed = msg;
  });
  await session.handle(req);
  return got;
}

const results: EvalResult[] = [];
let n = 0;
for (const q of questions) {
  n += 1;
  // Local steps first, as in the browser: term fixes, then extraction.
  const text = correctTerms(q.question);
  const parts = extractQuestions(text, { hasContext: Boolean(q.context?.length) }).parts;
  const answerable = parts.filter(isAnswerable);
  const base = { id: q.id, category: q.category, question: q.question, expected: q.expected.assessment };
  if (answerable.length === 0) {
    results.push({ ...base, assessment: null, questionType: null, note: 'no answerable question found locally', clarify: null, answer: '', firstTokenMs: null, totalMs: null, tokens: null, error: null, style: [], suspectedHallucination: false, experienceClaims: [] });
    console.log(`${n}/${questions.length} ${q.id}: skipped locally`);
    continue;
  }
  const req: AnswerRequest = {
    type: 'answer.request',
    id: `eval-${q.id}`,
    ts: Date.now(),
    questionId: `eval-${q.id}-${Date.now()}`,
    question: answerable.map((p) => p.text).join(' '),
    ...(text !== q.question ? { heard: q.question } : {}),
    length,
    engine,
    statements: parts.filter((p) => p.kind === 'statement').map((p) => p.text).slice(-5),
    turns: (q.context ?? []).filter((c) => c.role === 'interviewer').slice(-4).map((c) => ({ question: c.text, answer: '(earlier answer not recorded)' })),
    isFollowUp: answerable.some((p) => p.kind === 'follow_up') || Boolean(q.context?.length),
  };

  // Free-tier pacing: the ledger refuses requests over the per-minute budget, so wait and retry.
  let got = await ask(req);
  for (let attempt = 1; got.failed?.code === 'quota_exhausted' && attempt <= 6; attempt++) {
    console.log(`  quota: ${got.failed.message} Waiting 20 s (attempt ${attempt}/6)…`);
    await sleep(20_000);
    got = await ask({ ...req, questionId: `${req.questionId}-r${attempt}` });
  }
  const answer = got.text.trim();
  const assessment = got.header?.assessment ?? (got.done ? 'none' : null);
  const error = got.failed ? `${got.failed.code}: ${got.failed.message}` : got.done ? null : 'no result';
  results.push({
    ...base,
    assessment: error ? null : assessment,
    questionType: got.header?.questionType ?? null,
    note: got.header?.note ?? null,
    clarify: got.header?.clarify ?? null,
    answer,
    firstTokenMs: got.done?.firstTokenMs ?? null,
    totalMs: got.done?.totalMs ?? null,
    tokens: got.done?.usage ? got.done.usage.promptTokens + got.done.usage.completionTokens : null,
    promptTokens: got.done?.usage?.promptTokens ?? null,
    completionTokens: got.done?.usage?.completionTokens ?? null,
    reasoningTokens: got.done?.usage?.reasoningTokens ?? null,
    truncated: got.done?.truncated ?? false,
    error,
    style: styleIssues(answer),
    suspectedHallucination: error ? false : suspectedHallucination(q.category, answer, assessment),
    experienceClaims: findExperienceClaims(answer),
  });
  console.log(`${n}/${questions.length} ${q.id}: ${error ?? `${assessment} (expected ${q.expected.assessment})`}`);
  if (got.failed?.code === 'quota_exhausted') {
    console.log('Free-tier budget is used up for now; stopping. Nothing switches to a paid provider.');
    break;
  }
}
await ledger?.flush();

// Detection: should this text get an answer? Irrelevant items should not, everything else should.
const detected = results.filter((r) => r.note !== 'no answerable question found locally');
const shouldAnswer = (r: EvalResult) => r.category !== 'irrelevant';
const tp = detected.filter(shouldAnswer).length;
const detection = {
  precision: detected.length ? Math.round((1000 * tp) / detected.length) / 10 : null,
  recall: Math.round((1000 * tp) / Math.max(1, results.filter(shouldAnswer).length)) / 10,
  missed: results.filter((r) => shouldAnswer(r) && !detected.includes(r)).map((r) => r.id),
};
const summary = { engine, length, reasoning: engine === 'simulated' ? null : args.reasoning, maxTokens, date: new Date().toISOString(), detection, ...summarize(results) };

await mkdir(args.out, { recursive: true });
const stem = `${args.out}/answers-${engine}-${summary.date.slice(0, 10)}`;
await writeFile(`${stem}.json`, JSON.stringify({ summary, results }, null, 2) + '\n');
await writeFile(`${stem}.csv`, toCsv(results));
console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote ${stem}.json and ${stem}.csv`);

if (args.check) {
  // CI (simulated): every sent question gets a parseable header, no errors, and the local checks
  // keep at least 7 of 8 irrelevant items from producing an answer card.
  const problems: string[] = [];
  if (summary.errors > 0) problems.push(`${summary.errors} errors`);
  const unparsed = results.filter((r) => r.assessment !== null && r.questionType === null);
  if (unparsed.length) problems.push(`no header: ${unparsed.map((r) => r.id).join(', ')}`);
  // No card: skipped locally, or labeled off_topic (shown as a one-line note, not an answer).
  const [noCard = 0, irrelevant = 0] = summary.noAnswerIrrelevant.split('/').map(Number);
  if (irrelevant >= 8 && noCard < 7) problems.push(`only ${noCard}/${irrelevant} irrelevant items avoid an answer card`);
  if (detection.recall < 90 || (detection.precision ?? 0) < 90) problems.push(`detection precision ${detection.precision}% / recall ${detection.recall}%`);
  if (problems.length) {
    console.error(`Check failed: ${problems.join('; ')}`);
    process.exit(1);
  }
  console.log('Check passed.');
}
