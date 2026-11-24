# Requirements

Priorities: **P0** = MVP (Phases 1–4), **P1** = Phases 5–6, **P2** = Phases 7+.

## 1. Users and use cases

| Use case | Priority | Notes |
|---|---|---|
| Mock interview / self-practice | P0 | Primary design target |
| Meeting assistance (notes, summaries, suggested questions) | P1 | |
| Coding and system design practice | P1 | |
| Live interview assistance where AI use is **expressly permitted** | P1 | Session-start disclosure acknowledgement required |

**Target technical profiles:** Site Reliability Engineer, Senior SRE, DevOps Engineer, Platform Engineer, Cloud Infrastructure Engineer, Network Engineer, Network Security Engineer, Cloud Network Engineer, Network Automation Engineer.

## 2. Functional requirements

### 2.1 Audio and transcription

| ID | Requirement | Priority |
|---|---|---|
| FR-A1 | User starts/stops microphone capture with an explicit button | P0 |
| FR-A2 | Visible recording indicator whenever audio is captured or streamed | P0 |
| FR-A3 | Partial (interim) transcript displayed while speaking; final segments replace partials | P0 |
| FR-A4 | Simulated transcription mode for development and tests (no API cost); default provider | P0 |
| FR-A5 | Pause/resume without losing session state | P0 |
| FR-A6 | Speaker separation: at minimum "me" vs "other" when two sources are available | P2 |
| FR-A7 | Capture of meeting audio (Teams, Zoom, Meet, Webex) — see [ARCHITECTURE § 4](ARCHITECTURE.md#4-audio-capture) for platform limits | P1 (tab audio) / P2 (system audio) |
| FR-A8 | Configurable transcription provider: simulated, Groq free tier, or browser Web Speech API (ADR-009) | P0 |

### 2.2 Question detection and answers

| ID | Requirement | Priority |
|---|---|---|
| FR-Q1 | Detect questions in the transcript (heuristics first, LLM classification only when ambiguous) | P0 |
| FR-Q2 | Manual "Answer this" trigger on any transcript segment | P0 |
| FR-Q3 | De-duplicate: the same question does not trigger multiple AI requests | P0 |
| FR-Q4 | Stream answers token-by-token; cancel in-flight answer when a new question arrives | P0 |
| FR-Q5 | Classify question type: conceptual, troubleshooting, behavioral, coding, system design, other | P0 |
| FR-Q6 | Configurable answer length: short (~30 s), standard (~1 min), detailed (2–3 min spoken) | P0 |
| FR-Q7 | Follow-up awareness: recent Q&A turns are included in context | P0 |
| FR-Q8 | Until verified KB support ships (Phase 5), answers must not claim personal experience. They use general and theoretical explanations, and behavioral questions get a labeled example approach, not a first-person story. | P0 |
| FR-Q9 | Simulated answer generation (no API cost); configurable answer provider: simulated, Groq free tier, or optional Gemini free tier without personal data (ADR-009) | P0 |

### 2.2a Understanding and validating the question (Phases 4–5)

Before answering, Metor works out what kind of question it is and whether it rests on something true. The goal is the judgment of an experienced engineer: answer real questions directly, push back on false premises politely, and say "I don't know that one" instead of inventing.

| ID | Requirement | Priority |
|---|---|---|
| FR-U1 | Classify intent: genuine technical, behavioral/scenario, follow-up, multiple questions at once, ambiguous/incomplete, off-topic or small talk, experience probe ("you've done X, right?"), possibly misheard | P0 (Phase 4) |
| FR-U2 | Never assume a mentioned term is real. Distinguish "I don't recognize this" (could be an internal tool, a vendor product, or a mishearing) from "this is wrong". Never invent definitions, commands, products, or behavior | P0 |
| FR-U3 | Detect incorrect technical premises and correct them politely before answering | P0 |
| FR-U4 | Recognize impossible or unrealistic requirements (zero latency, 100% uptime) and propose realistic targets | P0 |
| FR-U5 | Ask one short clarifying question when the question can't be answered as asked; otherwise answer with stated assumptions | P0 |
| FR-U6 | When a term may be misheard, show what was heard (raw transcript) and the likely intended term, and answer the likely one | P0 |
| FR-U7 | Experience probes are answered only from verified KB items; otherwise correct the premise without claiming the experience | P0 (general) / P1 (with KB, Phase 5) |
| FR-U8 | Show a short **assessment** separately from the suggested answer when something is off. Labels: incorrect premise, unrecognized term, possible transcription error, clarification needed, unrealistic requirement, insufficient information, unverified experience, off-topic. No assessment for ordinary questions; difficulty or unusual-but-real technology is not a reason to flag | P0 |
| FR-U9 | Say so when something can't be verified. Never claim a check against documentation happened unless it did. Verifying against official docs is optional and only from sources Metor actually has (e.g. curated notes in the KB, Phase 5) | P0 |

### 2.2b Conversation awareness (Phase 4)

| ID | Requirement | Priority |
|---|---|---|
| FR-C1 | Use recent questions and answers as context; answer follow-ups without repeating earlier answers | P0 |
| FR-C2 | Notice topic changes, interruptions, and corrections ("sorry, I meant mutual TLS") and switch cleanly | P0 |
| FR-C3 | Don't produce answers for greetings, small talk, meeting logistics, or unfinished sentences unless a reply is useful | P0 |
| FR-C4 | Split several questions asked together and answer them in order | P0 |

### 2.3 Answer formats

| Question type | Structure |
|---|---|
| Conceptual | Direct explanation → practical example → (optional) verified experience |
| Troubleshooting | Impact assessment → investigation → mitigation → root cause → recovery validation → prevention |
| Behavioral | STAR: Situation, Task, Action, Result — **only from verified stories**; otherwise say no matching story exists and offer a clearly labeled hypothetical approach |
| Coding | Problem restatement → approach → implementation → complexity → edge cases → tests |
| System design | Requirements → architecture → components → scalability → reliability → security → observability → trade-offs |

**Answer style (FR-Q10, P0):** answers should sound like an experienced engineer talking, not a textbook.
- Direct answer first, then the reasoning. Plain, professional, conversational English.
- A short natural opening and closing sentence; no stock filler ("Great question!") and no repeated phrases.
- Short (~30 s), standard (~1 min), and detailed (2–3 min) lengths (FR-Q6).
- STAR only for behavioral and experience questions, built from verified stories (FR-K4). Never forced onto technical questions.
- Explicit uncertainty instead of a made-up explanation: "I haven't come across that; if it's an internal tool, I'd want to know what it does first."
- Never fabricate experience, achievements, employers, or metrics.

### 2.4 Providers and cost (ADR-009)

| ID | Requirement | Priority |
|---|---|---|
| FR-P1 | Target $0 monthly API spend; simulated providers by default | P0 |
| FR-P2 | Paid providers disabled by default via `ALLOW_PAID_PROVIDERS=false` | P0 |
| FR-P3 | Free-tier quota exhaustion pauses the feature with a clear message and reset time; **never** falls back automatically to a paid provider | P0 |
| FR-P4 | Authentication required before any real cloud API, free or paid, including Web Speech | P0 |
| FR-P5 | UI shows the active provider, remaining local quota, and whether data leaves the device | P0 |

### 2.5 Knowledge base

| ID | Requirement | Priority |
|---|---|---|
| FR-K1 | Store multiple resumes and job descriptions; select active resume + JD per session | P1 |
| FR-K2 | Store experience items, projects, incidents, achievements, STAR stories, past questions, answer preferences | P1 |
| FR-K3 | Every item has a **provenance label**: `verified` (hands-on), `theoretical` (knowledge, no hands-on claim), `hypothetical` (illustrative only) | P1 |
| FR-K4 | AI may claim experience only from `verified` items; it must label hypotheticals as such. KB content is never sent to the Gemini free tier. | P1 |
| FR-K5 | Import from pasted text, `.txt`, `.md`; PDF/DOCX import is P2 (adds dependencies) | P1 |
| FR-K6 | Export and delete all data | P1 |

### 2.6 Sessions

| ID | Requirement | Priority |
|---|---|---|
| FR-S1 | Session = transcript + Q&A + metadata, held **in browser memory**; discarded on tab close | P0 |
| FR-S1b | Opt-in persistence of sessions to IndexedDB (off by default) | P1 (Phase 5) |
| FR-S2 | End-of-session summary (topics, questions asked, gaps to study) | P1 |
| FR-S3 | Session history list with search (requires FR-S1b) | P1 |
| FR-S4 | Retention 7/30/90 days, expiry purge, per-session delete, "delete everything". **Ships in the same phase as FR-S1b; never later.** | P1 (Phase 5) |

### 2.7 Practice mode (Phase 6)

- Question bank per profile and topic; random or targeted drills.
- User answers aloud; AI gives feedback on accuracy, structure, and delivery.
- Track weak topics across sessions.

### 2.8 Desktop (Phase 7)

- Electron app with a floating, resizable, always-on-top answer window.
- Window is **visible to screen capture** like any normal window (no content-protection/hiding flags).
- Authorized system audio capture per OS capabilities.

### 2.9 Video (Phases 10–12, planned)

| ID | Requirement | Priority |
|---|---|---|
| FR-V1 | Camera access with explicit consent, a visible camera indicator, and a local preview | P2 (Phase 10) |
| FR-V2 | Coaching on eye contact, head position, posture, and lighting, computed without storing video | P2 (Phase 11) |
| FR-V3 | Optional gaze correction and virtual-camera output, always disclosed to other participants and only where allowed | P2 (Phase 12) |

## 3. Technical coverage (prompt and question-bank scope)

**SRE / DevOps / Platform / Cloud:** SLIs, SLOs, SLAs, error budgets · incident management, RCA, on-call · Linux troubleshooting · Kubernetes, AKS, EKS, Docker concepts, Helm, ArgoCD · AWS, Azure (Front Door, Key Vault, Cosmos DB, Functions) · Datadog, Prometheus, Grafana, Splunk, OpenTelemetry · Terraform, Ansible · Azure DevOps, Jenkins, GitHub Actions, Octopus Deploy · Python, Bash · distributed systems, microservices, system design, HA, DR · payment platform reliability, PCI-compliant releases · TLS/SSL certificates · load balancing · automated remediation.

**Networking / Security:** Cisco FTD, ASA, FMC · Palo Alto, Panorama · Zscaler ZIA, ZPA · Fortinet · F5 BIG-IP LTM, GTM · BGP, OSPF, EIGRP, MPLS · Cisco Nexus, ACI · LAN/WAN, SD-WAN · Wireshark · DNS, TCP/IP · AWS and Azure networking · firewall troubleshooting · network automation · infrastructure security.

Coverage is delivered through prompt templates and a question bank, **not** hard-coded answers.

## 4. Non-functional requirements

Targets are measured engineering goals, not guarantees. They depend on network and provider latency.

| ID | Category | Target |
|---|---|---|
| NFR-1 | Partial transcript latency (speech → text on screen) | p50 < 1.0 s, p95 < 2.0 s for streaming sources (Web Speech interim results). Groq returns finals per utterance; its end-of-utterance → final latency is measured and recorded, target p50 < 2.0 s. |
| NFR-2 | Time to first answer token, measured from the question's **final transcript** to the first token | p50 < 1.5 s, p95 < 3.0 s |
| NFR-2b | End-to-end: question end (speech stops) → first answer token, per STT provider | Web Speech: p50 < 2.5 s. Groq: p50 < 3.5 s (includes per-utterance transcription, NFR-1). Measured and recorded in Phases 3–4. |
| NFR-3 | Duplicate AI requests per detected question | 0 |
| NFR-4 | Browser memory for a 60-min session | < 300 MB tab |
| NFR-5 | Local storage per 60-min session (text only) | < 2 MB |
| NFR-6 | WebSocket reconnect after drop | Resume per ARCHITECTURE §6.3 within 5 s on a healthy network; no duplicate or reordered finals |
| NFR-7 | Spending | $0 by default. Server-enforced per-session, daily spend, and free-tier quota limits that survive reconnects and restarts, with conservative reservations when usage is unknown (ARCHITECTURE §11.1). Provider budget alerts are not treated as hard caps. |
| NFR-8 | Security | No API key in client bundle; all inputs validated; see SECURITY_PRIVACY.md |
| NFR-9 | Accessibility | Keyboard operable; WCAG AA contrast; resizable text |
| NFR-10 | Browsers | Latest Chrome and Edge (P0); Firefox/Safari best-effort with documented limits |
| NFR-11 | Authentication | Caller authentication required before any real cloud provider (free or paid) is enabled; logout/expiry terminates active WebSockets (SECURITY_PRIVACY §3.1) |
| NFR-12 | Answer quality | Measured on the evaluation set (`eval/answer-questions.json`, 110 questions; method in docs/ANSWER_EVALUATION.md): factual accuracy, hallucination rate (target 0 on fabricated terms and experience traps), false-positive flags on genuine/unusual-but-real questions (target ≤ 5%), clarification quality, naturalness, latency |

## 5. Out of scope

- Local speech or language models (Whisper, Ollama, browser on-device speech language packs, etc.).
- Paid AI providers in the MVP (each requires an ADR; disabled by default).
- Native mobile apps.
- Multi-user accounts / cloud sync (single-user, local-first).
- Executing generated commands.
- Any feature meant to hide Metor from meeting participants or screen sharing.
