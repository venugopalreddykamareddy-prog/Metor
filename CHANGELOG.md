# Changelog

All notable changes to this project are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
