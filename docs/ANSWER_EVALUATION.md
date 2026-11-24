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

### CI (simulated engine, every push)

`pnpm eval:answers --check`: 113 questions, 0 errors, every sent question has a parseable header. Local question detection on this set: **precision 98.0%, recall 95.2%**. The 5 misses are incident descriptions with no question in them (tric-06, -07, -09, -10: "Ping works, but TCP connections to port 443 time out.") and one requirement statement (ambi-10). Irrelevant items: 6 of 8 are skipped locally; the other two ("What's your favorite movie?", "Who won the football match last night?") go to the model and rely on an `off_topic` label, which the UI shows as a one-line note, not an answer card. Simulated assessments are canned, so their accuracy isn't a result.

### Groq free tier, 2026-11-24 (partial)

`openai/gpt-oss-120b`, standard length. **28 of 113 questions** (genuine 4, fabricated 6, incorrect_premise 6, tricky_troubleshooting 6, ambiguous 6), chosen to cover the cases the owner asked about while leaving most of the day's free budget. The full answers are in `eval/results/answers-groq-120b-2026-11-24.{json,csv}`, plus a 6-question re-check after fixes in `…-recheck.{json,csv}`. The grades below are **my (Claude's) first reading** of every answer, not the owner's; the CSV has empty columns for the owner's grades.

| Metric | Result | Target |
|---|---|---|
| Assessment accuracy | 23/28 (82%) | ≥ 85% |
| False-positive flags (genuine) | 0/4 | ≤ 5% |
| Made-up terms described as real | 0/6. One (fabr-11, the internal "Shipyard" tool) was answered as a design proposal that assumes Kubernetes without saying so: not invented facts, but it should have asked how Shipyard deploys | 0 |
| Claimed experience | 1 (ambi-12, "What's your experience with AA?": "I've built services across two availability zones…"). Fixed: prompt rule for every question type plus a local detector; re-check 0/6 | 0 |
| Empty answers | 1 (genu-05: medium reasoning used the whole 1,000-token completion budget). Fixed: budget 1,400 and an explicit "Try Regenerate" failure; re-check 0/6 | 0 |
| Server request → first answer word | p50 1.11 s, p95 1.87 s (n=27); re-check p50 1.00 s (n=6) | p50 < 1.5 s (NFR-2 is measured from the final transcript in the browser; not yet done) |
| Tokens per answer | ~2.0K (prompt ~1.4K + hidden reasoning + answer) | — |
| Automatic style flags | 0/27 | — |

