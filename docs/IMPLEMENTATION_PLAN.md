# Implementation Plan

Each phase must pass review against its acceptance criteria before the next begins. **Development constraints (all phases):** all installs and builds run in GitHub Codespaces or GitHub Actions; no additional installations on the Mac; no local AI models; minimal dependencies and infrastructure; $0 API spend by default (ADR-009).

Phases 0–2 are detailed; later phases are refined (with exact Copilot prompts, verified dependencies, and commands) at the start of each phase so they reflect current API docs and what we learned.

**Rollback (all phases):** each phase is developed on a branch `phase-N-<name>` and merged via PR.

- **Abandon an unmerged phase:** close the PR and `git switch main`. **Keep the branch** in case the work is needed later. Delete it only after verifying it is no longer needed, using `git branch -d phase-N-<name>`. Lowercase `-d` refuses to delete unmerged work; avoid `-D`, which force-deletes it.
- **Undo a merged phase** (always creates a new commit; history is kept):
  - Merge commit: `git revert -m 1 <merge-commit-sha>`
  - Squash merge: `git revert <squash-commit-sha>`
  - Rebase merge: revert each commit, newest first: `git revert <oldest-sha>^..<newest-sha>`
- Open the revert as its own PR so CI runs on it.

---

## Phase 0 — Environment assessment and documentation ✅ (merged, PR #1)

**Objective:** Confirm the dev environment and establish requirements, architecture, and agent rules.

**Environment (Codespace, 2026-11-24):** Ubuntu 24.04, x86_64, 2 cores, 7.8 GB RAM, 19 GB free disk, Node 24.22.2, npm 11.19.1, pnpm 12.16.1, git 2.56.0, gh 2.103.3. No installs required.

**Files:** `README.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `CHANGELOG.md`, `.gitignore`, `.env.example`, `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_PRIVACY.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md`.

**Storage impact:** < 100 KB.

**Acceptance criteria**
- [x] PR #1 review comments addressed (auth, URL credentials, spend accounting, reconnect, retention, phase mapping, devcontainer, toolchain pinning, early browser tests, rollback)
- [x] Free-first provider strategy documented (ADR-009): Groq free tier, Web Speech evaluation, optional Gemini, simulated STT and answers, paid providers off by default, no paid fallback
- [x] Conservative reservations for unknown usage; provider budget alerts not treated as hard caps; WebSocket termination on logout/expiry
- [x] User has reviewed and agreed with requirements, especially scope and acceptable-use controls (approved merge of PR #1)
- [x] Mermaid diagrams render on GitHub (all 5 diagrams parse with Mermaid 11)
- [x] No secrets in repo; `.env` is ignored (`git check-ignore .env` prints `.env`; full history scanned)
- [ ] Repo settings: secret scanning + push protection enabled. **Not verified:** the Codespace token can't read security settings (`security_and_analysis` comes back empty). Owner check: GitHub → Metor → Settings → Advanced Security → Secret Protection and Push protection both enabled.

---

## Phase 1 — Lightweight web application foundation ✅ (merged, PR #2)

**Objective:** Runnable skeleton: Vite React client + Fastify server + typed WebSocket echo, with pinned toolchain, devcontainer, lint, typecheck, tests, a browser smoke test, and CI.

**Requirements:** NFR-8, NFR-10 baseline; AGENTS.md layout.

**Files to create**
```
.devcontainer/devcontainer.json
package.json (with "packageManager" and "engines"), pnpm-lock.yaml, .nvmrc
tsconfig.json, tsconfig.node.json (if needed)
vite.config.ts, index.html (or client/index.html)
client/src/main.tsx, client/src/App.tsx, client/src/net/wsClient.ts
server/src/index.ts, server/src/ws/gateway.ts, server/src/config.ts
shared/messages.ts
eslint config, vitest config, playwright.config.ts, e2e/smoke.spec.ts
.github/workflows/ci.yml
docs/DEVELOPMENT.md (Codespace startup + secrets setup; short)
```

**Toolchain pinning**
- `.nvmrc` → `24`. `package.json` `"engines": { "node": ">=24 <25" }`.
- `"packageManager": "pnpm@<exact version>"`, set to the pnpm already installed in the Codespace by running `corepack use pnpm@$(pnpm --version)`.
- CI sets up Node with `actions/setup-node` using `node-version-file: .nvmrc`, and pnpm with `pnpm/action-setup`, which reads `packageManager`. Then `pnpm install --frozen-lockfile`.

**Devcontainer (minimal)**
- Base image: an official Dev Containers Node 24 image. **TODO(verify)** the exact tag on mcr.microsoft.com before writing it.
- `postCreateCommand`: `corepack enable && pnpm install`.
- `forwardPorts: [5173]` (Vite client; it proxies `/api` and `/ws` to the server).
- The server binds to `127.0.0.1:8787` and is **not** forwarded: `portsAttributes` `"8787": { "onAutoForward": "ignore" }`.
- Codespaces ports are private by default. Keep them private and verify with `gh codespace ports`. Port visibility is a Codespaces setting, not a devcontainer.json field. **TODO(verify)** against current docs.
- No extensions beyond ESLint, if any.

**Codespaces secrets (from Phase 3; documented now in docs/DEVELOPMENT.md)**
- GitHub → Settings → Codespaces → Secrets → New secret: `APP_PASSPHRASE_HASH`, `GROQ_API_KEY`, and optionally `GEMINI_API_KEY`, scoped to this repository only. No OpenAI or other paid key is needed.
- Secrets appear as environment variables in new or rebuilt Codespaces. A local `.env` is not needed.
- Free-tier accounts: **do not add a payment method** to Groq or enable billing on the Gemini project; that is what keeps spend at $0. Enable Groq Zero Data Retention.

**Dependencies (as implemented; versions resolved by `pnpm add`, see ADR-010)**
- Runtime: `react`, `react-dom`, `fastify`, `@fastify/websocket`, `@fastify/static` (serve built client), `zod`
- Dev: `vite`, `@vitejs/plugin-react`, `typescript` (`~6.0`), `@types/react`, `@types/react-dom`, `@types/node` (`^24`), `@types/ws`, `vitest`, `eslint`, `@eslint/js`, `typescript-eslint`, `@playwright/test` (Chromium headless shell only)
- Not needed: `tsx` (Node 24 runs TypeScript natively) and `concurrently` (`pnpm run --parallel`).

**Measured storage:** `node_modules` 180 MB; Playwright headless shell ~287 MB in `~/.cache/ms-playwright`; `dist/` 380 KB. All of this is in the Codespace; nothing goes on the Mac.

**Commands**
```bash
git switch -c phase-1-foundation       # creates a branch (modifies git state, safe)
pnpm install                           # installs dependencies (writes node_modules/)
pnpm exec playwright install --with-deps --only-shell chromium  # headless shell for smoke tests (~290 MB)
pnpm dev                               # client on :5173, server on 127.0.0.1:8787
pnpm lint && pnpm test && pnpm build
pnpm start                             # serves built client + API from one port
pnpm test:e2e                          # browser smoke test
```

**Copilot Agent Mode prompt**
```
Read AGENTS.md and docs/ARCHITECTURE.md. Implement Phase 1 from docs/IMPLEMENTATION_PLAN.md only.

