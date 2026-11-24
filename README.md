# Metor

Metor is a personal project: a browser app that will transcribe speech, spot questions, and stream suggested answers based on my own verified resume and project notes. I'm building it mainly for SRE, DevOps, and networking interview practice.

## Status

| Phase | State |
|---|---|
| 0. Docs and agent rules | Done (PR #1) |
| 1. Web foundation | Done (PR #2) |
| 2. Login, mic capture, simulated transcription | In review (PR #4) |
| 3–9. Real transcription, answers, resume grounding, practice mode, desktop app, hardening, release | Planned, see [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) |

### What works (through Phase 2)

There is no real transcription or AI yet. The transcript is **simulated**: canned interview questions appear at speaking pace, whatever you say.

- **Login** with a single passphrase (scrypt hash in `.env`), an HttpOnly session cookie, and a lockout after 5 wrong attempts. Logout or the 12-hour expiry closes open connections.
- **Recording**: Start asks for consent, then the browser's mic permission. A red indicator with a timer shows while the mic is open. Pause, Resume, and Stop work; Stop, logout, and lost sessions release the mic.
- **Audio path**: an AudioWorklet downsamples the mic to 16 kHz PCM and sends 100 ms frames over the WebSocket. The server returns partial and final transcript lines, and a debug line shows the frames, bytes, and audio level it received each second.
- **Recovery**: if the connection drops, the client keeps up to 3 s of audio, reconnects, and resumes the session (the server keeps it for 30 s). Missed lines are replayed; lost audio shows as a gap.
- **Server**: Fastify on `127.0.0.1:8787` with `/healthz`. Every message is validated, audio faster than real time is cut off, logs never contain message content or the passphrase, and shutdown is clean.
- Unit, integration, and Playwright tests (with a fake mic) run in GitHub Actions on every push and PR.

## Running it

Open the repo in a 2-core GitHub Codespace; dependencies install automatically. Set a login passphrase once:

```bash
read -rs P && printf %s "$P" | pnpm -s hash-passphrase > .env; unset P
```

Then:

```bash
pnpm dev     # client + server; open port 5173 from the Ports tab and log in. Ctrl+C stops both.
pnpm lint && pnpm test && pnpm build && pnpm test:e2e
pnpm start   # production build on one port. Ctrl+C stops it.
```

More detail, including first-time Playwright setup and troubleshooting: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). No API key is needed.

## Constraints

These shape most of the design decisions:

- **No cost.** Simulated providers by default, then free tiers (Groq, optional Gemini, browser Web Speech). Paid APIs are off by default and never used as a fallback when a free quota runs out ([ADR-009](docs/DECISIONS.md#adr-009-free-first-ai-provider-strategy)).
- **Nothing installed on my Mac.** Development runs in GitHub Codespaces and CI in GitHub Actions. No local AI models.
- **Consent and honesty.** Recording starts only after I click Start and confirm, and an indicator shows the whole time the mic is open. Live use only where AI help is allowed. Metor never hides from screen sharing and never invents experience ([docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md)).
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