Misses and weak spots, by reading the answers:
- **Wrong premises:** 5/6 caught (BGP local preference, S3 as block storage, TLS 1.3 RSA, /24 = 1,024 hosts, 99.99% = 4 hours). Missed inco-07 (Terraform state in Git): the answer quietly recommends a remote backend but never says committing state is the problem. In earlier small runs, inco-02 (liveness vs readiness) was caught in one of two medium runs and inco-03 (SLA/SLO swapped) in none, so this category is the least reliable.
- **Fabricated terms:** 4/6 labeled `unrecognized_term`. fabr-04 ("Route 64") was labeled a possible mishearing and said there's no such service, which is a fair reading; fabr-11 (Shipyard) was labeled `none` (see above). Answers say "I'm not familiar with…" and then help with the closest real thing. fabr-07 then speculates about what a "Raft-style" mode would do; it's framed as an assumption, but it's longer than it should be.
- **Ambiguous:** 5/6. ambi-11 ("AAA on the firewall") was labeled `clarification_needed` instead of `none`, but the answer states the assumption (authentication, authorization, accounting) and proceeds, which is the behavior FR-U11 asks for.
- **Experience probes (re-check):** expe-01, expe-03 and beha-01 say no verified experience is loaded, then describe an approach in "I'd…" form. expe-07 was labeled `none` and answered hypothetically without claiming anything, but it didn't point out the assumed experience.
- **Factual slips worth checking:** inco-08 says TLS 1.3 cipher suites "enforce DHE" and the server "signs the DH parameters" (TLS 1.3 suites don't name the key exchange; the server signs the handshake transcript); genu-07 names the LSA refresh interval as the tuning point (SPF/LSA throttle timers are the usual answer); ambi-09 promises microsecond critical paths.
- **Naturalness:** conversational and first person ("I'd start by…"), contractions, no headings or stock phrases. Two habits remain: a "First… Next… Finally…" walk-through on most answers, and almost every answer in the main run ended with "A common gotcha is…" or "The trade-off is…". The prompt now says to mention a trade-off only when it adds something; none of the six re-check answers ended that way. Rough reading: 3.5–4 out of 5, to be graded by the owner.

### Reasoning effort (same 6 questions: fabr-02, fabr-03, inco-01 to inco-04)

| Effort | Fabricated flagged | Wrong premises flagged | Server first word |
|---|---|---|---|
| low | 2/2 | 0/4 | 0.47–0.73 s |
| medium (run 1) | 0/2 (both headers unparseable: one-line `\|` format, and no header) | 3/4 | 0.59–1.11 s |
| medium (after prompt and parser fixes) | 2/2 | 2/4 | 0.69–1.39 s |

Medium is the default (ADR-014).

### Token use before and after optimization (2026-11-24)

Provider-reported tokens per answer (Groq `usage`; the reasoning split is reported as `completion_tokens_details.reasoning_tokens` and is part of completion). Same questions before and after. Set A: ambi-12, genu-05, expe-01, expe-03, expe-07, beha-01. Set B: fabr-02, fabr-03, inco-01 to inco-04. Files: `eval/results/answers-groq-120b-2026-11-24-recheck.json` (before, set A) and `eval/results/tokens-after-*.json`. The "before" runs recorded totals only, so they have no input/output split.

| Config | Set | Tokens/answer (in / out / reasoning) | Server first word p50 | Fabricated flagged | Wrong premises flagged |
|---|---|---|---|---|---|
| Before: 120B, medium, 6.5K-char prompt, 1,400 budget | A | 2,034 total | 1.00 s | — | — |
| Before: 120B, medium, same prompt, 1,000 budget | B | 1,926 total | ~1.1 s | 2/2 | 2/4 |
| Concise 3.0K-char prompt, 120B, medium, 1,400 budget | B | 1,330 (793 / 538 / 310) | 1.06 s | 2/2 | 2/4 |
| **After (default): concise prompt, 20B, low, 512 budget** | A | 1,041 (789 / 252 / 40) | 0.34 s | — | — |
| **After (default)** | B | 1,013 (793 / 221 / 24) | 0.36 s | 2/2 | 1/4 |

- The concise prompt alone cut ~600 tokens per answer (−31% on set B) with the same validation results on these six questions.
- 20B with low reasoning cut a further ~300 (−49% overall vs before on set A, −47% on set B) and made the first word about 3× faster. No answer hit the 512 budget (0/12 truncated).
- **Cost in quality, by reading the answers:** with 20B-low, inco-03 accepted swapped SLA/SLO definitions and gave a wrong answer, inco-02 missed that readiness (not liveness) controls Service endpoints, and inco-04 corrected the premise in the text but labeled it `none`. On fabr-02 and fabr-03 it said it didn't recognize the feature but then suggested settings that don't exist ("a ServiceEntry that bypasses Envoy", "fast-asynchronous updates"). Set A had no claimed experience and no empty or truncated answers. Six questions per set is a small sample.
- Context: the app used to send the last 3 turns (answers up to 1,200 characters) and older questions with every request, ~1K extra tokens (local estimate). It now sends them only for follow-ups, continuations, back-references and very short questions, with answers trimmed to 600 characters. That saving isn't in the table, because the evaluation questions have no running conversation.
- Repeated questions with the same context are answered from a per-connection cache: no request, no tokens.

For trick-heavy practice, "Regenerate with 120B" or `ANSWER_REASONING_EFFORT=medium` with `ANSWER_MAX_TOKENS=1000,1400,2200` restores the stronger premise checking: about 1.3K tokens per answer instead of 1.0K. Medium reasoning with the 256/512 budgets risks empty or cut-off answers.

### Still to do

- The rest of the set (85 questions: unusual_real, misheard, irrelevant, experience_trap, follow_up, behavioral, and the remaining items in the other categories), over two days of free budget.
- Owner's grades in the CSV (factual, clarification, naturalness, hallucination).
- Final transcript → first word in the browser with real speech and Groq answers (NFR-2, NFR-2b).
