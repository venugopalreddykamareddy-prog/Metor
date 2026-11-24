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
| FR-A4 | Simulated transcription mode for development and tests (no API cost) | P0 |
| FR-A5 | Pause/resume without losing session state | P0 |
| FR-A6 | Speaker separation: at minimum "me" vs "other" when two sources are available | P2 |
| FR-A7 | Capture of meeting audio (Teams, Zoom, Meet, Webex) — see [ARCHITECTURE § 4](ARCHITECTURE.md#4-audio-capture) for platform limits | P1 (tab audio) / P2 (system audio) |

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

### 2.3 Answer formats

| Question type | Structure |
|---|---|
| Conceptual | Direct explanation → practical example → (optional) verified experience |
| Troubleshooting | Impact assessment → investigation → mitigation → root cause → recovery validation → prevention |
| Behavioral | STAR: Situation, Task, Action, Result — **only from verified stories**; otherwise say no matching story exists and offer a clearly labeled hypothetical approach |
| Coding | Problem restatement → approach → implementation → complexity → edge cases → tests |
| System design | Requirements → architecture → components → scalability → reliability → security → observability → trade-offs |

Answers should sound conversational (a brief natural opener, plain sentences, natural close), not like a textbook. STAR is never forced onto technical questions.

### 2.4 Knowledge base

| ID | Requirement | Priority |
|---|---|---|
| FR-K1 | Store multiple resumes and job descriptions; select active resume + JD per session | P1 |
| FR-K2 | Store experience items, projects, incidents, achievements, STAR stories, past questions, answer preferences | P1 |
| FR-K3 | Every item has a **provenance label**: `verified` (hands-on), `theoretical` (knowledge, no hands-on claim), `hypothetical` (illustrative only) | P1 |
| FR-K4 | AI may claim experience only from `verified` items; it must label hypotheticals as such | P1 |
| FR-K5 | Import from pasted text, `.txt`, `.md`; PDF/DOCX import is P2 (adds dependencies) | P1 |
| FR-K6 | Export and delete all data | P1 |

### 2.5 Sessions

| ID | Requirement | Priority |
|---|---|---|
| FR-S1 | Session = transcript + Q&A + metadata, stored locally in IndexedDB | P0 |
| FR-S2 | End-of-session summary (topics, questions asked, gaps to study) | P1 |
| FR-S3 | Session history list with search | P1 |
| FR-S4 | Configurable retention (e.g., delete after 7/30/90 days or never store) | P1 |

### 2.6 Practice mode (Phase 6)

- Question bank per profile and topic; random or targeted drills.
- User answers aloud; AI gives feedback on accuracy, structure, and delivery.
- Track weak topics across sessions.

### 2.7 Desktop (Phase 7)

- Electron app with a floating, resizable, always-on-top answer window.
- Window is **visible to screen capture** like any normal window (no content-protection/hiding flags).
- Authorized system audio capture per OS capabilities.

## 3. Technical coverage (prompt and question-bank scope)

**SRE / DevOps / Platform / Cloud:** SLIs, SLOs, SLAs, error budgets · incident management, RCA, on-call · Linux troubleshooting · Kubernetes, AKS, EKS, Docker concepts, Helm, ArgoCD · AWS, Azure (Front Door, Key Vault, Cosmos DB, Functions) · Datadog, Prometheus, Grafana, Splunk, OpenTelemetry · Terraform, Ansible · Azure DevOps, Jenkins, GitHub Actions, Octopus Deploy · Python, Bash · distributed systems, microservices, system design, HA, DR · payment platform reliability, PCI-compliant releases · TLS/SSL certificates · load balancing · automated remediation.

**Networking / Security:** Cisco FTD, ASA, FMC · Palo Alto, Panorama · Zscaler ZIA, ZPA · Fortinet · F5 BIG-IP LTM, GTM · BGP, OSPF, EIGRP, MPLS · Cisco Nexus, ACI · LAN/WAN, SD-WAN · Wireshark · DNS, TCP/IP · AWS and Azure networking · firewall troubleshooting · network automation · infrastructure security.

Coverage is delivered through prompt templates and a question bank, **not** hard-coded answers.

## 4. Non-functional requirements

Targets are measured engineering goals, not guarantees. They depend on network and provider latency.

| ID | Category | Target |
|---|---|---|
| NFR-1 | Partial transcript latency (speech → text on screen) | p50 < 1.0 s, p95 < 2.0 s |
| NFR-2 | Time to first answer token (question end → first token) | p50 < 1.5 s, p95 < 3.0 s |
| NFR-3 | Duplicate AI requests per detected question | 0 |
| NFR-4 | Browser memory for a 60-min session | < 300 MB tab |
| NFR-5 | Local storage per 60-min session (text only) | < 2 MB |
| NFR-6 | WebSocket reconnect after drop | Auto-retry with backoff, resume within 5 s on a healthy network |
| NFR-7 | Spending | Server-enforced per-session and daily limits (see `.env.example`) |
| NFR-8 | Security | No API key in client bundle; all inputs validated; see SECURITY_PRIVACY.md |
| NFR-9 | Accessibility | Keyboard operable; WCAG AA contrast; resizable text |
| NFR-10 | Browsers | Latest Chrome and Edge (P0); Firefox/Safari best-effort with documented limits |

## 5. Out of scope

- Local speech or language models (Whisper, Ollama, etc.).
- Native mobile apps.
- Multi-user accounts / cloud sync (single-user, local-first).
- Executing generated commands.
- Any feature intended to conceal the app from meeting participants or screen sharing.
