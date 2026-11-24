# Answer evaluation (Phases 4–5)

How suggested answers will be checked once Phase 4 exists. The questions are in `eval/answer-questions.json`; nothing has been run yet because there is no answer engine.

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

## Running it (Phase 4)

- **CI:** simulated answers only. Checks that every question produces a parseable header and that local pre-checks skip the `irrelevant` items. No API calls.
- **Manual:** one pass over all 113 questions with the free-tier answer provider, about 113 requests, well under the daily free limit. Run it after prompt changes and record results below.

## Results

None yet.
