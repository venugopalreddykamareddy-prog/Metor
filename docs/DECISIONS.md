# Architecture Decision Records

Format: Context → Decision → Consequences. Status: Proposed / Accepted / Superseded.

---

## ADR-001: Browser-first MVP; Electron deferred

**Status:** Accepted · 2026-11-24

**Context:** Desktop features (floating window, system audio) add packaging, signing, OS permission handling, and large build toolchains. The core value — transcription + streaming answers — works in a browser.

**Decision:** Build Phases 1–6 as a web app. Introduce Electron in Phase 7 only after the core pipeline is validated.

**Consequences:** Meeting audio is limited to microphone and Chromium tab audio until Phase 7. Native Teams/Zoom/Webex apps cannot be captured from the browser.

---

## ADR-002: Single package, not a monorepo

**Status:** Accepted · 2026-11-24

**Context:** Monorepo tooling (pnpm workspaces, Turborepo, Nx) adds configuration and cognitive overhead for a single-developer project.

**Decision:** One `package.json` with `client/`, `server/`, `shared/` folders. Vite builds the client; the server runs TypeScript via a lightweight runner (choice in Phase 1).

**Consequences:** Client and server share one dependency list. Revisit if Electron (Phase 7) makes separation necessary.

---

## ADR-003: Develop in GitHub Codespaces

**Status:** Accepted · 2026-11-24

**Context:** The developer's Mac has limited disk space. The Codespace already provides Node 24, pnpm 12, git, and gh with 19 GB free.

**Decision:** All installs, development, tests, and builds run in Codespaces or GitHub Actions. No additional installations on the Mac, and no local AI models anywhere (including browser on-device speech language packs, see ADR-009). The Mac only runs a browser until Phase 7, when it downloads the CI-built app.

**Consequences:** Requires internet. Codespaces usage consumes the GitHub free monthly quota — stop the Codespace when idle. Microphone works through the HTTPS forwarded port.

---

## ADR-004: Local-first storage in IndexedDB; no database server

**Status:** Accepted · 2026-11-24

**Context:** Sensitive personal data (resumes, transcripts). Single user. Want minimal infrastructure.

**Decision:** Store all user data in the browser. Session transcripts stay **in memory by default** and go to IndexedDB only after the user opts in, with retention and deletion shipped in the same phase. The KB lives in IndexedDB. The server keeps no user content and receives KB content per request.

**Consequences:** No cross-device sync. Saved data is lost if browser storage is cleared, so provide export/import. Browser storage quota is ample for text.

---

## ADR-005: Transcription transport — server relay vs direct client connection

**Status:** Proposed — decide in Phase 3

**Context:** Relaying audio through our server adds a hop. Some providers offer ephemeral client tokens allowing the browser to connect directly to their realtime endpoint.

**Decision:** Start with the server relay (simpler, keys never leave the server, works with any provider). In Phase 3, verify official provider support for ephemeral transcription tokens and measure latency of both. Groq's transcription endpoint is request/response (upload an audio segment, receive text), so with Groq the relay sends **utterance-sized segments**, not a continuous stream (ADR-009). The browser Web Speech API is a separate path that bypasses the relay entirely.

**Consequences:** Adapter interface on the server keeps either option swappable.

---

## ADR-006: Heuristic question detection before LLM classification

**Status:** Accepted · 2026-11-24

**Context:** Running an LLM on every transcript segment is slow and costly.

**Decision:** Client-side heuristics + silence debounce detect questions; an LLM classifier is used only for ambiguous segments. Manual trigger is always available.

**Consequences:** Some missed or false detections; mitigated by manual trigger and tunable rules with unit tests.

---

## ADR-007: Single-user passphrase auth with HttpOnly cookie sessions

