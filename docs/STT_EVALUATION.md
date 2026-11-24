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
| Word error rate | (substituted + missing + extra words) ÷ words in the script, after lowercasing and removing punctuation. Lower is better. |
| Tech terms | How many of the script's technical terms (from `shared/vocabulary.ts`) appear in the transcript. |
| Final latency p50 | Groq: end of a speech segment → its text arriving. Browser speech: last interim result → final result. The two aren't the same measurement; Groq's also includes waiting for the pause that closes a segment. |

## Results

No measured runs yet. They need a real voice and mic, which CI and the Codespace can't provide.

| Date | Mode | Browser / mic | Word error rate | Tech terms | Final latency p50 | Notes |
|---|---|---|---|---|---|---|
| | Browser speech | | | | | |
| | Groq Whisper | | | | | |

## Known behaviour to watch for

- **Browser speech** shows words while you talk, but may drop or merge words after long pauses, and its technical-term accuracy depends on Google's or Microsoft's service. Phrase boosting only exists in Chrome 142+.
- **Groq Whisper** gets a vocabulary prompt and whole sentences of context, which may help with technical terms (to be measured), but text appears only after you pause (up to ~8 s into continuous speech), and the free tier has hourly and daily limits.
- Both get the same term corrections, so "cube cuddle" → kubectl, "a k s" → AKS, and so on. If a term is still misheard, add what was heard to `shared/vocabulary.ts` with a test.