Create a single-package TypeScript project (pnpm, Node 24, "type": "module"):
- client/: Vite + React. App shows a status bar ("Disconnected"/"Connected"), a text input,
  and a log of messages echoed back from the server over WebSocket.
- server/: Fastify with @fastify/websocket. GET /healthz returns {status:"ok"}.
  WS route /ws validates every incoming JSON message against shared/messages.ts and replies
  with {type:"echo", ...}. Reject invalid messages with {type:"error", code:"bad_request"}.
  Read PORT and ALLOWED_ORIGINS from env (server/src/config.ts); check the WS Origin header.
  Set a max payload size.
- shared/messages.ts: discriminated-union message types + runtime validation.
- client/src/net/wsClient.ts: typed client with exponential-backoff reconnect (0.5s → 8s, jitter).
- Vite dev server proxies /ws and /api to the Fastify server so the browser uses one origin.
- Server listens on 127.0.0.1 only. The WebSocket URL is same-origin (`/ws`), with no tokens in the query string.
- Toolchain: .nvmrc = 24; package.json "engines" node >=24 <25; set "packageManager" with
  `corepack use pnpm@$(pnpm --version)`.
- .devcontainer/devcontainer.json: official Node 24 Dev Containers image (verify the tag exists
  before writing it), postCreateCommand "corepack enable && pnpm install", forwardPorts [5173],
  portsAttributes {"8787": {"onAutoForward": "ignore"}}.
- Scripts: dev (client + server together), build (client with Vite + server compiled to dist/),
  start (serves built client via @fastify/static + API + WS on one port), test (vitest),
  test:e2e (playwright), lint (eslint + tsc --noEmit).
