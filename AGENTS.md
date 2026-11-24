# AGENTS.md — Rules for AI Coding Agents

These rules apply to GitHub Copilot Agent Mode, Claude Code, and any other agent working in this repository. Read this file and the relevant `docs/` file before changing code.

## Scope discipline

- Work **only on the current phase** in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Do not build features from later phases.
- Make the smallest change that satisfies the acceptance criteria. No speculative abstractions.
- Do not add a dependency without stating why, its install size, and the lighter alternative you considered. Prefer platform APIs (Web Audio, `fetch`, `WebSocket`, IndexedDB) over libraries.
- Never generate the whole application in one change.

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
8. **Authentication before spend:** no code path may call a paid provider for an unauthenticated caller. No credentials in URLs; cookies only.
9. **Account for every paid call** through the spend ledger (reserve, then reconcile).

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
```

## Before finishing a task

- [ ] `pnpm lint` and `pnpm test` pass
- [ ] No secrets in client bundle or git diff
- [ ] Acceptance criteria for the phase checked
- [ ] CHANGELOG updated
