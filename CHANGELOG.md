# Changelog

All notable changes to this project are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Phase 1 foundation: single-package pnpm project (Node 24 via `.nvmrc`/`engines`, pnpm pinned in `packageManager`); Vite + React client with connection status bar, message input, and echo log; Fastify server bound to `127.0.0.1` with `GET /healthz` and WebSocket `/ws` echo.
- Shared zod message schemas (`shared/messages.ts`) validated on every WebSocket frame; invalid JSON, schema violations, and binary frames get `error bad_request`; frames over 16 KB are closed with 1009; WebSocket upgrades require an allowed `Origin` (Codespaces forwarded URLs added automatically).
- WebSocket client with exponential backoff and jitter (0.5 s → 8 s) and automatic reconnect.
- Vitest unit and integration tests (47) and Playwright smoke tests against the production build (Chromium headless shell).
- GitHub Actions CI: lint, typecheck, tests, build, client-bundle secret check, Playwright smoke tests.
- `.devcontainer/devcontainer.json` (Node 24 image, 2-core host, only port 5173 forwarded) and `docs/DEVELOPMENT.md` (startup, shutdown, testing, troubleshooting).
- ADR-010: Node 24 native TypeScript instead of `tsx`, `pnpm --parallel` instead of `concurrently`, zod for shared validation, TypeScript pinned to 6.0.

- Phase 0 documentation: README, AGENTS.md, Copilot instructions, requirements, architecture, security and privacy, implementation plan, and architecture decision records.
- `.gitignore` and `.env.example`.
- From PR #1 review: single-user cookie authentication design (ADR-007), persisted spend ledger with reservations (ADR-008), WebSocket resume semantics, no-persistence-by-default retention rules, devcontainer and toolchain pinning plan, early browser smoke tests, safer rollback guidance.
- Free-first AI provider strategy (ADR-009): $0/month target; provider adapters selected by `STT_PROVIDER` / `ANSWER_PROVIDER`; Groq free tier for transcription and answers; browser Web Speech API evaluation with browser and audio-source limits; optional Gemini free tier restricted to non-personal data; simulated transcription and simulated answer generation; `ALLOW_PAID_PROVIDERS=false` by default; quota exhaustion pauses without any paid fallback; authentication required for every real cloud API, including free ones. Provider facts verified from official docs on 2026-11-24.
- Requirements FR-A8, FR-Q9, FR-P1–FR-P5 and provider data-policy table in SECURITY_PRIVACY.md.

### Changed

- Spend ledger keeps the full reservation when provider usage is unknown and tracks free-tier quota units (ADR-008).
- Provider budget alerts are no longer described as hard spending caps.
- Logout and authentication expiry now terminate active WebSocket connections (close code `4401`), with tests in Phase 2.
- `.env.example`: replaced `OPENAI_API_KEY` and generic model variables with provider-selection, Groq, and Gemini placeholders; `DAILY_SPEND_LIMIT_USD` defaults to `0`.
- README: Playwright smoke tests start in Phase 1; free-first stack summary.
- AGENTS.md and Copilot instructions: development constraints (Codespaces/Actions only, no local models, minimal dependencies) and free-first provider rules.
- NFR-1 split into streaming (Web Speech) and per-utterance (Groq) latency targets.
- From review of bb58f54: Groq segments ≥ 8 s with hourly quota math; NFR-2 measured from the final transcript plus per-provider end-to-end target NFR-2b; shadow-cost tracking and published free-tier quotas to guard against billing-enabled accounts; rolling-window quota counting; Groq Llama free-tier availability marked TODO(verify); Gemini acknowledgement covers the EEA/Switzerland/UK rule.