- Unit tests: message validation (valid/invalid), reconnect backoff calculation.
- e2e/smoke.spec.ts (Playwright, Chromium only): against `pnpm start` (built app), load the page,
  assert status becomes "Connected", send a message, assert the echo appears.
- .github/workflows/ci.yml: actions/setup-node with node-version-file .nvmrc, pnpm/action-setup
  (reads packageManager), pnpm install --frozen-lockfile, lint, test, build, then install
  Playwright Chromium and run test:e2e against the built app.
- docs/DEVELOPMENT.md: how to start the Codespace, run the app, keep ports private, add
  Codespaces secrets, and keep free-tier provider accounts without a payment method. Keep it short.
Add dependencies with `pnpm add` so versions are resolved, never hand-written.
TypeScript strict. No UI library. Update CHANGELOG.md. Do not implement audio, auth, or any AI provider yet.
```

**Acceptance criteria**
- [x] `pnpm dev` starts both; the app loads through the Vite port; status turns "Connected" (headless Chromium on `127.0.0.1:5173`, and owner tested via the forwarded Codespaces URL)
- [x] Typing a message shows the echo; sending invalid JSON returns an error message
- [x] Killing the server shows "Disconnected"; restarting reconnects automatically (~2.3 s after restart; owner confirmed in the Codespaces browser)
- [x] `curl localhost:8787/healthz` → `{"status":"ok"}`
- [x] `pnpm build && pnpm start` serves the built client, and WS works on the single port (Playwright smoke test)
- [x] `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e` pass locally and in CI
- [x] CI uses the Node version from `.nvmrc` and the pnpm version from `packageManager`
- [ ] Rebuilding the Codespace from `.devcontainer` works; only port 5173 is forwarded, and it is private. **Partly verified (2026-11-24):** the Dev Containers CLI built the container from `devcontainer.json`; `postCreateCommand` ran; inside it Node 24.18, pnpm 12.16.1, 2 CPUs, lint, 51 tests and build passed. **Not verified:** Codespaces-only behavior (`hostRequirements`, port forwarding and privacy). The Codespace token can't create Codespaces. Owner check: Command Palette → Codespaces: Rebuild Container, then confirm the Ports tab shows only 5173 as Private.
- [x] No API key referenced anywhere in `client/`; no credentials in any URL (CI greps `dist/client`)

**Risks:** Codespaces port forwarding and WS through the Vite proxy — verify early. Over-scaffolding by Copilot — reject extra libraries. Devcontainer changes require a Codespace rebuild (a few minutes).

---

## Phase 2 — Microphone capture and simulated transcription 🔍 (in review, PR #4)

**Objective:** Real mic capture with consent flow and indicator; audio frames streamed to server; server returns **simulated** partial/final transcripts; authentication and resume protocol in place **before** any real provider exists. Zero API cost.

**Requirements:** FR-A1–A5, FR-S1 (in-memory session), FR-P4, NFR-11, session lifecycle (ARCHITECTURE §7), WS messages (§6.2), resume semantics (§6.3), authentication (SECURITY_PRIVACY §3.1).

**Files:** `client/src/audio/capture.ts`, `client/src/audio/pcm-worklet.ts`, `client/src/ui/RecordingIndicator.tsx`, `client/src/ui/TranscriptPane.tsx`, `client/src/ui/ConsentDialog.tsx`, `client/src/ui/Login.tsx`, `server/src/auth/` (login, cookie sessions, per-session socket registry), `server/src/ws/session.ts` (session registry, grace period, seq tracking), `server/src/providers/config.ts` (`STT_PROVIDER`/`ANSWER_PROVIDER`/`ALLOW_PAID_PROVIDERS` parsing and startup checks; only `simulated` accepted in this phase), `server/src/stt/types.ts` (adapter interface with `billing` field), `server/src/stt/simulated.ts`, `scripts/hash-passphrase.ts`, unit + integration + e2e tests.

**Dependencies:** none new expected (Web Audio API, AudioWorklet, Node `crypto` scrypt are built in). `@fastify/cookie` if needed; justify per AGENTS.md.

**Storage impact:** negligible.

**Acceptance criteria**
- [x] Login required. Unauthorized HTTP gets 401, WS without cookie or with a wrong Origin is rejected, brute force gets 429 (integration tests)
- [x] Logout closes the user's open WebSockets with `4401`; session expiry does the same (integration test uses a 300 ms session lifetime rather than a mocked clock); client stops capture and shows login (e2e)
- [x] Startup checks: the server refuses to start without `APP_PASSPHRASE_HASH` (stricter than planned: auth is always on), with any provider other than `simulated`, or with `ALLOW_PAID_PROVIDERS` not `false` (unit tests)
- [x] Start shows consent dialog → browser permission prompt → indicator + timer visible
- [x] Audio frames reach the server with sequence numbers (integration tests for seq tracking, duplicates, gaps, acks). While recording, a debug line shows what the server received in the last second: frames, KB, and audio level (e2e checks ~10 frames/s and a non-silent level from the fake mic).
- [x] Simulated partials appear in grey and are replaced by finals
- [x] Pause stops sending audio (AudioContext suspended; the mic stays open and the indicator says so); Stop releases the mic (e2e checks every track has ended)
- [x] Denying permission shows a clear error and returns to Idle
- [x] Resume tests from ARCHITECTURE §6.3 that apply to Phase 2: resume replays missed finals without duplicates; missing frames produce a gap marker; resume after the grace period or from another login is refused; a failed resume stops capture. The answer-related ones (mid-answer drop, duplicate `questionId`) belong to Phase 4.
- [x] Terminal failure stops all media tracks and hides the indicator (e2e: resume refused, close code 4401)
- [x] Transcript is held in memory only; nothing is written to IndexedDB (no storage code exists)
- [x] Unit tests: STT adapter interface, simulated transcript sequencing, PCM conversion, frame seq encoding
- [x] **E2E (Playwright, Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`):** login → start → simulated transcript appears → stop → assert tracks ended and indicator hidden; permission-denied path shows error; logout during capture → tracks ended, indicator hidden, login shown

