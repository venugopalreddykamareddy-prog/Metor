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
- [ ] Repo settings: secret scanning + push protection enabled (GitHub → Settings → Code security) — not readable with the Codespace token; owner to confirm

---

## Phase 1 — Lightweight web application foundation 🔍 (in review)

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
- [x] `pnpm dev` starts both; the app loads through the Vite port; status turns "Connected" (verified with headless Chromium on `127.0.0.1:5173`; owner to confirm via the forwarded URL)
- [x] Typing a message shows the echo; sending invalid JSON returns an error message
- [x] Killing the server shows "Disconnected"; restarting reconnects automatically (~2.3 s after restart)
- [x] `curl localhost:8787/healthz` → `{"status":"ok"}`
- [x] `pnpm build && pnpm start` serves the built client, and WS works on the single port (Playwright smoke test)
- [x] `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e` pass locally; CI: see PR checks
- [x] CI uses the Node version from `.nvmrc` and the pnpm version from `packageManager`
- [ ] Rebuilding the Codespace from `.devcontainer` works; only port 5173 is forwarded, and it is private (image, `sudo corepack enable`, and frozen install verified in Docker; full Codespace rebuild for the owner)
- [x] No API key referenced anywhere in `client/`; no credentials in any URL (CI greps `dist/client`)

**Risks:** Codespaces port forwarding and WS through the Vite proxy — verify early. Over-scaffolding by Copilot — reject extra libraries. Devcontainer changes require a Codespace rebuild (a few minutes).

---

## Phase 2 — Microphone capture and simulated transcription

**Objective:** Real mic capture with consent flow and indicator; audio frames streamed to server; server returns **simulated** partial/final transcripts; authentication and resume protocol in place **before** any real provider exists. Zero API cost.

**Requirements:** FR-A1–A5, FR-S1 (in-memory session), FR-P4, NFR-11, session lifecycle (ARCHITECTURE §7), WS messages (§6.2), resume semantics (§6.3), authentication (SECURITY_PRIVACY §3.1).

**Files:** `client/src/audio/capture.ts`, `client/src/audio/pcm-worklet.ts`, `client/src/ui/RecordingIndicator.tsx`, `client/src/ui/TranscriptPane.tsx`, `client/src/ui/ConsentDialog.tsx`, `client/src/ui/Login.tsx`, `server/src/auth/` (login, cookie sessions, per-session socket registry), `server/src/ws/session.ts` (session registry, grace period, seq tracking), `server/src/providers/config.ts` (`STT_PROVIDER`/`ANSWER_PROVIDER`/`ALLOW_PAID_PROVIDERS` parsing and startup checks; only `simulated` accepted in this phase), `server/src/stt/types.ts` (adapter interface with `billing` field), `server/src/stt/simulated.ts`, `scripts/hash-passphrase.ts`, unit + integration + e2e tests.

**Dependencies:** none new expected (Web Audio API, AudioWorklet, Node `crypto` scrypt are built in). `@fastify/cookie` if needed; justify per AGENTS.md.

**Storage impact:** negligible.

