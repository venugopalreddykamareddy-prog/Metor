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
- **AI:** Cloud speech-to-text and LLM APIs (provider/model IDs verified in Phase 3–4)
- **Tooling:** pnpm, Vitest, Playwright (later), GitHub Actions
- **Dev environment:** GitHub Codespaces (nothing installed on the local Mac)
- **Desktop:** Electron — deferred to Phase 7

## Getting started

Application setup instructions will be added in Phase 1. Until then:

```bash
cp .env.example .env   # fill in keys locally; never commit .env
```