**Risks:** AudioWorklet loading under Vite; sample-rate differences across devices; cookie `Secure` flag on non-HTTPS localhost in tests (Chromium treats localhost as secure; verify).

---

## Phase 3 — Real transcription ✅ (merged, PR #5; accuracy not yet measured)

**Objective:** Show the words actually spoken. Browser speech (Web Speech API) first, Groq Whisper free tier as the alternative, simulated kept for tests (ADR-011).

**Entry gate:** Phase 2 auth, socket-termination, and resume tests pass. ✅

**Acceptance**
- [x] Transcription mode selector: Simulated, Browser speech (when supported), Groq Whisper (only when `GROQ_API_KEY` is set). Disabled while recording (e2e)
- [x] Browser speech runs on Metor's own mic track, restarts after silence, boosts technical phrases where supported, and stops and releases the mic on fatal errors (e2e with a fake `SpeechRecognition`)
- [x] Groq: speech segments sized for the free-tier quota, WAV upload with vocabulary prompt, silence and Whisper hallucinations dropped, finals kept in order (unit tests with a fake Groq)
- [x] Usage ledger charges each Groq call before sending, survives restarts, and refuses calls over the local free-tier limits; a 429 pauses uploads until `retry-after` with **no provider switch** (unit tests)
- [x] `MAX_TRANSCRIPTION_MINUTES` stops a recording (integration test)
- [x] Technical-term corrections on finals; duplicate finals dropped; empty partials cleared; partial finalized on pause/stop (unit tests)
- [x] Transcript auto-scrolls unless the user scrolls up; Clear transcript button (e2e)
- [x] Accuracy check panel: word error rate, technical-term recall, final latency p50, for raw and clean text (unit + e2e)
- [x] Raw transcript kept as heard; clean view with sentence merging, question boundaries, filler and repeat removal, capitals and punctuation (unit tests on sentence reconstruction; e2e)
- [x] Term fixes only from explicit lists, with context for ambiguous phrases ("as your manager" stays); unknown terms untouched (unit tests)
- [x] User corrections: "heard as → should be" rules remembered in the browser, and per-sentence edits; raw unchanged (unit + e2e)
- [x] Owner's manual test (2026-11-24): Browser speech works in Chrome with a real voice; final latency p50 0.45 s over 6 samples
- [x] CI never calls Groq or a real speech service
- [ ] **Measured on real speech:** word error rate and term recall for both modes, Groq end-of-segment → text p50 < 2.0 s. Needs the owner's voice, Chrome, and a Groq key; method and results table in `docs/STT_EVALUATION.md`.
- [ ] **Real services exercised:** Browser speech in Chrome and a live Groq request haven't been run from here (no mic, no key). The owner checks them when running the evaluation.
- [ ] ADR-005: Groq stays behind the server relay (the key never reaches the browser). Whether Groq offers ephemeral client tokens wasn't checked; not needed while relaying.

**Not in this phase:** tab or system audio capture (FR-A7), speaker separation.

**Notes:** On disconnect, the segment being collected is dropped; an upload already in flight finishes and its final is replayed on resume. On logout, in-flight results are discarded.

