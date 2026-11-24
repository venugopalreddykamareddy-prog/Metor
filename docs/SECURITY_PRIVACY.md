# Security and Privacy

## 1. Acceptable use

Metor is for practice, preparation, and meetings or interviews where everyone knows about the recording and AI help is allowed. These controls are on by default:

| Control | Implementation |
|---|---|
| Explicit capture | Audio starts only from a user click. No auto-start, no scheduled or unattended capture. |
| Visible indicator | Red recording indicator + timer in the app while capture is active. Browser's own capture indicator is never suppressed. |
| Disclosure step | Live meeting/interview modes require acknowledging that participants are informed and AI assistance is permitted. Stored in session metadata. |
| No concealment | No screen-share hiding, content-protection flags, transparent overlays, or "stealth" modes. The Phase 7 floating window is a normal, capturable window. |
| Honest answers | AI claims experience only from verified KB items. |
| Authorized AI use | Live modes require confirming AI assistance is permitted; Gemini free tier is blocked in live modes (§2.2). |

I won't merge features that weaken these controls.

## 2. Data inventory

| Data | Sensitivity | Where | Default retention |
|---|---|---|---|
| Raw audio | High | Streamed through server memory to the provider (Groq: per-utterance upload), or sent by the browser to its vendor's speech service (Web Speech); never stored by this app | Not stored |
| Transcripts | High (may include third parties' speech) | Browser memory; IndexedDB **only after the user opts in** | **Not persisted by default.** Opt-in retention: 7 / 30 / 90 days |
| Resumes, JDs, stories | High (PII) | Browser IndexedDB (explicit user upload) | Until user deletes |
| AI answers | Medium | Same as transcripts | Same as transcripts |
| Word corrections ("heard as → should be") | Low | Browser `localStorage` | Until removed in the UI |
| API keys (`GROQ_API_KEY`, `GEMINI_API_KEY`) | Critical | Server env vars / Codespaces secrets only | — |
| Auth passphrase | Critical | Server env var, stored as a scrypt hash only | — |
| Spend ledger | Low (counts, quota units, and cost estimates only) | Server file `data/spend-ledger.json` (gitignored) | 90 days of daily totals |
| Server logs | Low | Server | Metadata only: timings, error codes, token counts. **Never** transcript text, KB text, cookies, or tokens. |

**Third-party processing:** with a real provider selected, audio and text are sent to that provider. In simulated mode (the default) nothing leaves the server. Provider policies are summarized in §2.2 and must be re-verified when the provider is enabled (Phases 3–4).

### 2.2 Provider data policies (observed 2026-11-24; re-verify)

| Provider | What it receives | Policy summary | Rule in Metor |
|---|---|---|---|
| Simulated | Nothing | — | Default for dev, CI, demos |
| Groq (free tier) | Speech segments (Phase 3); prompts incl. KB excerpts and transcript (Phase 4+) | No retention of inference data by default; may log up to 30 days for reliability/abuse; Zero Data Retention toggle available. Training use not stated — TODO(verify). | Default real provider. **Enable ZDR** in Groq Data Controls before use. |
| Gemini (free tier) | Prompts and transcript only | Unpaid-service content is used to improve Google products and may be read by human reviewers; terms say not to submit sensitive, confidential, or personal information. EEA/CH/UK end users require paid services. | Optional. Requires `GEMINI_FREE_TIER_DATA_ACK=true` (data terms and region rule). Do not use if you are in the EEA, Switzerland, or the UK. **KB/resume content is never sent**; live meeting/interview modes refused; practice with general questions only. |
| Web Speech API (browser) | Microphone audio | Chrome and Edge process it on Google or Microsoft servers under their policies (TODO(verify) current Chrome policy text). The Metor server never receives it. On-device mode not used. | Offered only after login; the consent dialog says where audio goes. |
| Paid providers | — | — | Disabled (`ALLOW_PAID_PROVIDERS=false`). None implemented in MVP; each needs an ADR and a policy row here. |

### 2.1 Retention rules

1. **No persistence until selected.** Sessions live in browser memory and are discarded on tab close unless the user enables "Save sessions" in settings and picks a retention period.
2. **Deletion ships with storage.** The phase that first writes transcripts to IndexedDB (Phase 5) must also ship expiry (purge on app start and hourly), per-session delete, and "delete everything". No storage feature merges without them.
3. **Local vs provider retention are different.** Deleting locally removes data from this browser only. It does not delete anything the AI provider retained under its own policy. The UI states this next to the delete controls and links the policies in §2.2.
4. Raw audio is never persisted (no opt-in in MVP).

## 3. Threats

| Threat | Example | Mitigation |
|---|---|---|
| Spoofing | Anyone who reaches the Codespaces/deployed URL uses your API key or free-tier quota | Authenticated access (§3.1) is mandatory before **any real cloud provider** (free or paid) is enabled; Codespaces ports kept private; unauthorized-request tests. Origin checks are defense-in-depth only, not authentication. |
| Tampering | Malformed WS messages | Schema validation on every message; size limits on frames and text fields |
| Repudiation | — (single user) | Minimal audit log of session start/stop + disclosure acknowledgement |
| Information disclosure | API key in client bundle; transcripts in logs; credentials in URLs | Keys server-only (no `VITE_` prefix); CI check scans `dist/` for key patterns; log redaction; **no credentials in query strings** (cookies only) |
| Denial of service / cost | Runaway loop sends thousands of answer requests; silent switch to a paid provider | Per-connection rate limit; persisted spend + quota ledger with conservative reservations (ARCHITECTURE §11.1); max audio minutes; paid providers disabled by default; no automatic provider fallback; free-tier accounts without a payment method. Provider budget alerts are not relied on as caps. |
| Elevation of privilege | Prompt injection in a resume or transcript causes harmful output | See §4 |

### 3.1 Authentication (single user)

A token handed out by an unauthenticated endpoint authenticates nobody, so the server authenticates the **caller**:

| Aspect | Design |
|---|---|
| Login | `POST /api/login` with a passphrase. Server compares against `APP_PASSPHRASE_HASH` (scrypt, Node built-in `crypto`, constant-time compare). Rate limit: 5 attempts / 15 min / IP. |
| Session | On success, server issues a random 256-bit session ID in a cookie: `HttpOnly; Secure; SameSite=Strict; Path=/`, 12 h absolute expiry, held in server memory (restart = log in again). |
| WebSocket | Same-origin upgrade carries the cookie; server validates cookie **and** `Origin` before accepting. No tokens in URLs. |
| Logout / expiry | `POST /api/logout` deletes the server-side session. On logout or 12 h expiry (timer-driven), the server aborts that session's upstream calls and **closes every WebSocket opened under it** with code `4401`; the client stops capture, releases media tracks, hides the indicator, and does not reconnect (ARCHITECTURE §6.1). |
| Gate | Server **refuses to start** with any real provider selected (`groq`, `gemini`, `webspeech`, or any paid adapter) unless `APP_PASSPHRASE_HASH` is set. The client enables Web Speech only after `/api/me` confirms login. Simulated mode may run without auth inside a private Codespaces port. |
| Codespaces | Ports stay **private** (GitHub-authenticated, the default). Never set a port to public while a real provider is configured. Verify with `gh codespace ports`. |
| Deployment (Phase 9) | Re-evaluate (e.g., OAuth via a hosted identity provider) in an ADR. |

**Required tests (Phase 2, before any real provider):** HTTP API without cookie → 401; WS upgrade without cookie → rejected; wrong `Origin` → rejected; expired session → 401; brute-force login → 429; logout closes open sockets with `4401`; session expiry (mocked clock) closes open sockets; server refuses to start with a real provider and no passphrase hash.

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
- [ ] Server refuses to start with a real provider and no `APP_PASSPHRASE_HASH`
- [ ] Logout and auth expiry terminate active WebSockets
- [ ] `ALLOW_PAID_PROVIDERS=false` by default; no automatic fallback to a paid provider (test)
- [ ] Gemini adapter never receives KB content (test)
- [ ] Groq Zero Data Retention enabled
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

## 6. If an API key leaks

Revoke it in the provider console immediately, create a new key, update the Codespace secret, check provider usage for unexpected use (and confirm no payment method was added), and rewrite git history only if the key was committed (then rotate anyway).
