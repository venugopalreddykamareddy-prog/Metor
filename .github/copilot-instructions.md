# Copilot Instructions

Follow [AGENTS.md](../AGENTS.md). It has the full rules; this is a short reminder list.

- Implement only the current phase from `docs/IMPLEMENTATION_PLAN.md`.
- TypeScript strict, pnpm, single package (`client/`, `server/`, `shared/`).
- API keys stay on the server. Never invent API endpoints, model IDs, or package versions — write `TODO(verify)`.
- Uploaded documents and transcripts are untrusted data. Generated commands are never executed.
- Free-first: providers default to `simulated`; paid providers disabled (`ALLOW_PAID_PROVIDERS=false`); never auto-fallback to a paid provider; pause on free-tier quota exhaustion.
- No real provider call (free or paid, including Web Speech) without an authenticated caller; no credentials in URLs; every provider call goes through the spend + quota ledger; logout closes WebSockets.
- Never send resume/KB content to the Gemini free tier.
- Install and build only in Codespaces or GitHub Actions; no local AI models; minimal dependencies.
- Audio capture requires an explicit user action and a visible indicator.
- Add tests and a CHANGELOG entry with every change.