---

## Phase 4 — Question understanding and streaming answers ✅ functional milestone (merged, PR #6; four manual evaluation items deferred)

**Objective:** Extract questions from the clean transcript, work out what kind of question each is, check it before answering, and stream a natural answer, with at most one LLM request per question (ARCHITECTURE §5.1, §5.2, §5.4). Raw transcript, clean transcript, and extracted questions stay separate.

**Entry gate:** Phase 3 merged. ✅ (The owner chose to merge before the accuracy run; it moved into the acceptance list below.)

**Key tasks**
- **Question extraction** (§5.2, FR-E1–E7): split clean sentences into greeting / filler / statement / request / question parts using boundary cues that don't need punctuation; keep compound questions whole; drop abandoned questions after "let me rephrase"; completion rules beyond pauses (closed sentence, no dangling word, debounce); one answer per question, with growing questions updating the pending one; "Extracted questions" list with answer, dismiss, merge, and split.
- Local pre-checks: unknown-term and possible-mishearing hints, telling mishearings apart from unfamiliar names (§5.4, FR-U10).
- `SimulatedAnswer` adapter first (streams a valid header plus a canned answer, for UI and CI); then **`GroqAnswer` as the default** (`openai/gpt-oss-120b`; re-verify model IDs and free-tier limits); optional `GeminiAnswer` (no KB content, not in live modes). Claude and OpenAI adapters are **not** built in this phase (ADR-013): official API keys only, off by default, and only after the owner opts in and checks billing.
- One request returning the `TYPE / ASSESSMENT / NOTE / CLARIFY / ANSWER` header plus the streamed answer; the client parses it and shows the assessment chip separately; a malformed header falls back to plain answer text.
- Prompt rules for validation, uncertainty, natural style, and lengths (§5.3–5.4, FR-Q10). No first-person experience without a verified KB (FR-Q8).
- Conversation context: last turns plus a rolling summary; follow-ups, corrections, and topic switches.
- Ledger reservations for answer requests; quota exhaustion handled with no fallback; latency instrumentation.
- Evaluation runner over `eval/answer-questions.json` (simulated in CI; manual free-tier run).

