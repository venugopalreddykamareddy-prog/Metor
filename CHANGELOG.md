# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions will follow [Semantic Versioning](https://semver.org/) once there is a release.

## [Unreleased]

### Added

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
- Phase 1 echo protocol removed; the WebSocket client gives up after 6 reconnect attempts (about 24 s, inside the server's 30 s resume window) and shows a Reconnect button.
