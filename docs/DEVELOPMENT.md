# Development

Everything runs in **GitHub Codespaces** (and CI in GitHub Actions). Nothing is installed on your Mac. Phase 1 uses no API keys and costs nothing.

## Start a Codespace

1. GitHub → **Metor** → **Code** → **Codespaces** → **Create codespace on main** (or your branch). Choose the **2-core** machine.
2. The devcontainer (`.devcontainer/devcontainer.json`) runs `sudo corepack enable && pnpm install --frozen-lockfile` on creation. Node 24 and pnpm (pinned in `package.json` `packageManager`) are ready when it finishes.
3. After changing `.devcontainer/`, rebuild: Command Palette → **Codespaces: Rebuild Container** (a few minutes).

## Run the app

| Task | Command | Notes |
|---|---|---|
| Start dev (client + server) | `pnpm dev` | Vite on `127.0.0.1:5173` (forwarded, private), Fastify on `127.0.0.1:8787` (not forwarded). Open the forwarded **5173** URL from the **Ports** tab. |
| Stop dev | **Ctrl+C** in the same terminal | Stops both processes; the server closes connections and exits. |
| Health check | `curl -s localhost:8787/healthz` | → `{"status":"ok"}` |
| Production build | `pnpm build` | Client → `dist/client`, server → `dist/server` |
| Run the build | `pnpm start` | One port (8787) serves the client, `/healthz`, and `/ws`. To view it in a browser, stop `pnpm dev` and run `PORT=5173 pnpm start` so it uses the forwarded port. Stop with **Ctrl+C**. |
| Lint + typecheck | `pnpm lint` | ESLint, then `tsc` for client and server |
| Unit + integration tests | `pnpm test` | Vitest |
| Browser smoke tests | `pnpm build && pnpm test:e2e` | Playwright (Chromium headless shell), against the built app |

**First-time Playwright setup** (once per Codespace, ~300 MB in the Codespace only):

```bash
pnpm exec playwright install --with-deps --only-shell chromium
```

## Stop the Codespace

Stop the Codespace when you're done so it doesn't use up the free monthly hours: **Code** → **Codespaces** → **⋯** → **Stop codespace**, or `gh codespace stop`.

Also set the idle timeout to **5 minutes** (the default is 30): GitHub → **Settings** → **Codespaces** → **Default idle timeout**. It applies to Codespaces created after the change. Typing, editor use, and terminal output all count as activity, and the dev server logs every request, so stop `pnpm dev` (Ctrl+C) and close the app tab when you finish.

## Ports and privacy

- Codespaces ports are **private** by default (only you, signed in to GitHub, can open them). Keep them private. Check with `gh codespace ports`.
- The server binds to `127.0.0.1` and is never forwarded. The browser reaches it only through the Vite proxy (dev) or on the same port (production build).
- The WebSocket checks the `Origin` header. Inside a Codespace the forwarded URLs are allowed automatically; add others with `ALLOWED_ORIGINS`.

## Secrets (from Phase 3, not needed now)

Real providers are not used until Phase 3. When they are:

- GitHub → **Settings** → **Codespaces** → **Secrets** → **New secret**: `APP_PASSPHRASE_HASH`, `GROQ_API_KEY`, optionally `GEMINI_API_KEY`. Scope them to this repository only. They appear as environment variables in new or rebuilt Codespaces; no `.env` file is needed.
- Keep the free-tier accounts **without a payment method** (Groq) and **without billing** (Gemini project). That is what keeps spending at $0 (ADR-009). Enable Groq Zero Data Retention.

## Troubleshooting

- **"Blocked request. This host is not allowed"** from Vite: Vite only allows this Codespace's own `-5173` URL. Make sure you're opening port 5173 of this Codespace; outside Codespaces use `http://localhost:5173`.
- **Status stays "Disconnected"**: check the server is running (`curl -s localhost:8787/healthz`) and that the server log does not show `ws upgrade rejected: origin not allowed`. If it does, add your page origin to `ALLOWED_ORIGINS`.
- **Port already in use**: a previous run is still alive. `ss -ltnp | grep -E ':(5173|8787)'` shows the PID; stop it with `kill <pid>`.
