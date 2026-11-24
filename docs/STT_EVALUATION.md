# Transcription evaluation

How Browser speech and Groq Whisper compare on my voice, for SRE, Kubernetes, networking, AWS, and Azure vocabulary. Simulated mode isn't evaluated; it's canned text for tests.

## How to run it

1. In the Codespace, start the app (`pnpm dev`) and open port 5173 in **Chrome** (Browser speech needs Chrome or Edge).
2. Use the same mic and room for every run. Headphones avoid echo.
3. Pick a mode, press Start, open **Accuracy check**, and read the script aloud at a normal interview pace. Pause briefly between sentences.
4. Press Stop, then **Score transcript**. Clear the transcript and repeat for the other mode.
5. Copy the rows into the table below with the date, browser, and mic.

The script has 10 sentences and 33 technical terms. It can be edited in the panel; keep the same text for runs you compare.

## What the numbers mean

| Metric | Meaning |
|---|---|
| Word error rate (raw / clean) | (substituted + missing + extra words) ÷ words in the script, after lowercasing and removing punctuation. Lower is better. Scored for the raw recognizer output and for the cleaned view. |
| Tech terms (raw / clean) | How many of the script's technical terms (from `shared/vocabulary.ts`) appear in each view. The difference shows what the term fixes contribute. |
| Final latency p50 | Groq: end of a speech segment → its text arriving. Browser speech: last interim result → final result. The two aren't the same measurement; Groq's also includes waiting for the pause that closes a segment. |

## Results

**Status when Phase 3 merged (2026-11-24):** finalization latency measured three times by the owner (below). **Accuracy (word error rate, term recall) has not been measured for either mode, and Groq transcription has not been tried live.** These stay open and are now part of Phase 4's acceptance list. Real runs need a real voice and mic, which CI and the Codespace can't provide.

| Date | Mode | Browser / mic | WER raw | WER clean | Terms raw | Terms clean | Final latency p50 | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-11-24 | Browser speech | Chrome / owner's mic | — | — | — | — | 0.45 s (n=6) | Owner's first manual test: recognition works; fragmented, no capitals or punctuation. Accuracy script not run yet. |
| 2026-11-24 | Browser speech (clean view) | Chrome / owner's mic | — | — | — | — | 0.44 s (n=6) | Sentence merging and term recognition improved; several questions spoken in a row merge into one paragraph (to be handled by Phase 4 question extraction). Accuracy script not run yet. |
| 2026-11-24 | Browser speech (clean view) | Chrome / owner's mic | — | — | — | — | 0.30 s (n=6) | Third manual test. Observations moved to Phase 4 acceptance: requests without "?", incomplete phrases, superseded questions, rapid topic changes, repeats, ambiguous acronyms. |
| 2026-11-24 | Real speech (mode not recorded) | Owner's browser / mic | — | — | — | — | 0.48 s (n=2) | Fourth manual test, Phase 4 work in progress: question extraction, separate panels and automatic simulated answers worked. Speech end → first answer word median 1.06 s with **simulated** answers; not a Groq answer measurement. Accuracy script not run yet. |
| | Groq Whisper | | | | | | | |

## Known behaviour to watch for

- **Browser speech** shows words while you talk, but may drop or merge words after long pauses, and its technical-term accuracy depends on Google's or Microsoft's service. Phrase boosting only exists in Chrome 142+.
- **Groq Whisper** gets a vocabulary prompt and whole sentences of context, which may help with technical terms (to be measured), but text appears only after you pause (up to ~8 s into continuous speech), and the free tier has hourly and daily limits.
- Both get the same term corrections, so "cube cuddle" → kubectl, "a k s" → AKS, and so on. If a term is still misheard, add what was heard to `shared/vocabulary.ts` with a test.
