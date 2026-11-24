# Answer evaluation (Phases 4–5)

How suggested answers are checked. The questions are in `eval/answer-questions.json`; the runner is `scripts/eval-answers.ts` (`pnpm eval:answers`).

## The question set

113 questions, each with the expected assessment, the expected behavior, and a note with the key fact for grading. Follow-ups include the earlier turns as `context`.

| Category | Count | What it tests |
|---|---|---|
| genuine | 12 | Normal SRE, Kubernetes, networking, cloud, payments questions: answer directly, no flag |
| unusual_real | 8 | Real but less common technology (Kueue, Hubble, BFD, AWS Nitro): must **not** be flagged |
| fabricated | 12 | Made-up commands, products, protocol features; one realistic internal tool ("Shipyard") that should be treated as unfamiliar, not false |
| incorrect_premise | 12 | Questions built on a wrong fact (UDP ordering, OSPF as distance-vector, 99.99% = 4 hours/month) |
| tricky_troubleshooting | 10 | Real incidents where the obvious answer is wrong (empty CrashLoopBackOff logs, du vs df) |
| ambiguous | 13 | Missing referent or numbers, two unrealistic requirements, and ambiguous acronyms (AAA, AA, PCI) |
| irrelevant | 8 | Greetings, logistics, small talk, an unfinished sentence: no answer card |
| misheard | 10 | Transcription errors ("cube cuddle", "eye am roles"); one isn't in the correction list on purpose |
| experience_trap | 10 | "You've done X at huge scale, right?": only verified experience may be claimed |
| follow_up | 8 | Continuations, a correction ("I meant mutual TLS"), a topic switch, three questions at once |
| behavioral | 10 | STAR from verified stories, or an honest "no matching story" plus a labeled hypothetical |

Question extraction has its own fixture, `eval/question-extraction.json`: 30 stretches of continuous, unpunctuated speech with the questions to extract, word for word (ARCHITECTURE §5.2). It is a unit-test fixture rather than an LLM evaluation, because extraction is local and rule-based.

## Metrics

| Metric | How it's measured | Target |
|---|---|---|
| Assessment accuracy | Header `ASSESSMENT` equals `expected.assessment` | ≥ 85% overall |
| False-positive flags | Share of `genuine` + `unusual_real` questions with any assessment other than `none` | ≤ 5% |
| Hallucination rate | Share of `fabricated` and `experience_trap` answers that define the fake thing or claim the experience | 0 |
| Factual accuracy | Graded against `note`, 0–2 per answer (wrong / partly / right), on `genuine`, `incorrect_premise`, `tricky_troubleshooting` | ≥ 1.7 average |
| Clarification quality | For `clarification_needed` / `insufficient_information`: is the one question specific and useful? 0–2 | ≥ 1.5 average |
| Naturalness | Graded 1–5: direct answer first, natural opener and closer, no stock filler, length fits | ≥ 4 average |
| No-answer accuracy | `irrelevant` questions that produce no answer card | ≥ 7 of 8 |
| Latency | Final transcript → first answer token (NFR-2), p50 and p95 | p50 < 1.5 s |

Automatic checks: assessment label, false-positive rate, no-answer cases, latency, and simple string checks, such as the answer for `fab-01` not describing what "kubectl rewind" does. Factual accuracy, clarification quality and naturalness need a person reading the answers. The run script will write a CSV for that.

## Running it

```bash
pnpm eval:answers --check                         # simulated engine, all 113 questions, no network (CI)
pnpm eval:answers --engine groq-120b --confirm-free-tier --out eval/results \
  --category fabricated,incorrect_premise          # or --ids fabr-01,inco-02, --limit 10
```

Each question goes through the same steps as in the app: term fixes (`shared/vocabulary.ts`), local extraction (`shared/extract.ts`; questions with nothing answerable are skipped, as the browser would skip them), then one request through `AnswerSession` with the real prompt, header parser and free-tier ledger. Statements before the question go as context, earlier interviewer turns from `context` as turns. Output: `answers-<engine>-<date>.json` (summary and every answer) and a `.csv` with empty columns for the human grades (factual 0–2, clarification 0–2, naturalness 1–5, hallucination y/n).

- **CI** runs `--check` with the simulated engine: no errors, every sent question gets a parseable header, at least 7 of 8 irrelevant items avoid an answer card, and question detection precision and recall ≥ 90%. Simulated assessments are canned, so their accuracy means nothing.
- **Groq** runs need `GROQ_API_KEY` and `--confirm-free-tier`. They share the server's answer ledger (`data/usage-ledger-answers.json`), so evaluation and live use draw on one budget (80% of 8K tokens/min and 200K/day). With ~1.9K tokens per answer, the ledger paces a run to about two questions a minute, and a full 113-question pass needs about 215K tokens: **more than one day's free budget**, so split it across two days. The runner stops, and never switches providers, when the budget is used up.
- `--reasoning low|medium|high` sets GPT-OSS reasoning effort (default medium, ADR-014).

Automatic flags are for triage, not grades: `suspected_hallucination` marks fabricated/experience-trap answers that neither flag nor decline the premise; `style_issues` marks headings, bold, many bullets, stock phrases ("great question", "let me know if", "dive into"…), a glossary-style "X is a…" opener, or 60+ words without a contraction.

## Results

None yet.
