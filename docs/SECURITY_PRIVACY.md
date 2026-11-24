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
| Transcripts | High (may include third parties' speech) | Browser IndexedDB | 30 days (configurable, incl. "don't store") |
| Resumes, JDs, stories | High (PII) | Browser IndexedDB | Until user deletes |
| AI answers | Medium | Browser IndexedDB | Same as transcripts |
| API keys | Critical | Server env vars only | — |
| Server logs | Low | Server | Metadata only: timings, error codes, token counts. **Never** transcript or KB text. |

**Third-party processing:** audio and text are sent to the configured AI provider. Users must review the provider's data-usage and retention policy; document the chosen provider's policy in this file in Phase 3.

## 3. Threat model (STRIDE summary)

| Threat | Example | Mitigation |
|---|---|---|
| Spoofing | Anyone hits the public Codespaces/deployed URL and uses your API key | Session token from `/api/session`; Codespaces ports private by default; production requires auth (Phase 9) |
| Tampering | Malformed WS messages | Schema validation on every message; size limits on frames and text fields |
| Repudiation | — (single user) | Minimal audit log of session start/stop + disclosure acknowledgement |
| Information disclosure | API key in client bundle; transcripts in logs | Keys server-only (no `VITE_` prefix); CI check scans `dist/` for key patterns; log redaction |
| Denial of service / cost | Runaway loop sends thousands of answer requests | Per-connection rate limit; per-session and daily spend caps; max audio minutes |
| Elevation of privilege | Prompt injection in a resume or transcript causes harmful output | See §4 |

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
- [ ] CORS restricted to `ALLOWED_ORIGINS`; WS checks `Origin` header
- [ ] Fastify body/frame size limits set
- [ ] Rate limiting on HTTP and WS
- [ ] Content Security Policy on the client (no inline scripts, `connect-src` limited to own server)
- [ ] Markdown rendering sanitized
- [ ] Dependencies: `pnpm audit` in CI; Dependabot enabled; minimal dependency count
- [ ] GitHub secret scanning and push protection enabled on the repo
- [ ] Data export and "delete everything" available in settings

## 6. Incident response (personal project scale)

If an API key may have leaked: revoke it in the provider console immediately, create a new key, update the Codespace secret, check provider usage for unexpected spend, and rewrite git history only if the key was committed (then rotate anyway).
