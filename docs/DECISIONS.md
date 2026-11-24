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

**Decision:** All development, tests, and builds run in Codespaces (and GitHub Actions). Nothing installed on the Mac until Phase 7 testing.

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

**Decision:** Start with the server relay (simpler, keys never leave the server, works with any provider). In Phase 3, verify official provider support for ephemeral transcription tokens and measure latency of both.

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

**Decision:** Passphrase login (scrypt hash in env, Node built-in `crypto`) issues a random session ID in an `HttpOnly; Secure; SameSite=Strict` cookie with 12 h expiry, held in server memory. The WS upgrade is authenticated by the cookie plus an Origin check. No credentials in URLs. Implemented in Phase 2. The server refuses to start with a real provider key unless auth is configured.

**Consequences:** Restarting the server logs the user out (acceptable). No multi-user support. Re-evaluate for public deployment in Phase 9.

---

## ADR-008: File-backed spend ledger with reservations

**Status:** Accepted · 2026-11-24 (from PR #1 review)

**Context:** An in-memory counter resets on restart and cannot enforce a daily cap. Concurrent requests can overshoot a check-then-spend limit.

**Decision:** A JSON ledger file with atomic writes and a single in-process update queue. Reserve the maximum estimated cost before each upstream call, then reconcile with actual usage. It covers transcription, classification, answers and summaries. Open reservations count as spent after a crash. A provider-side budget is the hard backstop.

**Consequences:** Costs are estimates. Valid for one server process only; multiple instances need a shared store (new ADR). No database dependency.
