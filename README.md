# Metor

Metor is a personal project: a browser app that will transcribe speech, spot questions, and stream suggested answers based on my own verified resume and project notes. I'm building it mainly for SRE, DevOps, and networking interview practice.

## Status

| Phase | State |
|---|---|
| 0. Docs and agent rules | Done (PR #1) |
| 1. Web foundation | Done (PR #2) |
| 2. Mic capture, login, simulated transcription | Next |
| 3–9. Real transcription, answers, resume grounding, practice mode, desktop app, hardening, release | Planned, see [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) |

### What works today (Phase 1)

There is no audio or AI yet. Phase 1 is the plumbing everything else builds on:

- A React page that connects to the server over a WebSocket, shows Connected / Disconnected, and echoes messages back.
- A Fastify server on `127.0.0.1:8787` with a `/healthz` check and a `/ws` endpoint. Every message is checked against a shared schema; bad input gets an error reply, frames over 16 KB are dropped, and connections from unexpected origins are refused.
- Automatic reconnect with backoff (0.5 s up to 8 s) and a 10 s connect timeout.
- Clean shutdown on Ctrl+C or SIGTERM.
- Unit, integration, and Playwright browser tests, run in GitHub Actions on every push and PR.

## Running it

Open the repo in a 2-core GitHub Codespace; dependencies install automatically.

```bash
pnpm dev     # client + server; open port 5173 from the Ports tab. Ctrl+C stops both.
pnpm lint && pnpm test && pnpm build && pnpm test:e2e
pnpm start   # production build on one port. Ctrl+C stops it.
```

More detail, including first-time Playwright setup and troubleshooting: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). No API key is needed.

## Constraints

These shape most of the design decisions:

- **No cost.** Simulated providers by default, then free tiers (Groq, optional Gemini, browser Web Speech). Paid APIs are off by default and never used as a fallback when a free quota runs out ([ADR-009](docs/DECISIONS.md#adr-009-free-first-ai-provider-strategy)).
- **Nothing installed on my Mac.** Development runs in GitHub Codespaces and CI in GitHub Actions. No local AI models.
- **Consent and honesty.** Recording will start only when I click Start and always show an indicator. Live use only where AI help is allowed. Metor never hides from screen sharing and never invents experience ([docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md)).
- **Small footprint.** One package, no database server, few dependencies.

## Docs

- [DEVELOPMENT.md](docs/DEVELOPMENT.md): Codespace setup, commands, troubleshooting
- [REQUIREMENTS.md](docs/REQUIREMENTS.md): what Metor should do, with priorities
- [ARCHITECTURE.md](docs/ARCHITECTURE.md): components, message protocol, cost controls
- [SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md): consent, data handling, auth, threats
- [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): phases and acceptance criteria
- [DECISIONS.md](docs/DECISIONS.md): decision records (ADRs)
- [AGENTS.md](AGENTS.md): rules for AI coding agents working in this repo

## How it's built

I set the requirements, test each phase myself, and review changes before merging. So far the code and docs have been drafted with Claude Code; `.github/copilot-instructions.md` sets up the same rules for Copilot. Commits made with an agent carry a `Co-Authored-By` line.
