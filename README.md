# RealTime AI Assistant

> Repository: `Metor` · Status: **Phase 0 — documentation only, no application code yet**

A lightweight, browser-first assistant that transcribes speech in real time, detects questions, and streams context-aware answers grounded in the user's own verified resume, projects, and STAR stories.

**Primary use cases**

- Mock interview and technical practice (SRE, DevOps, Platform, Cloud, Network, Network Security).
- Coding and system design practice.
- Professional meeting assistance (notes, summaries, follow-up questions).
- Live interview assistance **only where AI use is expressly permitted** by the interviewer/organization.

**What this app will not do:** covert recording, hiding itself from screen sharing, or fabricating experience. See [docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md).

## Documentation

| Document | Purpose |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Functional and non-functional requirements, technical coverage |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, audio pipeline, AI engine, API, performance, cost, storage |
| [docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md) | Consent, data handling, threat model, prompt-injection defenses |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Phases 0–9, acceptance criteria, testing strategy |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture Decision Records (ADRs) |
| [AGENTS.md](AGENTS.md) | Rules for AI coding agents (Copilot, Claude Code) |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

## Planned stack (MVP)

- **Client:** React + TypeScript + Vite, IndexedDB for local data
- **Server:** Node.js 24 + Fastify + WebSocket
- **AI (free-first, $0/month target):** simulated transcription and answers by default; Groq free tier for transcription and answers; browser Web Speech API evaluated for transcription; Gemini free tier optional (no personal data). Paid providers are disabled by default and never used as an automatic fallback. See [ADR-009](docs/DECISIONS.md#adr-009-free-first-ai-provider-strategy).
- **Tooling:** pnpm, Vitest, Playwright smoke tests from Phase 1 (Chromium), GitHub Actions
- **Dev environment:** GitHub Codespaces and GitHub Actions only (nothing installed on the local Mac, no local AI models)
- **Desktop:** Electron — deferred to Phase 7

## Getting started

Application setup instructions will be added in Phase 1 (`docs/DEVELOPMENT.md`). No API key is needed to start: the app runs in simulated mode by default. Real providers (from Phase 3) are configured through Codespaces secrets; see [.env.example](.env.example) for the variable names. Never commit `.env`.