**Acceptance criteria**
- [ ] Login required. Unauthorized HTTP gets 401, WS without cookie or with a wrong Origin is rejected, brute force gets 429 (integration tests)
- [ ] Logout closes the user's open WebSockets with `4401`; session expiry (mocked clock) does the same; client stops capture and shows login (integration + e2e)
- [ ] Startup checks: any non-simulated provider without `APP_PASSPHRASE_HASH` → refuses to start; `ALLOW_PAID_PROVIDERS` defaults to `false` (unit tests)
- [ ] Start shows consent dialog → browser permission prompt → indicator + timer visible
- [ ] Audio frames reach the server with sequence numbers (debug counter of bytes/sec in dev panel)
- [ ] Simulated partials appear in grey and are replaced by finals
- [ ] Pause stops sending audio; Stop releases the mic (browser mic icon disappears)
- [ ] Denying permission shows a clear error and returns to Idle
- [ ] Every resume test listed in ARCHITECTURE §6.3 passes
- [ ] Terminal failure stops all media tracks and hides the indicator
- [ ] Transcript is held in memory only; nothing is written to IndexedDB
- [ ] Unit tests: STT adapter interface, simulated transcript sequencing, PCM conversion, frame seq encoding
- [ ] **E2E (Playwright, Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`):** login → start → simulated transcript appears → stop → assert tracks ended and indicator hidden; permission-denied path shows error; logout during capture → tracks ended, indicator hidden, login shown

**Risks:** AudioWorklet loading under Vite; sample-rate differences across devices; cookie `Secure` flag on non-HTTPS localhost in tests (Chromium treats localhost as secure; verify).

---

## Phase 3 — Real-time transcription integration

**Objective:** Add free real transcription behind the same adapter: `GroqSTT` (server, per-utterance upload) and an evaluated `webspeech` client option. Simulated stays the default.

**Entry gate:** Phase 2 auth, socket-termination, and resume tests pass. The server refuses to start with any real provider unless `APP_PASSPHRASE_HASH` is set.

**Key tasks:** re-verify official docs for Groq (endpoint, models, formats, free-tier limits from the account limits page, data policy, ZDR) and Web Speech (browser support, `start(audioTrack)`, vendor data policy); implement the **spend + quota ledger (ARCHITECTURE §11.1) before the first real provider call**, including conservative reservations for unknown usage; implement `GroqSTT` (segment sizing per ARCHITECTURE §4.3 with a unit test of the hourly quota math, WAV header, ≥10 s accounting, rolling-window quotas, shadow cost, 429/`retry-after` → `quota_exhausted`); implement the `webspeech` client adapter behind login (mic, plus Chromium tab track if it works; restart on end; no `processLocally`); compare both on 3 test recordings (accuracy on technical terms, latency) and record results; decide ADR-005; enforce `MAX_TRANSCRIPTION_MINUTES`; add Chromium tab-audio source option.

**Acceptance:** Groq end-of-utterance → final p50 < 2.0 s and Web Speech partial p50 < 1.0 s, measured in the debug panel on 3 test recordings; reconnect within 5 s after network drop; ledger survives a server restart mid-session (test), keeps reservations when usage is unknown (test), and refuses calls over local quota or a non-zero spend limit; mocked provider 429 → feature pauses with reset time and **no provider switch** (test); upstream calls stop on disconnect and on logout; Web Speech unavailable until logged in (test); provider data policies re-verified in SECURITY_PRIVACY §2.2. CI never calls a real provider.

**Risks:** free-tier limits or models change; Groq per-utterance latency; Web Speech behavior differs by browser and may not accept display-capture tracks.

---

## Phase 4 — Question detection and streaming AI answers

**Objective:** Detect questions, classify type, stream answers with cancellation and de-dup.

**Key tasks:** heuristic detector (pure functions + test table of 50+ real phrasings); silence debounce; de-dup; answer engine with prompt templates per type/length; **`SimulatedAnswer` adapter first** (streams canned, type-appropriate answers for UI and CI); `GroqAnswer` adapter (re-verify model IDs and free-tier limits); optional `GeminiAnswer` adapter (requires `GEMINI_FREE_TIER_DATA_ACK=true`, strips KB content, refused in live modes); `answer.*` messages; Markdown sanitized rendering; ledger reservations for classification and answers; quota-exhausted handling with no automatic fallback; timing instrumentation. Sessions remain in memory only (FR-S1).

**No personal-experience claims yet (FR-Q8):** without a verified KB, prompts instruct general/theoretical answers. Behavioral questions get a clearly labeled example approach, never a first-person story.

**Acceptance:** 0 duplicate requests in test script; final-transcript → first-token p50 < 1.5 s with `GroqAnswer` (NFR-2); end-to-end NFR-2b measured and recorded for each STT provider; cancel stops upstream request and keeps the reservation unless usage is reported; Gemini adapter never receives KB content (test); quota exhaustion never selects another provider (test); detector precision/recall measured on the test table (target ≥ 85% each); prompt eval confirms no first-person experience claims.

---

## Phase 5 — Resume and job description integration

**Objective:** Knowledge base with provenance labels, grounded answers.

**Key tasks:** IndexedDB schema (`kb`, `sessions`, `settings`); KB editor UI with provenance labels; grounded answers only via providers allowed to receive personal data (Groq with ZDR, not Gemini free tier); text/Markdown import; keyword retrieval; prompt grounding + injection defenses; **opt-in session persistence (FR-S1b) shipped together with retention, expiry purge, per-session delete, "delete everything", and export (FR-S4)**; UI note that local deletion does not affect provider retention.

**Acceptance:** behavioral question with a matching verified story produces STAR using only that story's facts; with no match, the answer says so and labels any example hypothetical; injection test documents ("ignore previous instructions…") do not change behavior; with persistence off (the default), nothing session-related is written to IndexedDB (test); expired sessions are purged on startup (test with a mocked clock).

---

## Phase 6 — SRE and technical interview practice

**Objective:** Practice mode with question bank across SRE and networking profiles, feedback on spoken answers, weak-topic tracking, session summaries and history.

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
