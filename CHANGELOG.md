# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions will follow [Semantic Versioning](https://semver.org/) once there is a release.

## [Unreleased]

### Added

- Phase 5 (PR #7): knowledge base in the browser (resume, job description, stories, projects, skills, internal terms, reference notes) with provenance labels and `.txt`/`.md` import; per-question keyword retrieval sends only matching excerpts; grounded answers claim experience only from verified items; STAR for behavioral questions; natural opener and short wrap-up; opt-in session history with 7/30/90-day expiry, purge, per-session delete, export and delete everything.
- Phase 4 (PR #6): question understanding and streaming answers. Local question extraction from the clean transcript (compound questions kept whole, requests without "?", incomplete phrases wait, superseded and repeated questions, duplicates dropped); Groq GPT-OSS 120B/20B and simulated answer providers; one request per question with a parsed TYPE / NOTE / ASSESSMENT / CLARIFY header; cancel and replace; per-session limits; free-tier token ledger; `/api/usage`.
- Answer workspace: three resizable panels (drag or arrow keys, remembered) with the answers panel at about 55% by default; transcript and questions collapse to rails; focus mode for the latest question and answer (Esc exits; the recording indicator stays visible); answer text size and line spacing settings; Copy answer button.
- Answers are grouped per question: Regenerate and "Answer again" add versions instead of replacing, an answer stopped by a newer question keeps its text, and a repeated question moves its earlier answer to the end. Off-topic results show as a one-line note, not an answer card.
- Simulated answers are labeled "Simulated · not AI" (dashed, hatched card, placeholder text prefix); Groq answers are labeled "AI-generated" with the model. The settings bar says which one is selected.
- `pnpm eval:answers`: runs `eval/answer-questions.json` through the same term fixes, extraction, prompt, parser and ledger as the app; writes JSON and a CSV with grading columns; automatic checks for assessment accuracy, false-positive flags, suspected hallucinations, textbook style, and latency. CI runs it with the simulated engine (`--check`); Groq runs need `--confirm-free-tier`.
- Playwright tests for answers: spoken question → extracted → simulated answer labeled as such; regenerate keeps versions; copy; a new question stops the previous answer but keeps its text; panel widths, resizing and persistence; collapsing; focus mode with display settings.
- "solo" is read as SLO only with reliability context ("an solo", "latency solo", "solo burn rate", "our solos" next to availability or error-budget words); "worked solo", "a guitar solo", "a solo project" stay as they are.
- ADR-014: medium reasoning effort for GPT-OSS answers and NOTE before ASSESSMENT in the header.
- Claimed-experience safety net (`shared/experienceClaims.ts`): answers that say "I've built…", "at my last company…" and similar get a red "Claims experience you haven't verified" note, and the evaluation flags them in every category. The prompt now forbids past-tense first-person claims for every question type.
- Local rolling summary: questions older than the last three turns go along as `earlier` (≤ 800 characters), with no extra request.
- First Groq evaluation (28 of 113 questions plus a 6-question re-check) in `eval/results/` and docs/ANSWER_EVALUATION.md; owner's fourth manual test recorded in docs/STT_EVALUATION.md.

- Token optimization: GPT-OSS 20B with low reasoning effort by default and 120B selectable or per answer ("Regenerate with 120B"); completion budgets 256 / 512 / 1024 (`ANSWER_MAX_TOKENS`) and effort (`ANSWER_REASONING_EFFORT`) configurable; system prompt 6.5K → 3.0K characters; earlier turns sent only when the question needs them (answers trimmed to 600 characters); a per-connection answer cache (memory only) replays repeats with no request, and Regenerate bypasses it; cut-off answers are marked. Measured ~2.0K → ~1.0K tokens per answer on the same questions, with weaker premise checking (docs/ANSWER_EVALUATION.md).
- Answer model defaults: GPT-OSS 120B with medium reasoning (budgets 1,000 / 1,400 / 2,200) is the default again; 20B with low reasoning (256 / 512 / 1024) is the optional fast mode. Effort and budgets are per model (`ANSWER_REASONING_EFFORT`, `ANSWER_MAX_TOKENS`, `ANSWER_MAX_TOKENS_FAST`).
- Prompt: premise traps spelled out (swapped terms, wrong component, wrong arithmetic, wrong protocol class); for unrecognized terms, no substitute settings, flags, commands or config values unless certain; examples no longer taken from the evaluation sets (test). The UI warns about specific settings or commands named next to an unrecognized term (`shared/unverifiedSpecifics.ts`).
- Availability number checks (`shared/numericChecks.ts`): a general prompt rule (higher availability = stricter target; downtime = (100% − availability) × period) plus a local check of answers for comparisons that contradict their numbers ("SLA tighter than the SLO" at 99.9% vs 99.95%) and wrong downtime arithmetic; shown as "Check the numbers" and flagged in the evaluation.
- Token tracking: input, output and reasoning tokens per answer (where Groq reports them) on each card, in `/api/usage` per engine since server start, and in the evaluation; the settings bar shows the free-tier requests and tokens left today and the average tokens per answer.

### Fixed

- PR #7 review: session history is saved only after the server confirms the last transcription (`session.stopped`, bounded), and is marked incomplete if a new recording starts first; unfinished answers are saved with their text and status; Delete everything reports failure (and deletes nothing visible) when another tab blocks it or deletion fails, and other tabs release the database when asked; long resume lines are split into chunks instead of cut off; the knowledge-base note names the selected AI provider; introductions and career questions retrieve the start of the verified resume.
- Code review of Phase 4 (2026-11-25): Stop waits (up to 25 s) for the last Groq transcription instead of dropping it; logout, auth expiry and session end abort queued and in-flight Groq transcription; a malformed Groq response no longer stalls transcription; detected questions are answered in order instead of cancelling each other (a typed question still replaces); a mic that finishes opening after logout or unmount is released at once; quota reservations are written to disk before any provider call and fail closed on write errors; a missing or unreadable answer header is shown as "Unverified answer", not as no issue.
- PR #8 follow-up: cancelling, replacing or logging out while an answer's quota is being saved no longer starts the Groq request (reservation returned); transcript messages carry their recording's ID so a late final from a stopped recording never mixes into the next one; a mic that finishes opening after cancellation never sends `session.start` or starts recognition.
- Regenerate reuses the original question's context; Groq answer streams accept CRLF delimiters and a stream that ends early counts as cut off.
- Accuracy-check term recall: a term next to `-` or `/` ("Terraform-managed", "Terraform/Helm") was marked missed; whole-word matching keeps p95/p99 and AKS/EKS distinct.
- Question extraction: an unpunctuated question followed by a first-person answer ("…for a payments api i would start with p99…") no longer merges into one question (fixture ext-31, from the owner's Browser speech run).
- Manual-testing fixes: unrecognized terms and ambiguous acronyms now get only a short clarification (prompt rule plus a server-side limiter that drops any explanation after it; cache and token accounting unchanged). Typed, merged and regenerated questions show submitted → first word instead of speech-end latency. Assessment notes no longer repeat the label or the question the answer already asks.
- Question extraction: "What's …" and other contracted wh-words start a question; "…which node a pod is scheduled on?" is no longer split at "is"; "so what …" after a statement, tag questions ("…, didn't you?"), imperative "Design/Compare/Define …", and "I meant …" corrections (with context) are recognized; a sentence trailing off into fillers ("what I wanted to ask was, uh") waits.
- Playwright's test server now blanks `GROQ_API_KEY` and `GEMINI_API_KEY`, so a key in the Codespace environment can't make browser tests call a real provider.
- Answer header parser accepts a one-line header with `|` separators and either field order.
- A Groq answer with no text (reasoning used the whole budget) now fails with "Try Regenerate" instead of finishing empty; completion budgets raised to 1,000 / 1,400 / 2,200 tokens.
- Transcript auto-scroll runs before paint (`useLayoutEffect`), so new lines never flash above the fold.

### Changed

- Transcription mode: Groq Whisper is preselected when configured and within its free quota, Browser speech otherwise (owner's benchmark recorded in docs/STT_EVALUATION.md). A Groq quota error offers "Switch to Browser speech" through the consent dialog; never automatic. The usage line shows transcription and answer budgets separately.
- Answer prompt: spoken, conversational style (contractions, answer first, one hypothetical example, no markdown or stock phrases, no formulaic closer) with a textbook-vs-spoken example; explicit check of every named term and built-in claim before the header; an unknown feature is never described or used as if real.
- The answer's Stop button is now "Stop answer", so it can't be confused with stopping the recording.

### Added (earlier phases)

- Phase 3 (PR #5): real transcription. Mode selector with Simulated, Browser speech (Web Speech API on Metor's own mic track, restarts after silence, phrase boosting where supported), and Groq Whisper (free tier, offered only when `GROQ_API_KEY` is set).
- Groq segments sized for the free-tier quota (voice detection with an adaptive noise floor, ≥ 8 s or a 1.5 s pause up to twice a minute, 30 s cap), WAV upload with a vocabulary prompt, and filtering of silence and Whisper hallucinations. A 429 pauses uploads until the reset time; no paid fallback.
- File-backed usage ledger: requests and audio seconds per minute for 24 h, charged before each Groq call, capped at 80% of the published free-tier limits.
- Technical vocabulary (`shared/vocabulary.ts`): Whisper prompt, Web Speech phrases, and corrections of common mishearings on final text.
- Transcript: duplicate finals dropped, auto-scroll, Clear transcript button, final-latency p50 in the debug line.
- Accuracy check panel (word error rate, technical-term recall, latency) and `docs/STT_EVALUATION.md`.
- `MAX_TRANSCRIPTION_MINUTES` is enforced. `/api/me` reports which providers are configured.
- Raw and clean transcripts (ADR-012): raw recognizer output kept as heard; a local clean view merges fragments into sentences by pause length, keeps question boundaries, removes fillers and stutters, fixes known terms with context for ambiguous phrases, and adds capitals and punctuation.
- User corrections: "heard as → should be" rules remembered in the browser, plus per-sentence edits. The accuracy check scores raw and clean text.
- Phase 4/5 roadmap: question understanding and validation (FR-U1–U9), conversation awareness (FR-C1–C4), answer style (FR-Q10), one request per question with a structured assessment header, and `eval/answer-questions.json` (113 questions) with docs/ANSWER_EVALUATION.md.
- Phase 4 question extraction requirements (FR-E1–E7), ARCHITECTURE §5.2 design, and `eval/question-extraction.json` (30 cases, questions kept word for word). FR-U10: telling mishearings apart from unfamiliar technology.
- Phase 4 acceptance additions from the third manual test (0.30 s p50): requests without "?", incomplete phrases never answered, superseded questions (FR-E9), rapid topic changes, duplicate events vs genuine repeats (FR-E8), ambiguous acronyms (FR-U11), detection accuracy and end-to-end latency targets. Extraction fixture now 30 cases with timed events; evaluation set 113 questions.
- ADR-013: answer providers. Groq free tier is the default; Claude (API key, billed) and OpenAI (separate API billing; ChatGPT Pro/Business credits possible) are optional, off by default, official API keys only.
- Roadmap: Phases 10–12 (camera preview, presence coaching, disclosed gaze correction). No video code.
- Phase 2 (PR #4): passphrase login (scrypt, HttpOnly SameSite=Strict cookie, 12 h expiry, 5-attempt lockout, Origin check on writes); `pnpm hash-passphrase`; server refuses to start without a passphrase hash or with non-simulated providers.
- Mic recording with a consent dialog, recording indicator and timer, and Start / Pause / Resume / Stop. An AudioWorklet downsamples to 16 kHz PCM16 and sends 100 ms frames with sequence numbers.
- Simulated transcription (canned lines at speaking pace) with partials, finals, and gap markers.
- Audio debug line while recording: frames/s, KB/s, and RMS level as received by the server (`audio.stats`, once per second, zeros while paused).
- Session recovery: 3 s client audio buffer, server acks, 30 s resume window, replay of missed finals, and takeover when the server still holds a stale socket. Logout and session expiry close sockets with code 4401.
- The mic is released on Stop, logout, login expiry, and terminal connection failure (Playwright checks every track ended).
- Phase 1 (PR #2): pnpm project with Node 24 and pnpm pinned; React + Vite client with connection status and a message echo; Fastify server on `127.0.0.1` with `/healthz` and `/ws`.
- `/ws` checks the `Origin` header, validates every message with shared zod schemas, rejects binary frames and frames over 16 KB, and logs only a fixed error code for bad input.
- Client reconnect with backoff (0.5 s → 8 s) and a 10 s connect timeout. Server shuts down cleanly with a 5 s limit.
- Vitest unit/integration tests, Playwright smoke tests against the production build, and GitHub Actions CI (actions pinned to commit SHAs, Dependabot for updates).
- Devcontainer (Node 24, 2-core, only port 5173 forwarded) and `docs/DEVELOPMENT.md`.
- ADR-010: Node 24 runs TypeScript directly (no `tsx`), `pnpm --parallel` instead of `concurrently`, zod for validation, TypeScript pinned to 6.0.
- Phase 0 docs (PR #1): requirements, architecture, security and privacy, implementation plan, decision records, and agent rules. `.gitignore` and `.env.example`.
- Designs from the PR #1 review: cookie-based login (ADR-007), persisted spend ledger with reservations (ADR-008), WebSocket resume rules, no transcript storage unless opted in, safer rollback steps.
- Free-first provider plan (ADR-009): simulated by default, Groq free tier, Web Speech evaluation, optional Gemini without personal data, paid providers off, no paid fallback, login required for any real provider. Provider facts checked against official docs on 2026-11-24.

### Changed

- Ledger keeps the full reservation when provider usage is unknown and tracks free-tier quotas over rolling windows. Provider budget alerts are not treated as hard caps.
- Logout and session expiry will close open WebSockets (Phase 2).
- Groq audio segments are at least 8 s so the 10 s minimum per request doesn't exhaust the hourly quota.
- Split answer latency into NFR-2 (from final transcript) and NFR-2b (end to end, per provider).
- README: Metor as the project name, current status and what works, constraints, AI-assisted development note.
- `STT_PROVIDER` removed: the transcription mode is chosen per recording in the UI (ADR-011).
- Term fixes moved out of the Groq adapter and Web Speech wrapper into the clean view; risky fixes removed (e.g. "slows" → SLOs); ADR-006 amended (no separate classification request).
- Phase 1 echo protocol removed; the WebSocket client gives up after 6 reconnect attempts (about 24 s, inside the server's 30 s resume window) and shows a Reconnect button.