**Status:** Accepted · 2026-11-24 (from PR #1 review)

**Context:** A token minted by an unauthenticated endpoint does not authenticate the caller, and query-string tokens leak into logs. Anyone who reaches the URL could spend the API key.

**Decision:** Passphrase login (scrypt hash in env, Node built-in `crypto`) issues a random session ID in an `HttpOnly; Secure; SameSite=Strict` cookie with 12 h expiry, held in server memory. The WS upgrade is authenticated by the cookie plus an Origin check. No credentials in URLs. Implemented in Phase 2. The server refuses to start with **any real cloud provider** configured (free or paid, including the browser Web Speech option) unless auth is configured. Logout or session expiry **closes every WebSocket opened under that session** and aborts its upstream calls.

**Consequences:** Restarting the server logs the user out (acceptable). No multi-user support. Re-evaluate for public deployment in Phase 9.

---

## ADR-008: File-backed spend ledger with reservations

**Status:** Accepted · 2026-11-24 (from PR #1 review)

**Context:** An in-memory counter resets on restart and cannot enforce a daily cap. Concurrent requests can overshoot a check-then-spend limit.

**Decision:** A JSON ledger file with atomic writes and a single in-process update queue. Reserve the maximum estimated cost (and free-tier quota units, ADR-009) before each upstream call, then reconcile with actual usage. It covers transcription, classification, answers and summaries. **When actual usage is unknown** (no usage data, abort, timeout, crash), the full reservation is kept as spent. A reservation is released only when the request provably never reached the provider.

Provider budget alerts are **not** treated as hard caps; many are notifications only. The real guarantees are: paid providers disabled by default (`ALLOW_PAID_PROVIDERS=false`), free-tier accounts with no payment method attached, and this ledger.

**Consequences:** Costs are estimates. Conservative accounting may refuse calls slightly early. Valid for one server process only; multiple instances need a shared store (new ADR). No database dependency.

---

## ADR-009: Free-first AI provider strategy

**Status:** Accepted · 2026-11-24 (Phase 0 review). Provider facts below were observed in official docs on 2026-11-24 and **must be re-verified** at the start of Phases 3 and 4.

**Context:** The target is **$0 monthly API spend**. The earlier draft assumed a paid OpenAI key. Free tiers exist, but they have quotas, different data policies, and no streaming transcription in some cases. Development must stay in Codespaces/GitHub Actions with no local models.

**Decision:**

1. **Provider adapters, selected by config.** `STT_PROVIDER` = `simulated` | `groq` | `webspeech`. `ANSWER_PROVIDER` = `simulated` | `groq` | `gemini`. Both default to `simulated`. No provider is required; OpenAI is not required.
2. **Simulated first.** `SimulatedSTT` (Phase 2) and `SimulatedAnswer` (Phase 4) are full adapters used for development, CI, and demos.
3. **Groq free tier is the default real provider** for transcription (Whisper models) and answers (chat models), subject to Phase 3/4 evaluation.
4. **Browser Web Speech API is evaluated** as a zero-key transcription option, with documented browser and audio-source limits. On-device mode (`processLocally`) is **not** used, because it downloads a language pack to the local machine.
5. **Gemini free tier is optional** and restricted: Google's unpaid-service terms say not to submit sensitive, confidential, or personal information, and content may be used to improve products and read by human reviewers. With `ANSWER_PROVIDER=gemini`, the server **refuses to send KB/resume content**, live meeting/interview modes are blocked, and `GEMINI_FREE_TIER_DATA_ACK=true` is required. The acknowledgement also covers the region rule: the free tier must not serve end users in the EEA, Switzerland, or the UK.
6. **Paid providers are disabled by default.** `ALLOW_PAID_PROVIDERS=false`. With it false, the server refuses to start if a paid adapter is configured and `DAILY_SPEND_LIMIT_USD` must be `0`. No paid adapter is implemented in the MVP; adding one needs its own ADR.
7. **No automatic fallback to a paid provider, ever.** On free-tier quota exhaustion the feature pauses with a clear message and reset time. The user may switch manually to simulated mode or another configured free provider. Even with `ALLOW_PAID_PROVIDERS=true`, a switch to a paid provider is always a manual choice.
8. **Authentication before any real cloud API**, free or paid, including Web Speech (which sends audio to the browser vendor's service in server-based mode). See ADR-007.

**Observed facts (2026-11-24, official docs; re-verify):**

| Provider | Observation | Source |
|---|---|---|
| Groq STT | Models `whisper-large-v3-turbo`, `whisper-large-v3`. Endpoint `POST https://api.groq.com/openai/v1/audio/transcriptions` (file upload; no streaming documented). Formats include wav, webm, flac. Free-tier file limit 25 MB. Each request is billed/counted as at least 10 s. | console.groq.com/docs/speech-to-text |
| Groq limits | Whisper models listed at 20 RPM, 2K RPD, 7.2K audio-seconds/hour, 28.8K audio-seconds/day. Limits are per organization. The page labels its table as "Developer plan" base limits, so the free-tier values must be read from the account's limits page. Over limit: HTTP 429 with `retry-after`. | console.groq.com/docs/rate-limits |
| Groq chat models | Listed as production: `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`. The rate-limits page lists limits only for `openai/gpt-oss-*` (30 RPM, 1K RPD, 8K TPM, 200K TPD) and some preview models, **not** for the Llama models, so their free-tier availability is TODO(verify). Prefer `openai/gpt-oss-20b` (classify) and `openai/gpt-oss-120b` (answers) as Phase 4 candidates. | console.groq.com/docs/models, /rate-limits |
| Groq data | No retention of inference inputs/outputs by default; may log up to 30 days for reliability/abuse; Zero Data Retention toggle available to all customers. Training use not stated — TODO(verify). | console.groq.com/docs/your-data |
| Groq billing | Upgrading to the paid tier requires adding a payment method. Spend limits on the paid tier: hard-cap behavior not stated. | console.groq.com/docs/billing-faqs |
| Gemini free tier | Many models list a free tier; free-tier content is "used to improve our products" (paid: no). Limits are per project, RPD resets at midnight Pacific; view them in AI Studio. EEA/Switzerland/UK end users require paid services. Must be 18+. | aistudio.google.com/docs/pricing, /rate-limits, /terms |
| Web Speech API | `SpeechRecognition` unprefixed in Chrome 139+ (webkit-prefixed since 33), Edge mirrors Chrome, Firefox 160+, Safari webkit-prefixed 14.1+. `start(audioTrack)`: Chrome 135+, Firefox 160+, not Safari. Browser decides server-based vs on-device; server-based does not work offline. | MDN + browser-compat-data |

**Consequences:**

- Groq transcription returns **finals per utterance** (no interim partials). NFR-1 partial latency applies only to streaming-capable sources (Web Speech interim results). Groq latency is measured and recorded separately, and end-to-end answer latency has a per-provider target (NFR-2b).
- Segments must be ≥ 8 s in normal speech, or the 10 s minimum per request exhausts the hourly audio quota (ARCHITECTURE §4.3).
- A billing-enabled provider account would silently make the same key paid. Mitigations: local quotas from published free-tier limits, shadow-cost tracking, and a tier check if the provider exposes one (ARCHITECTURE §5.5).
- Free-tier quotas cap daily use; the UI must show remaining quota and reset times.
- Web Speech transcripts come from the browser, not the server, so the server cannot rate-limit them; they cost nothing, but audio goes to the browser vendor under its policy.
- Gemini cannot be used for resume-grounded answers on the free tier.
- Model IDs stay in env vars, never hard-coded, because free-tier model lists change often.
