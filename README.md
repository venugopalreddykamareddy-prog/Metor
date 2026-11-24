# Metor

Metor is a personal project: a browser app that transcribes speech, spots questions, and streams suggested answers based on my own verified resume and project notes. I'm building it mainly for SRE, DevOps, and networking interview practice.

## Status

Main has design docs only. No application code is merged yet.

| Phase | State |
|---|---|
| 0. Docs and agent rules | Done (PR #1) |
| 1. Web foundation: React + Vite client, Fastify server, WebSocket echo, CI | In review (PR #2) |
| 2–9. Mic capture, transcription, answers, resume grounding, practice mode, desktop app, hardening, release | Planned, see [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) |

## Constraints

These shape most of the design decisions:

- **No cost.** Simulated providers by default, then free tiers (Groq, optional Gemini, browser Web Speech). Paid APIs are off by default and never used as a fallback when a free quota runs out ([ADR-009](docs/DECISIONS.md#adr-009-free-first-ai-provider-strategy)).
- **Nothing installed on my Mac.** Development runs in GitHub Codespaces and CI in GitHub Actions. No local AI models.
- **Consent and honesty.** Recording starts only when I click Start and always shows an indicator. Live use only where AI help is allowed. Metor never hides from screen sharing and never invents experience ([docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md)).
- **Small footprint.** One package, no database server, few dependencies.

## Docs

- [REQUIREMENTS.md](docs/REQUIREMENTS.md): what Metor should do, with priorities
- [ARCHITECTURE.md](docs/ARCHITECTURE.md): components, message protocol, cost controls
- [SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md): consent, data handling, auth, threats
- [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): phases and acceptance criteria
- [DECISIONS.md](docs/DECISIONS.md): decision records (ADRs)
- [AGENTS.md](AGENTS.md): rules for AI coding agents working in this repo

## How it's built

I set the requirements and review changes before merging. So far the code and docs have been drafted with Claude Code; `.github/copilot-instructions.md` sets up the same rules for Copilot. Commits made with an agent carry a `Co-Authored-By` line.

Setup instructions land with Phase 1 in `docs/DEVELOPMENT.md`. No API key is needed for Phases 1–2.
