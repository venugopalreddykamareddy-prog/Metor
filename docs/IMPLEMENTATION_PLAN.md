# Implementation Plan

Each phase must pass review against its acceptance criteria before the next begins. Phases 0–2 are detailed; later phases are refined (with exact Copilot prompts, verified dependencies, and commands) at the start of each phase so they reflect current API docs and what we learned.

**Rollback (all phases):** each phase is developed on a branch `phase-N-<name>` and merged via PR. To roll back an unmerged phase: `git switch main && git branch -D phase-N-<name>` (deletes the local branch only). To roll back a merged phase: `git revert -m 1 <merge-commit>` (creates a new commit that undoes it; history is kept).

---

## Phase 0 — Environment assessment and documentation ✅ (in review)

**Objective:** Confirm the dev environment and establish requirements, architecture, and agent rules.

**Environment (Codespace, 2026-11-24):** Ubuntu 24.04, x86_64, 2 cores, 7.8 GB RAM, 19 GB free disk, Node 24.22.2, npm 11.19.1, pnpm 12.16.1, git 2.56.0, gh 2.103.3. No installs required.

**Files:** `README.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `CHANGELOG.md`, `.gitignore`, `.env.example`, `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_PRIVACY.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md`.

**Storage impact:** < 100 KB.

**Acceptance criteria**
- [ ] User has reviewed and agreed with requirements, especially scope and acceptable-use controls
- [ ] Mermaid diagrams render on GitHub
- [ ] No secrets in repo; `.env` is ignored (`git check-ignore .env` prints `.env`)
- [ ] Repo settings: secret scanning + push protection enabled (GitHub → Settings → Code security)

---

## Phase 1 — Lightweight web application foundation

**Objective:** Runnable skeleton: Vite React client + Fastify server + typed WebSocket echo, with lint, typecheck, tests, and CI.

**Requirements:** NFR-8, NFR-10 baseline; AGENTS.md layout.

**Files to create**
```
package.json, pnpm-lock.yaml, tsconfig.json, tsconfig.node.json (if needed)
vite.config.ts, index.html (or client/index.html)
client/src/main.tsx, client/src/App.tsx, client/src/net/wsClient.ts
server/src/index.ts, server/src/ws/gateway.ts, server/src/config.ts
shared/messages.ts
eslint config, vitest config
.github/workflows/ci.yml
```

**Dependencies (expected; Copilot must confirm current versions via `pnpm add`, not hand-written versions)**
- Runtime: `react`, `react-dom`, `fastify`, `@fastify/websocket`, `@fastify/static` (serve built client), a validation lib (`zod`) or Fastify JSON Schema
- Dev: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `vitest`, `eslint` + `typescript-eslint`, `tsx` (run server TS), `concurrently` (or a tiny script) for `pnpm dev`

**Estimated storage:** ~250–400 MB `node_modules`.

**Commands**
```bash
git switch -c phase-1-foundation       # creates a branch (modifies git state, safe)
pnpm install                           # installs dependencies (writes node_modules/)
pnpm dev                               # client on :5173, server on :8787
pnpm lint && pnpm test && pnpm build
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
- Scripts: dev (client + server together), build, start, test (vitest), lint (eslint + tsc --noEmit).
- Unit tests: message validation (valid/invalid), reconnect backoff calculation.
- .github/workflows/ci.yml: on push/PR, pnpm install --frozen-lockfile, lint, test, build.
Add dependencies with `pnpm add` so versions are resolved, never hand-written.
TypeScript strict. No UI library. Update CHANGELOG.md. Do not implement audio yet.
```

**Acceptance criteria**
- [ ] `pnpm dev` starts both; opening the forwarded port shows the app; status turns "Connected"
- [ ] Typing a message shows the echo; sending invalid JSON returns an error message
- [ ] Killing the server shows "Disconnected"; restarting reconnects automatically
- [ ] `curl localhost:8787/healthz` → `{"status":"ok"}`
- [ ] `pnpm lint`, `pnpm test`, `pnpm build` pass locally and in CI
- [ ] No API key referenced anywhere in `client/`

**Risks:** Codespaces port forwarding and WS through the Vite proxy — verify early. Over-scaffolding by Copilot — reject extra libraries.

---

## Phase 2 — Microphone capture and simulated transcription

**Objective:** Real mic capture with consent flow and indicator; audio frames streamed to server; server returns **simulated** partial/final transcripts. Zero API cost.

**Requirements:** FR-A1–A5, session lifecycle (ARCHITECTURE §7), WS messages (§6.2).

**Files:** `client/src/audio/capture.ts`, `client/src/audio/pcm-worklet.ts`, `client/src/ui/RecordingIndicator.tsx`, `client/src/ui/TranscriptPane.tsx`, `client/src/ui/ConsentDialog.tsx`, `server/src/stt/types.ts` (adapter interface), `server/src/stt/simulated.ts`, tests.

**Dependencies:** none new expected (Web Audio API, AudioWorklet are built in).

**Storage impact:** negligible.

**Acceptance criteria**
- [ ] Start shows consent dialog → browser permission prompt → indicator + timer visible
- [ ] Audio frames reach the server (debug counter of bytes/sec shown in dev panel)
- [ ] Simulated partials appear in grey and are replaced by finals
- [ ] Pause stops sending audio; Stop releases the mic (browser mic icon disappears)
- [ ] Denying permission shows a clear error, returns to Idle
- [ ] Unit tests: STT adapter interface, simulated transcript sequencing, PCM conversion

**Risks:** AudioWorklet loading under Vite; sample-rate differences across devices.

---

## Phase 3 — Real-time transcription integration

**Objective:** Replace simulated STT with a real streaming provider behind the same adapter.

**Key tasks:** verify current official provider docs (endpoint, auth, audio format, model ID, pricing, data retention); implement provider adapter; decide ADR-005 (relay vs ephemeral client token) with measured latency; enforce `MAX_TRANSCRIPTION_MINUTES`; add Chromium tab-audio source option.

**Acceptance:** partial transcript p50 < 1.0 s measured in debug panel on 3 test recordings; reconnect within 5 s after network drop; limits enforced; provider data policy documented in SECURITY_PRIVACY.md.

**Risks:** provider API changes; cost during testing (use short clips, keep simulated mode default).

---

## Phase 4 — Question detection and streaming AI answers

**Objective:** Detect questions, classify type, stream answers with cancellation and de-dup.

**Key tasks:** heuristic detector (pure functions + test table of 50+ real phrasings); silence debounce; de-dup; answer engine with prompt templates per type/length; `answer.*` messages; Markdown sanitized rendering; spend limits; timing instrumentation.

**Acceptance:** 0 duplicate requests in test script; first-token p50 < 1.5 s; cancel stops upstream request; detector precision/recall measured on the test table (target ≥ 85% each).

---

## Phase 5 — Resume and job description integration

**Objective:** Knowledge base with provenance labels, grounded answers.

**Key tasks:** IndexedDB schema (`kb`, `sessions`, `settings`); KB editor UI; text/Markdown import; keyword retrieval; prompt grounding + injection defenses; export/delete all.

**Acceptance:** behavioral question with a matching verified story produces STAR using only that story's facts; with no match, the answer says so and labels any example hypothetical; injection test documents ("ignore previous instructions…") do not change behavior.

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

**Objective:** Harden and measure: CSP, rate limits, dependency audit, secret scanning in CI, load test of WS server, memory profiling of 60-min session, cost report.

**Acceptance:** all SECURITY_PRIVACY §5 items checked; NFR targets measured and recorded in this file.

---

## Phase 9 — Testing, deployment, and release

**Objective:** E2E tests (Playwright with fake media stream), deployment of the server to a lightweight host with authentication, versioned release with CHANGELOG.

**Key tasks:** choose host (ADR); auth for the deployed server; release workflow; user guide.

---

## Testing strategy (all phases)

| Level | Tool | Scope |
|---|---|---|
| Unit | Vitest | Pure logic: detection, de-dup, prompt building, message validation, backoff, PCM conversion |
| Integration | Vitest + Fastify `inject` / WS client | Server routes, WS protocol, limits, adapter with simulated provider |
| E2E | Playwright (Phase 9) | Chromium with `--use-fake-device-for-media-stream` and a WAV fixture |
| Prompt evals | Scripted fixture set (Phase 4–6) | Grounding (no fabrication), format compliance, injection resistance |
| Performance | Debug panel timings + scripted runs | NFR-1, NFR-2, NFR-4 |

CI (GitHub Actions) runs lint, typecheck, unit, integration on every push. Tests never call paid APIs; provider adapters are mocked or simulated.
