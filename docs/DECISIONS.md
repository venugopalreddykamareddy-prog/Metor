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

**Decision:** Store all user data in the browser's IndexedDB. The server is stateless across sessions and receives KB content per request.

**Consequences:** No cross-device sync. Data is lost if browser storage is cleared — provide export/import. Browser storage quota is ample for text.

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
