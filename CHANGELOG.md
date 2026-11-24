# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions will follow [Semantic Versioning](https://semver.org/) once there is a release.

## [Unreleased]

### Added

- Phase 3 (PR #5): real transcription. Mode selector with Simulated, Browser speech (Web Speech API on Metor's own mic track, restarts after silence, phrase boosting where supported), and Groq Whisper (free tier, offered only when `GROQ_API_KEY` is set).
- Groq segments sized for the free-tier quota (voice detection with an adaptive noise floor, ≥ 8 s or a 1.5 s pause up to twice a minute, 30 s cap), WAV upload with a vocabulary prompt, and filtering of silence and Whisper hallucinations. A 429 pauses uploads until the reset time; no paid fallback.
- File-backed usage ledger: requests and audio seconds per minute for 24 h, charged before each Groq call, capped at 80% of the published free-tier limits.
- Technical vocabulary (`shared/vocabulary.ts`): Whisper prompt, Web Speech phrases, and corrections of common mishearings on final text.
- Transcript: duplicate finals dropped, auto-scroll, Clear transcript button, final-latency p50 in the debug line.
- Accuracy check panel (word error rate, technical-term recall, latency) and `docs/STT_EVALUATION.md`.
- `MAX_TRANSCRIPTION_MINUTES` is enforced. `/api/me` reports which providers are configured.
- Raw and clean transcripts (ADR-012): raw recognizer output kept as heard; a local clean view merges fragments into sentences by pause length, keeps question boundaries, removes fillers and stutters, fixes known terms with context for ambiguous phrases, and adds capitals and punctuation.
- User corrections: "heard as → should be" rules remembered in the browser, plus per-sentence edits. The accuracy check scores raw and clean text.
- Phase 4/5 roadmap: question understanding and validation (FR-U1–U9), conversation awareness (FR-C1–C4), answer style (FR-Q10), one request per question with a structured assessment header, and `eval/answer-questions.json` (113 questions) with docs/ANSWER_EVALUATION.md.
- Phase 4 question extraction requirements (FR-E1–E7), ARCHITECTURE §5.2 design, and `eval/question-extraction.json` (30 cases, questions kept word for word). FR-U10: telling mishearings apart from unfamiliar technology.
- Phase 4 acceptance additions from the third manual test (0.30 s p50): requests without "?", incomplete phrases never answered, superseded questions (FR-E9), rapid topic changes, duplicate events vs genuine repeats (FR-E8), ambiguous acronyms (FR-U11), detection accuracy and end-to-end latency targets. Extraction fixture now 30 cases with timed events; evaluation set 113 questions.
- ADR-013: answer providers. Groq free tier is the default; Claude (API key, billed) and OpenAI (separate API billing; ChatGPT Pro/Business credits possible) are optional, off by default, official API keys only.
- Roadmap: Phases 10–12 (camera preview, presence coaching, disclosed gaze correction). No video code.
- Phase 2 (PR #4): passphrase login (scrypt, HttpOnly SameSite=Strict cookie, 12 h expiry, 5-attempt lockout, Origin check on writes); `pnpm hash-passphrase`; server refuses to start without a passphrase hash or with non-simulated providers.
- Mic recording with a consent dialog, recording indicator and timer, and Start / Pause / Resume / Stop. An AudioWorklet downsamples to 16 kHz PCM16 and sends 100 ms frames with sequence numbers.
- Simulated transcription (canned lines at speaking pace) with partials, finals, and gap markers.
- Audio debug line while recording: frames/s, KB/s, and RMS level as received by the server (`audio.stats`, once per second, zeros while paused).
- Session recovery: 3 s client audio buffer, server acks, 30 s resume window, replay of missed finals, and takeover when the server still holds a stale socket. Logout and session expiry close sockets with code 4401.
- The mic is released on Stop, logout, login expiry, and terminal connection failure (Playwright checks every track ended).
- Phase 1 (PR #2): pnpm project with Node 24 and pnpm pinned; React + Vite client with connection status and a message echo; Fastify server on `127.0.0.1` with `/healthz` and `/ws`.
- `/ws` checks the `Origin` header, validates every message with shared zod schemas, rejects binary frames and frames over 16 KB, and logs only a fixed error code for bad input.
- Client reconnect with backoff (0.5 s → 8 s) and a 10 s connect timeout. Server shuts down cleanly with a 5 s limit.
- Vitest unit/integration tests, Playwright smoke tests against the production build, and GitHub Actions CI (actions pinned to commit SHAs, Dependabot for updates).
- Devcontainer (Node 24, 2-core, only port 5173 forwarded) and `docs/DEVELOPMENT.md`.
- ADR-010: Node 24 runs TypeScript directly (no `tsx`), `pnpm --parallel` instead of `concurrently`, zod for validation, TypeScript pinned to 6.0.
- Phase 0 docs (PR #1): requirements, architecture, security and privacy, implementation plan, decision records, and agent rules. `.gitignore` and `.env.example`.
- Designs from the PR #1 review: cookie-based login (ADR-007), persisted spend ledger with reservations (ADR-008), WebSocket resume rules, no transcript storage unless opted in, safer rollback steps.
- Free-first provider plan (ADR-009): simulated by default, Groq free tier, Web Speech evaluation, optional Gemini without personal data, paid providers off, no paid fallback, login required for any real provider. Provider facts checked against official docs on 2026-11-24.

### Changed

- Ledger keeps the full reservation when provider usage is unknown and tracks free-tier quotas over rolling windows. Provider budget alerts are not treated as hard caps.
- Logout and session expiry will close open WebSockets (Phase 2).
- Groq audio segments are at least 8 s so the 10 s minimum per request doesn't exhaust the hourly quota.
- Split answer latency into NFR-2 (from final transcript) and NFR-2b (end to end, per provider).
- README: Metor as the project name, current status and what works, constraints, AI-assisted development note.
- `STT_PROVIDER` removed: the transcription mode is chosen per recording in the UI (ADR-011).
- Term fixes moved out of the Groq adapter and Web Speech wrapper into the clean view; risky fixes removed (e.g. "slows" → SLOs); ADR-006 amended (no separate classification request).
- Phase 1 echo protocol removed; the WebSocket client gives up after 6 reconnect attempts (about 24 s, inside the server's 30 s resume window) and shows a Reconnect button.
