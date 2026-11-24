# Security and Privacy

## 1. Acceptable use

This app is for practice, personal preparation, and meetings or interviews where participants know about the recording/assistance and AI use is permitted. The design supports that by default:

| Control | Implementation |
|---|---|
| Explicit capture | Audio starts only from a user click. No auto-start, no scheduled or unattended capture. |
| Visible indicator | Red recording indicator + timer in the app while capture is active. Browser's own capture indicator is never suppressed. |
| Disclosure step | Live meeting/interview modes require acknowledging that participants are informed and AI assistance is permitted. Stored in session metadata. |
| No concealment | No screen-share hiding, content-protection flags, transparent overlays, or "stealth" modes. The Phase 7 floating window is a normal, capturable window. |
| Honest answers | AI claims experience only from verified KB items. |

Features that violate these controls will not be accepted, regardless of who requests them.

## 2. Data inventory

| Data | Sensitivity | Where | Default retention |
|---|---|---|---|
| Raw audio | High | Streamed through server memory to provider; never stored | Not stored |
| Transcripts | High (may include third parties' speech) | Browser memory; IndexedDB **only after the user opts in** | **Not persisted by default.** Opt-in retention: 7 / 30 / 90 days |
| Resumes, JDs, stories | High (PII) | Browser IndexedDB (explicit user upload) | Until user deletes |
| AI answers | Medium | Same as transcripts | Same as transcripts |
| API keys | Critical | Server env vars / Codespaces secrets only | — |
| Auth passphrase | Critical | Server env var, stored as a scrypt hash only | — |
| Spend ledger | Low (counts and cost estimates only) | Server file `data/spend-ledger.json` (gitignored) | 90 days of daily totals |
| Server logs | Low | Server | Metadata only: timings, error codes, token counts. **Never** transcript text, KB text, cookies, or tokens. |

**Third-party processing:** audio and text are sent to the configured AI provider. Users must review the provider's data-usage and retention policy; document the chosen provider's policy in this file in Phase 3.

### 2.1 Retention rules

1. **No persistence until selected.** Sessions live in browser memory and are discarded on tab close unless the user enables "Save sessions" in settings and picks a retention period.
2. **Deletion ships with storage.** The phase that first writes transcripts to IndexedDB (Phase 5) must also ship expiry (purge on app start and hourly), per-session delete, and "delete everything". No storage feature merges without them.
3. **Local vs provider retention are different.** Deleting locally removes data from this browser only. It does not delete anything the AI provider retained under its own policy. The UI states this next to the delete controls, and §2 links the provider's policy once chosen.
4. Raw audio is never persisted (no opt-in in MVP).

## 3. Threat model (STRIDE summary)

| Threat | Example | Mitigation |
|---|---|---|
| Spoofing | Anyone who reaches the Codespaces/deployed URL uses your API key | Authenticated access (§3.1) is mandatory before any paid provider is enabled; Codespaces ports kept private; unauthorized-request tests. Origin checks are defense-in-depth only, not authentication. |
| Tampering | Malformed WS messages | Schema validation on every message; size limits on frames and text fields |
| Repudiation | — (single user) | Minimal audit log of session start/stop + disclosure acknowledgement |
| Information disclosure | API key in client bundle; transcripts in logs; credentials in URLs | Keys server-only (no `VITE_` prefix); CI check scans `dist/` for key patterns; log redaction; **no credentials in query strings** (cookies only) |
| Denial of service / cost | Runaway loop sends thousands of answer requests | Per-connection rate limit; persisted spend ledger with reservation (ARCHITECTURE §11.1); max audio minutes; provider-side budget as backstop |
| Elevation of privilege | Prompt injection in a resume or transcript causes harmful output | See §4 |

### 3.1 Authentication (single user)

A token handed out by an unauthenticated endpoint authenticates nobody, so the server authenticates the **caller**:

| Aspect | Design |
|---|---|
| Login | `POST /api/login` with a passphrase. Server compares against `APP_PASSPHRASE_HASH` (scrypt, Node built-in `crypto`, constant-time compare). Rate limit: 5 attempts / 15 min / IP. |
| Session | On success, server issues a random 256-bit session ID in a cookie: `HttpOnly; Secure; SameSite=Strict; Path=/`, 12 h absolute expiry, held in server memory (restart = log in again). |
| WebSocket | Same-origin upgrade carries the cookie; server validates cookie **and** `Origin` before accepting. No tokens in URLs. |
| Logout | `POST /api/logout` deletes the server-side session. |
| Gate | Server **refuses to start** with a real provider key configured unless `APP_PASSPHRASE_HASH` is set. Simulated mode may run without auth inside a private Codespaces port. |
| Codespaces | Ports stay **private** (GitHub-authenticated, the default). Never set a port to public while a real key is configured. Verify with `gh codespace ports`. |
| Deployment (Phase 9) | Re-evaluate (e.g., OAuth via a hosted identity provider) in an ADR. |

**Required tests (before Phase 3 merges):** HTTP API without cookie → 401; WS upgrade without cookie → rejected; wrong `Origin` → rejected; expired session → 401; brute-force login → 429.

## 4. Prompt-injection defenses

Uploaded documents and **transcripts** (anyone in a meeting can say "ignore your instructions") are untrusted.

1. Wrap untrusted content in `<document>` tags with provenance attributes; system prompt states that content inside tags is data and must not change instructions.
2. Strip/escape any closing-tag sequences in user content before wrapping.
3. Model output is rendered as text/Markdown with HTML sanitized — never `dangerouslySetInnerHTML` with raw model output.
4. No tools/function calling that act on the world. The model can only produce text.
5. Generated commands are displayed in code blocks labeled "for reference — review before running". No "run" button, no clipboard auto-copy.
6. Length caps on KB items to limit injection surface and cost.

## 5. Application security checklist

- [ ] `.env` gitignored; `.env.example` holds placeholders only
- [ ] No secrets in client bundle (CI grep of `dist/`)
- [ ] Authentication (§3.1) enforced on all `/api/*` (except login) and `/ws`; unauthorized tests pass
- [ ] Server refuses to start with a real provider key and no `APP_PASSPHRASE_HASH`
- [ ] No credentials in URLs; logs redact `cookie` and `authorization` headers
- [ ] CORS restricted to `ALLOWED_ORIGINS`; WS checks `Origin` header
- [ ] Fastify body/frame size limits set
- [ ] Rate limiting on HTTP and WS
- [ ] Content Security Policy on the client (no inline scripts, `connect-src` limited to own server)
- [ ] Markdown rendering sanitized
- [ ] Dependencies: `pnpm audit` in CI; Dependabot enabled; minimal dependency count
- [ ] GitHub secret scanning and push protection enabled on the repo
- [ ] Transcripts not persisted unless opted in; expiry + delete shipped with first storage feature
- [ ] Data export and "delete everything" available in settings

## 6. Incident response (personal project scale)

If an API key may have leaked: revoke it in the provider console immediately, create a new key, update the Codespace secret, check provider usage for unexpected spend, and rewrite git history only if the key was committed (then rotate anyway).