**Acceptance** (status 2026-11-24; ✅ verified here, ⬜ open, with what's missing)

**Deferred (owner approved Phase 4 as a functional milestone on 2026-11-25; these stay open and unchecked):** four manual evaluation items that need runs on the owner's voice and free Groq budget, or a person to grade.
1. End-to-end latency with Groq answers from real speech, per transcription mode (NFR-2b, NFR-2 browser-side p50 < 1.5 s).
2. Small-talk questions that reach the model on Groq: ≥ 7 of 8 `irrelevant` items without an answer card.
3. Naturalness graded by a person (≥ 4/5).
4. The rest of the answer evaluation set on Groq: 85 of 113 questions, assessment ≥ 85% (now 82% on 28). Clarification-only answers (7ab2b69) were not re-run live.
- [x] Carried from Phase 3: Browser speech and Groq Whisper measured on the accuracy script by the owner (2026-11-25), recorded in docs/STT_EVALUATION.md: WER 30.1% raw / 28.2% clean vs 10.9%, terms 18–20/34 vs 26/34, latency 0.47 s vs 0.35 s. Groq Whisper is preselected when configured and within quota.
- [x] 0 duplicate requests in the test script; never more than one LLM request per detected question (tracker unit tests, `questionId` idempotency test, one `AnswerSession.handle` per question in the eval runner)
- [x] Extraction fixture (`eval/question-extraction.json`): 31/31 word for word; holdout 13/15 blind, then 15/15; no answer for filler-only and incomplete cases (unit tests)
- [x] Requests without `?` ("talk about…", "explain…", "describe…", "walk me through…", "design…") are extracted as questions (unit tests)
- [x] Incomplete phrases are never answered; the answer waits; a completed question replaces its earlier incomplete version (tracker tests; trailing fillers no longer hide a dangling end)
- [x] Several questions in one stretch are extracted separately and answered in order; a typed question replaces the in-flight answer, keeping its partial text (unit, integration and e2e tests; queueing changed after the 2026-11-25 code review)
- [x] Duplicate transcript events are dropped; a genuine repeat re-shows the earlier answer without a new request, moved to the end and marked "asked again" (tracker and grouping tests)
- [x] Ambiguous acronyms: context hints in the prompt (`shared/acronyms.ts`); on the Groq sample, ambi-11 ("AAA on the firewall") stated the assumed meaning and answered, and ambi-12 ("experience with AA") asked which meaning; the label for ambi-11 was `clarification_needed` where `none` was expected
- [x] Original meaning is preserved: extracted questions are word-for-word spans of the clean transcript (unit tests)
- [x] Question detection precision and recall ≥ 90%: answer evaluation set 98.0% precision / 95.2% recall (local extraction; misses are four incident descriptions with no question, e.g. "Ping works, but TCP connections to port 443 time out.", and one requirement statement); extraction fixture 31/31. CI enforces ≥ 90% (`pnpm eval:answers --check`).
- [ ] End-to-end latency per transcription mode (NFR-2b). Recorded so far: speech end → first answer word median 1.06 s with **simulated** answers (owner, real speech). Not yet measured with Groq answers from real speech.
- [ ] `irrelevant` items produce no answer card (≥ 7 of 8): 6 of 8 are skipped locally (greetings, audio checks, "let me share my screen", an unfinished sentence). The other two ("What's your favorite movie?", "Who won the football match last night?") rely on the model labeling them `off_topic`, which the UI shows as a one-line note, not a card. Not yet run on Groq.
- [ ] Final transcript → first token p50 < 1.5 s with `GroqAnswer` (NFR-2): server-side request → first answer word p50 1.11 s, p95 1.87 s on the 28-question Groq sample (medium reasoning). The browser-side number from real speech is still to be measured.
- [ ] Answers are natural and conversational (naturalness ≥ 4/5): prompt rewritten for spoken style; automatic style flags 0/27 on the Groq sample; reading the answers, they're conversational but often walk through "First… Next… Finally…" and ended with a formulaic "A common gotcha is…" (prompt adjusted). Needs a person to grade naturalness. Behavioral questions get a labeled example approach (prompt; FR-Q8).
- [ ] Answer evaluation set with the free-tier provider (assessment ≥ 85%, false positives ≤ 5%, 0 hallucinations, factual ≥ 1.7/2, naturalness ≥ 4/5): 28 of 113 questions so far: assessment 23/28 (82%), false positives 0/4, no made-up term described as real, one claimed experience (fixed, re-check 0/6), first-reading notes in docs/ANSWER_EVALUATION.md. A full run needs more than one day's free budget, and the grades need a person (docs/ANSWER_EVALUATION.md).
- [x] Cancel aborts the upstream request; the reservation is kept unless usage is reported; quota exhaustion (429 or local budget) never selects another provider (engine tests with a faked Groq). Gemini isn't built in this phase, and there is no KB yet, so nothing can reach it.

**UI added in this phase (owner's review, 2026-11-24):** resizable panels with the answers panel ≈ 55% by default; collapsible transcript and questions; focus mode; answer text size and line spacing; copy; answer versions kept on regenerate; clear "Simulated · not AI" vs "AI-generated" labels; "solo" → SLO only with reliability context. All covered by unit and Playwright tests.

**Not done in this phase:** local unknown-term hints ("not in Metor's glossary"). With a glossary of about 100 terms, most real technologies would be flagged, which pushes the model toward false flags. The model-side term check (ADR-014) flagged 8 of the 9 made-up terms tried so far, so the hint waits for the larger technology list and the user's own internal-tools list in Phase 5. Optional `GeminiAnswer` not built.

---

## Phase 5 — Resume, job description, and verified experience ✅ (merged, PR #7)

**Objective:** Knowledge base with provenance labels; grounded answers and experience checks.

**Key tasks:** IndexedDB schema (`kb`, `sessions`, `settings`); KB editor UI with provenance labels (`verified`, `theoretical`, `hypothetical`); text/Markdown import; keyword retrieval; prompt grounding + injection defenses; grounded answers only via providers allowed to receive personal data (Groq with ZDR, not Gemini free tier); **opt-in session persistence (FR-S1b) shipped together with retention, expiry purge, per-session delete, "delete everything", and export (FR-S4)**; UI note that local deletion does not affect provider retention.

**Validation work in this phase:**
- **Experience probes** (FR-U7): claims like "you've run 10,000-node clusters" are checked against `verified` KB items. A matching item → STAR answer from it. No match → `unverified_experience` and an honest answer.
- **Internal tools and company terms:** the user can add their own terms ("Shipyard: internal deploy tool"). Metor then treats them as known context instead of "unrecognized".
- **Reference notes:** the user can paste excerpts from official docs into the KB as `reference` items. Answers may cite them, and only them, when explaining that something was checked (FR-U9).
- Resume-based traps and behavioral items in the evaluation set are re-run with a sample KB.

**Acceptance:** behavioral question with a matching verified story produces STAR using only that story's facts; with no match, the answer says so and labels any example hypothetical; all `experience_trap` items answered without claiming unverified experience; internal tools added by the user are no longer flagged; injection test documents ("ignore previous instructions…") do not change behavior; with persistence off (the default), nothing session-related is written to IndexedDB (test); expired sessions are purged on startup (test with a mocked clock).

**Status 2026-11-25** (✅ verified by tests, ⬜ open)
- [x] Owner's manual acceptance testing on 2026-11-25: all tested cases passed (owner-reported; no metrics recorded).
- [x] KB in IndexedDB with provenance; resume, job description, stories, projects, skills, internal terms, reference notes; `.txt`/`.md` import (PDF/DOCX stay P2: they'd add dependencies). Settings stay in `localStorage` (no `settings` store needed).
- [x] Keyword retrieval sends at most 6 excerpts (≤ 2,400 chars) per question, never the whole KB; grounding rules and STAR rule are sent only when they apply (unit tests).
- [x] Behavioral question with a matching verified story → answer from that story only; no match → "no verified experience" and a hypothetical example (simulated engine, unit + e2e). Experience warning flags claims the verified excerpts don't back.
- [x] Internal terms named in a question are always sent as known context (unit test).
- [x] Injection text in uploads can't close the `<kb>` block and is treated as data (prompt test, e2e).
- [x] Persistence off by default writes no session (unit + e2e on IndexedDB); expired sessions purged on start and hourly (mocked-clock test); per-session delete, export, delete everything (e2e).
- [ ] Re-run resume traps and behavioral items on Groq with a sample KB (live calls need the owner's approval).

---

## Phase 6 — SRE and technical interview practice

**Objective:** Practice mode with question banks per interview profile (QA, QA Automation, SDET, SRE, DevOps, Cloud, Networking, Software Engineering, and user-defined custom roles; REQUIREMENTS §1), feedback on spoken answers, weak-topic tracking, session summaries and history.

**Acceptance:** question bank covers every topic group in REQUIREMENTS §3; feedback rubric documented; summaries generated within cost limits.

---

## Phase 7 — Desktop application and authorized system audio

**Objective:** Electron wrapper with floating, resizable, always-on-top (but screen-capturable) answer window, and user-authorized system audio capture.

**Key tasks:** verify current Electron capabilities for system audio on macOS and Windows; builds in GitHub Actions (no Xcode install on the Mac); code signing strategy; ADR for repo structure changes.

**Risks:** macOS permission model and signing/notarization requirements; app size (~100+ MB per build).

---

## Phase 8 — Security, reliability, and performance optimization

**Objective:** Harden and measure: CSP, rate limits, dependency audit, secret scanning in CI, load test of WS server (simulated providers only), memory profiling of 60-min session, cost and free-quota usage report.

**Acceptance:** all SECURITY_PRIVACY §5 items checked; NFR targets measured and recorded in this file.

---

## Phase 9 — Testing, deployment, and release

**Objective:** Full E2E regression suite (extending the smoke tests from Phases 1–2), deployment of the server to a lightweight host with authentication, versioned release with CHANGELOG.

**Key tasks:** choose host (ADR); auth for the deployed server; release workflow; user guide.

---

## Phase 10 — Camera access and preview (planned)

**Objective:** Optional camera with the same consent rules as the mic: explicit start, a visible camera indicator, a local preview only, nothing recorded or uploaded by default. FR-V1.

---

## Phase 11 — Presence coaching (planned)

**Objective:** Feedback on eye contact, head position, posture, and lighting while practicing. It should run in the browser on the preview frames without storing video; choose the approach in an ADR (it must respect the no-local-heavy-models rule). FR-V2.

---

## Phase 12 — Disclosed gaze correction and virtual camera (planned)

**Objective:** Optional gaze correction and a virtual camera output, for practice or where everyone has agreed. Always visible as such to other participants, consistent with SECURITY_PRIVACY §1 (no concealment). A virtual camera needs an OS-level component on the Mac, which conflicts with the current no-local-install rule; it needs its own ADR before any work starts. FR-V3.

---

## Coding Interview Mode (Phases 13–15, planned)

Added 2026-11-25 (REQUIREMENTS §2.10). Numbered after the existing phases so nothing is renumbered; the owner may schedule 13–15 before 10–12. Phase 6 stays spoken SRE practice. All three keep the standing rules: browser-based, simulated providers in CI, no Mac installs, $0, consent, and live use only where AI help is explicitly permitted.

---

## Phase 13 — Coding Interview Mode: problems, solutions, practice levels (planned)

**Objective:** A separate mode for coding interviews (SWE, SRE, DevOps, QA Automation, SDET). FR-C1 (text, speech), C2–C9, C11, C13.

**Key tasks:** problem panel fed by typed text or the existing transcript; one request per turn through the existing provider interface (GPT-OSS 120B default, 20B optional) with a compact coding prompt: restate → constraints → clarifying questions → brute force → optimized → code → complexity → dry run → edge cases → tests; hint / guided / full modes, each asking only for what it shows; premise and constraint checks reuse the §5.4 assessment header; context limited to the current problem, its code and the last turns; answer cache keyed on problem + code + mode. Until Phase 14, every code block and test is labeled "not run". Coding evaluation set (`eval/coding-problems.json`): easy/medium/hard problems with reference tests, plus a held-out set written before tuning, scored for correctness (by review until 14), complexity accuracy, latency and tokens.

**Acceptance:** a problem gets restatement, constraints and at least one clarifying question before code; hint mode never reveals the full solution; an impossible-constraint and an invented-API problem are flagged, not answered as if valid; no answer claims tests passed; eval set runs in CI on simulated and manually on Groq.

---

## Phase 14 — Isolated code execution and test validation (planned)

**Objective:** Run code and tests for real, so pass/fail comes from execution, not from the model. FR-C10, C11, C13 (pass rate).

**Gate:** Hard rule 5 stays in force. No execution work starts without a separate security ADR **and** the owner's explicit approval of it. The ADR must decide whether sandboxed execution of code under test is allowed, by whom it's triggered (an explicit user click), and confirm that generated shell commands are still never run on the host. Bash and anything touching the network stay "not run" unless the sandbox can isolate them.

**Key tasks:** compare sandbox options that need no Mac install and no paid service: in-browser WebAssembly runtimes and Web Workers (per language), versus a sandbox on the server. For each, verify from official docs which languages it covers, its download size, and how CPU, memory, time and network are limited: **TODO(verify)**, nothing chosen yet. Wall-clock and memory limits, no network, no file system beyond the sandbox, killed on timeout. Generated tests run locally, and only failures go back to the model (fewer AI calls). Languages without a safe runtime stay "not run".

**Acceptance:** an infinite loop, a memory blow-up and a network call are each stopped and reported; pass/fail shown per test from real runs; eval set reports test pass rate per difficulty; no new paid service.

---

## Phase 15 — Screenshots, visualization, system design and low-level design (planned)

**Objective:** FR-C1 (screenshot input), FR-C6 (visualization), FR-C12.

**Key tasks:** screenshot input only from a file the user picks or pastes, never screen capture. Text extraction needs a vision-capable free model or a browser API; which one, its data policy and free limits are **TODO(verify)**. Until then the user pastes the text. Dry-run visualization (array pointers, tree and graph traversal) is drawn in the browser from the dry-run steps without another AI call. System design and LLD practice reuse the answer formats in REQUIREMENTS §2.3, with requirements → components → trade-offs and follow-ups.

**Acceptance:** screenshot text is shown for the user to correct before it's used; visualization matches the dry run; design answers flag impossible requirements (§5.4) and keep to the selected length.

---

## Testing strategy (all phases)

| Level | Tool | Scope |
|---|---|---|
| Unit | Vitest | Pure logic: detection, de-dup, prompt building, message validation, backoff, PCM conversion |
| Integration | Vitest + Fastify `inject` / WS client | Server routes, auth (unauthorized paths, socket termination on logout/expiry), WS protocol, resume semantics, ledger persistence and conservative reservations, provider startup checks, quota exhaustion with mocked 429s, adapters with simulated providers |
| E2E smoke | Playwright, Chromium only (from Phase 1) | Phase 1: load + WS echo against the built app. Phase 2: fake-media permission, start/stop, track release, denied path. Grows each phase. |
| E2E full | Playwright (Phase 9) | Full regression with a WAV fixture via `--use-file-for-fake-audio-capture` |
| Prompt evals | Scripted fixture set (Phase 4–6) | Grounding (no fabrication), format compliance, injection resistance |
| Performance | Debug panel timings + scripted runs | NFR-1, NFR-2, NFR-2b, NFR-4 |

CI (GitHub Actions) runs lint, typecheck, unit, integration, and (from Phase 1) Playwright smoke tests on every push. Tests never call real providers, free or paid, so they use no quota; provider adapters are mocked or simulated.
