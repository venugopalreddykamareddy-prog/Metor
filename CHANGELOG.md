# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions will follow [Semantic Versioning](https://semver.org/) once there is a release.

## [Unreleased]

### Added

- Phase 0 docs: requirements, architecture, security and privacy, implementation plan, decision records, and agent rules (AGENTS.md, Copilot instructions). `.gitignore` and `.env.example`.
- Designs from the PR #1 review: cookie-based login (ADR-007), persisted spend ledger with reservations (ADR-008), WebSocket resume rules, no transcript storage unless opted in, devcontainer and toolchain pinning plan, browser smoke tests from Phase 1, safer rollback steps.
- Free-first provider plan (ADR-009): simulated by default, Groq free tier, Web Speech evaluation, optional Gemini without personal data, paid providers off, no paid fallback, login required for any real provider. Provider facts checked against official docs on 2026-11-24.

### Changed

- Ledger keeps the full reservation when provider usage is unknown and tracks free-tier quotas over rolling windows. Provider budget alerts are not treated as hard caps.
- Logout and session expiry close open WebSockets.
- Groq audio segments are at least 8 s so the 10 s minimum per request doesn't exhaust the hourly quota.
- Split answer latency into NFR-2 (from final transcript) and NFR-2b (end to end, per provider).
- README rewritten: Metor as the project name, current status vs plans, constraints, AI-assisted development note.
