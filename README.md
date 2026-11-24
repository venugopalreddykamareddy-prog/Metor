# Metor

Metor is a personal project: a browser app that will transcribe speech, spot questions, and stream suggested answers based on my own verified resume and project notes. I'm building it mainly for SRE, DevOps, and networking interview practice.

## Status

| Phase | State |
|---|---|
| 0. Docs and agent rules | Done (PR #1) |
| 1. Web foundation | Done (PR #2) |
| 2. Login, mic capture, simulated transcription | Done (PR #4) |
| 3. Real transcription: Browser speech and Groq Whisper | In review (PR #5) |
| 4. Question understanding and answers: validate the question first (false premises, made-up terms, mishearings), one request per question | Planned |
| 5–9. Resume grounding and experience checks, practice mode, desktop app, hardening, release | Planned |
| 10–12. Camera preview, presence coaching, disclosed gaze correction | Planned (no video work yet) |

Details for every phase: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

### What works (through Phase 3)

Metor transcribes what you say. There are no AI answers yet.

- **Transcription modes**, picked before each recording:
  - **Browser speech** (Web Speech API): no key, words appear as you talk. In Chrome and Edge the browser sends audio to Google or Microsoft; nothing goes to the Metor server.
  - **Groq Whisper** (free tier, needs `GROQ_API_KEY`): the server sends speech segments to Groq; text appears a few seconds after you pause. Usage is capped below the free-tier limits, and Metor never falls back to a paid service.
  - **Simulated**: canned interview questions, for tests and demos.
- **Technical vocabulary**: both real modes get hints for SRE, Kubernetes, networking, AWS, and Azure terms, and common mishearings are fixed (for example "cube cuddle" → kubectl, "a k s" → AKS).
- **Raw and clean transcripts**: the raw view shows exactly what the recognizer heard. The clean view joins fragments into sentences, keeps question boundaries, removes "um"/"uh" and stutters, and adds capitals and punctuation. It runs locally, with no extra API calls.
- **Corrections**: fix a misheard word once ("cloud flair" → Cloudflare) and it's fixed in future recordings too, or edit a single sentence. The raw text never changes.
- **Transcript**: live partial text, auto-scroll, Clear transcript. An Accuracy check panel scores a read-aloud script for raw and clean text. First real test: Browser speech in Chrome, final latency p50 0.45 s over 6 samples; the full accuracy run is still to do ([docs/STT_EVALUATION.md](docs/STT_EVALUATION.md)).

- **Login** with a single passphrase (scrypt hash in `.env`), an HttpOnly session cookie, and a lockout after 5 wrong attempts. Logout or the 12-hour expiry closes open connections.
- **Recording**: Start asks for consent, then the browser's mic permission. A red indicator with a timer shows while the mic is open. Pause, Resume, and Stop work; Stop, logout, and lost sessions release the mic.
- **Audio path** (Simulated and Groq): an AudioWorklet downsamples the mic to 16 kHz PCM and sends 100 ms frames over the WebSocket. A debug line shows the frames, bytes, and audio level the server received each second, plus final-text latency.
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
pnpm dev     # client + server; open port 5173 in Chrome from the Ports tab and log in. Ctrl+C stops both.
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
