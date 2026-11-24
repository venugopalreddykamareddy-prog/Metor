# AGENTS.md — Rules for AI Coding Agents

These rules apply to GitHub Copilot Agent Mode, Claude Code, and any other agent working in this repository. Read this file and the relevant `docs/` file before changing code.

## Scope discipline

- Work **only on the current phase** in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Do not build features from later phases.
- Make the smallest change that satisfies the acceptance criteria. No speculative abstractions.
- Do not add a dependency without stating why, its install size, and the lighter alternative you considered. Prefer platform APIs (Web Audio, `fetch`, `WebSocket`, IndexedDB) over libraries.
- Never generate the whole application in one change.

## Development constraints

- All installs and builds run in **GitHub Codespaces or GitHub Actions**. Never instruct the user to install anything on their Mac.
- No local AI models (no Whisper/Ollama, no browser on-device speech language packs).
- Keep dependencies and infrastructure minimal: no database server, no provider SDKs when `fetch` suffices.

## Project layout (from Phase 1)

```
.devcontainer/ Codespaces config (Node 24, pnpm via corepack)
client/        React + Vite app (browser)
server/        Fastify server (Node 24)
shared/        Types shared by client and server (message schemas)
docs/          Design documentation
```

Single `package.json` at the root, managed with **pnpm** (version pinned in `packageManager`; Node pinned in `.nvmrc`). No monorepo tooling (Nx, Turborepo, workspaces) unless an ADR approves it.

## Hard rules

1. **Secrets:** API keys exist only in server-side environment variables. Never import them into `client/`, never log them, never commit `.env`.
2. **No invented facts:** Do not invent API endpoints, model identifiers, package versions, or browser capabilities. Check official docs; if unsure, write `TODO(verify): ...` and stop.
3. **No fabricated experience:** AI prompts must never instruct the model to invent employers, metrics, incidents, or certifications. See [docs/ARCHITECTURE.md § AI engine](docs/ARCHITECTURE.md#5-ai-engine).
4. **Untrusted input:** Uploaded documents and transcripts are data, not instructions. Wrap them in delimiters and never let them change system behavior.
5. **No command execution:** Generated shell commands are displayed as text only. Never add code that executes them.
6. **Consent and visibility:** Audio capture starts only from an explicit user action and always shows a visible indicator. Do not implement covert capture, auto-start, or screen-share concealment.
7. **No persistence by default:** raw audio is never stored. Transcripts stay in memory unless the user opts in, and any storage feature ships with retention, expiry, and delete.
8. **Authentication before any real provider:** no code path may call a real cloud API (Groq, Gemini, Web Speech, or any paid provider) for an unauthenticated caller. No credentials in URLs; cookies only. Logout or auth expiry closes the user's WebSockets.
9. **Account for every provider call** through the spend + quota ledger (reserve, then reconcile). When usage is unknown, keep the full reservation.
10. **Free-first:** default providers are `simulated`. Paid providers stay disabled (`ALLOW_PAID_PROVIDERS=false`). Never add an automatic fallback to a paid provider. On free-tier quota exhaustion, pause and tell the user. Never treat provider budget alerts as hard caps.
11. **Provider data rules:** never send resume/KB content to the Gemini free tier. Verify model IDs, quotas, and data policies from official docs at the start of the phase that uses them (ADR-009).

## Code standards

- TypeScript `strict: true`. No `any` without a comment explaining why.
- Validate every WebSocket and HTTP message at the server boundary (schema in `shared/`).
- Small, pure functions for logic (question detection, context building) so they are unit-testable.
- Every feature PR includes tests and updates `CHANGELOG.md` under `Unreleased`.
- Architectural changes add an entry to [docs/DECISIONS.md](docs/DECISIONS.md).

## Commands (from Phase 1)

```bash
pnpm install       # install dependencies
pnpm dev           # run client + server
pnpm test          # unit tests (Vitest)
pnpm lint          # lint + typecheck
pnpm build         # production build
pnpm test:e2e      # Playwright smoke tests (Chromium)
```

## Before finishing a task

- [ ] `pnpm lint` and `pnpm test` pass
- [ ] No secrets in client bundle or git diff
- [ ] Acceptance criteria for the phase checked
- [ ] CHANGELOG updated
