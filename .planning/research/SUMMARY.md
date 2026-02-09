# Project Research Summary

**Project:** Taylor Atkinson Mortgage Document Collection Automation
**Domain:** Webhook-driven mortgage automation with multi-API integration
**Researched:** 2026-02-09
**Confidence:** HIGH

## Executive Summary

This project automates the document collection workflow for a Canadian mortgage broker by intercepting Finmo application submissions, generating personalized document checklists, monitoring document arrival via email, classifying and filing documents to Google Drive, and tracking completion status in MyBrokerPro CRM. The recommended approach uses Node.js with TypeScript, BullMQ queue architecture for webhook processing, and human-in-the-loop draft review to ensure compliance and quality.

Industry research confirms this is a well-trodden problem space. The mortgage automation market heavily emphasizes document classification via OCR/AI (table stakes in 2026), idempotent webhook processing (critical for reliability), and async processing patterns to avoid timeout failures. The Canadian mortgage context adds PIPEDA compliance requirements for PII handling in logs and storage.

The primary risks are webhook reliability issues (duplicates, ordering, timeouts), API rate limit cascading failures, and document classification errors causing misfiling. These are mitigated through Phase 1 architectural decisions: idempotency via unique job IDs, immediate HTTP 202 acknowledgment with background queue processing, structured logging with PII redaction, and Cat review of all automated actions before execution. The roadmap should prioritize foundational reliability (webhook receiver, queue infrastructure, idempotency) before building feature complexity.

## Key Findings

### Recommended Stack

Research validated Node.js with TypeScript as the optimal choice for this integration-heavy workflow. The GoHighLevel SDK, Google APIs client, and BullMQ queue system all have first-class Node.js support with mature ecosystems. TypeScript 5.9.x provides type safety for external API schemas, critical when dealing with Finmo webhooks, CRM custom fields, and Gmail/Drive responses.

**Core technologies:**
- **Node.js 20.x LTS + TypeScript 5.9.x**: Runtime with native .env support, current LTS stability, excellent SDK compatibility for GoHighLevel/Google APIs
- **Express 5.2.x**: HTTP server for webhook receiver — mature, simple API, sufficient performance for expected scale (10-50 webhooks/day)
- **BullMQ 5.67.x + Redis 6.x/7.x**: Job queue for async webhook processing — provides exactly-once semantics via job IDs, exponential backoff retries, dead-letter queue for failed jobs, and scheduled cron jobs for Gmail monitoring and reminders
- **googleapis 171.x + nodemailer 6.x**: Gmail/Drive integration with OAuth2 support — official Google client for service accounts, send emails via Gmail API (not SMTP) for tracking
- **Zod 3.x**: Runtime validation for webhook payloads and environment variables — TypeScript-first, zero dependencies, critical for external data safety
- **Pino 9.x**: Structured JSON logging with PII redaction — 5x faster than Winston, essential for PIPEDA compliance

**Infrastructure recommendation:** Railway or Render for managed VPS with Redis addon (~$20-50/month for MVP scale). PostgreSQL optional for Phase 1 (CRM may suffice as primary datastore), required for Phase 2+ if audit logs or advanced tracking needed.

### Expected Features

Mortgage document automation in 2026 has clear table stakes. Personalized checklist generation based on borrower type is universal (Finmo, Lendesk, Floify all provide this). Real-time tracking dashboards and automated reminders are expected by 86% of borrowers. Document classification via OCR/AI is now baseline per Gartner benchmarks.

**Must have (table stakes):**
- Personalized document checklist generation from Finmo application data (employment type, property type, residency status)
- Secure document upload ingestion (email monitoring + Finmo portal integration)
- Document classification by type (T4, pay stub, bank statement, etc.) using OCR + rule-based AI
- Automated file naming with consistent convention + automated file organization to Google Drive
- Real-time tracking dashboard (received/missing status synced to MyBrokerPro CRM)
- Centralized storage (Google Drive as single source of truth)
- Audit trail (who uploaded/accessed/modified what and when for compliance)

**Should have (competitive):**
- Intelligent document validation (OCR extracts data, validates consistency across documents, flags mismatches) — reduces lender back-and-forth by 34%
- Context-aware follow-ups (reference specific missing docs in reminders, not generic "you have missing documents")
- Multi-format auto-conversion (HEIC/JPEG/Word → PDF before filing)
- Document completeness score (gamification to motivate faster client completion)
- Proactive document health check (flag expiring documents like 30-day-old pay stubs before lender submission)

**Defer (v2+):**
- Cross-document validation (consistency checking across multiple docs like address on DL vs bank statement)
- Batch upload with auto-split (one multi-page PDF → system splits and classifies each document separately)
- Bank statement retrieval integration (Flinks/Plaid one-click pull) — Finmo may already provide this, verify before building
- Lender-specific checklist customization (adapt required docs based on intended lender)
- Advanced OCR data extraction (parse amounts, dates, names for pre-filling CRM fields)

### Architecture Approach

The recommended architecture follows industry-standard webhook-driven event patterns with async processing. Webhook receiver returns HTTP 202 immediately (never blocks on processing), enqueues payload to BullMQ with event ID as job ID for automatic deduplication, and background workers handle multi-step processing (checklist generation, document classification, CRM updates, email sending). This decouples ingestion reliability from processing complexity and prevents cascade failures when external APIs are slow or rate-limited.

**Major components:**
1. **Webhook Receiver (Express.js)** — Validates Finmo signature, returns 202 within 5s, enqueues payload. Zero business logic, just ingestion.
2. **Queue Layer (BullMQ + Redis)** — Three queues (checklist, document, reminder) with exponential backoff retry (7 attempts max), dead-letter queue for manual review, and scheduled jobs for Gmail polling/reminders.
3. **Worker Processes** — Checklist worker applies DOC_CHECKLIST_RULES_V2 logic, generates personalized email, creates draft for Cat's review. Document worker classifies PDFs via OCR, renames/files to Drive, updates tracking. Reminder worker finds clients with missing PRE docs, generates context-aware follow-up drafts.
4. **Integration Layer** — API clients for Finmo, GoHighLevel, Gmail, Drive with circuit breakers (pause after 5 failures), exponential backoff retries, and rate limit monitoring. Each client handles auth/refresh independently.
5. **Human-in-the-Loop Review** — All generated emails saved as drafts in database (status: pending_review), CRM task created for Cat, approval triggers send. No auto-send to clients without review per CLAUDE.md requirements.

**Key patterns:** Immediate acknowledgment + async processing, idempotency via unique job IDs + database constraints, exponential backoff with dead-letter queue, human-in-the-loop for all client communications, structured logging with PII redaction.

### Critical Pitfalls

Research identified 9 critical pitfalls based on webhook system failures, mortgage automation implementations, and API integration patterns. The top 5 must be addressed in Phase 1 architecture; failure to prevent these causes production outages and data integrity issues.

1. **Webhook duplicate processing without idempotency** — Finmo retries webhooks on timeout (standard "at least once" delivery), causing duplicate emails/folders/records. Prevent: use event_id as BullMQ job ID (auto-dedup), store processed webhook IDs in DB with unique constraint, return 202 immediately to avoid timeouts. Address in Phase 1 foundation.

2. **Webhook event ordering assumption** — Network latency causes out-of-order delivery (e.g., "document uploaded" arrives before "application submitted"). Prevent: design state machine with valid transitions only, fetch current state from source API before processing, reject invalid transitions gracefully. Address in Phase 1 foundation.

3. **API rate limit cascading failures** — Single webhook triggers 10+ API calls (Gmail, Drive, CRM), hits rate limits during peak times. GoHighLevel: 100 req/10s, Gmail/Drive: per-user quotas. Prevent: exponential backoff with jitter, circuit breaker (pause after 5 failures), queue-based rate limiting, monitor X-RateLimit-Remaining headers. Address basics in Phase 1, full circuit breaker in Phase 2.

4. **PII exposure in logs and error messages** — Mortgage webhooks contain SIN numbers, income, addresses. Logging full payloads violates PIPEDA. Prevent: redact PII before logging, log metadata only (IDs, doc types, timestamps), structured logging with explicit allow-list, never log sensitive fields. Address in Phase 1 foundation (mandatory for compliance).

5. **Synchronous webhook processing causing timeouts** — Processing takes 15s (generate checklist + create folder + send email + update CRM), provider timeout is 10s, triggers retries and duplicates. Prevent: async processing with message queue, webhook endpoint returns 200 in <5s, workers handle slow operations. Address in Phase 1 foundation (cannot retrofit easily).

## Implications for Roadmap

Based on combined research, the roadmap should prioritize foundational reliability and compliance before feature complexity. Webhook infrastructure, idempotency, and PII handling are non-negotiable Phase 1 requirements. Document classification can start simple (staging area for Cat's review) and evolve to AI-assisted in later phases. The dependency chain is clear: foundation → checklist generation → CRM integration → email sending → document classification → reminders.

### Phase 1: Foundation + Checklist Generation (Weeks 1-3)
**Rationale:** Establishes reliability patterns that are impossible to retrofit. Webhook receiver with idempotency, async queue processing, PII-safe logging, and database schema must be designed correctly from day one. Checklist generation is the first business value — automates Cat's current manual process of creating doc request emails.

**Delivers:** Finmo webhook receiver (202 ack, signature validation, idempotency), BullMQ queue infrastructure with Redis, checklist rule engine (applies DOC_CHECKLIST_RULES_V2 logic), personalized email template generation, draft storage in database for Cat's review.

**Addresses features:**
- Personalized checklist generation (table stakes)
- Audit trail (database records all webhook processing)
- Centralized storage foundation (DB schema for applications, checklists, drafts)

**Avoids pitfalls:**
- Webhook duplicate processing (event_id as job ID + DB unique constraint)
- Synchronous processing timeouts (202 immediate return, queue-based async)
- PII exposure (structured logging with redaction, metadata-only logs)
- Webhook ordering issues (state machine validates transitions)

**Research flag:** Standard patterns, skip deeper research. Well-documented webhook + queue architecture.

### Phase 2: CRM Integration + Email Sending (Weeks 3-5)
**Rationale:** Completes the checklist workflow end-to-end. Cat reviews draft in CRM, approves, email sent to client. Requires OAuth setup for Gmail API (service account or user delegation), GoHighLevel API client with task creation, and approval workflow.

**Delivers:** GoHighLevel API client (OAuth, contacts, tasks, custom fields), CRM task creation on draft generation, Gmail API client (OAuth2, send email), draft approval API/webhook, email queue + worker, status tracking in CRM custom fields.

**Uses stack:**
- @gohighlevel/api-client (V2 SDK, OAuth token management)
- googleapis + nodemailer (Gmail send via API, not SMTP)
- OAuth2 token refresh logic (proactive 50-min refresh for 60-min token)

**Implements architecture:**
- Human-in-the-loop review (draft → CRM task → approval → send)
- Integration layer API clients (auth, retry, rate limiting)

**Avoids pitfalls:**
- OAuth token refresh failure (proactive refresh, store new tokens, monitor health)
- API rate limits (basic exponential backoff, monitor headers)
- Missing kill switch (environment variable AUTOMATION_ENABLED=true/false)

**Research flag:** GoHighLevel SDK version and OAuth flows may need validation. Gmail OAuth scopes and delegation setup needs testing.

### Phase 3: Document Classification + Filing (Weeks 5-7)
**Rationale:** Automates Cat's current manual work of downloading, renaming, converting, and filing docs to Drive. Classification can start simple (staging area, Cat reviews) and improve over time with AI. Requires Gmail monitoring (polling or Pub/Sub), PDF parsing, Drive folder structure setup.

**Delivers:** Gmail monitor (scheduled BullMQ job polls every 5-10 min), attachment extraction and validation (PDF/JPEG/PNG only, reject others gracefully), document classifier (rule-based or AI with confidence scoring), Google Drive client (upload, folder hierarchy), tracking service (mark docs received, update checklist status in CRM), notification to Taylor when PRE docs complete.

**Addresses features:**
- Document classification by type (table stakes)
- Automated file naming + organization (differentiator, saves Cat hours)
- Real-time tracking (update CRM custom fields on doc receipt)
- Multi-format auto-conversion (HEIC/Word → PDF before filing)

**Avoids pitfalls:**
- Document classification based on filename alone (staging area for Cat review in v1, AI confidence scores in v2)
- Email attachment parsing assumes PDF (validate format, reject gracefully, alert Cat)
- Multi-page PDF handling (detect 10+ pages, alert Cat for review)

**Research flag:** PDF parsing libraries (pdf-parse vs pdfjs-dist vs unpdf) need performance testing. AI classification approach (rule-based vs OpenAI/Claude API) depends on existing mortgage.ai code availability.

### Phase 4: Automated Reminders (Weeks 7-8, OPTIONAL for MVP)
**Rationale:** Adds follow-up automation for clients with missing docs. Built but disabled initially per CLAUDE.md ("human-in-loop by default"). Cat manually enables after trust established. Requires scheduled jobs, missing docs query logic, reminder template personalization.

**Delivers:** Reminder scheduler (BullMQ repeatable job, daily at 9am Toronto time), missing docs detection (query clients awaiting docs, prioritize PRE vs FULL), context-aware reminder template (references specific missing docs), draft creation for Cat's batch review.

**Addresses features:**
- Automated reminders (table stakes)
- Context-aware follow-ups (differentiator)
- Document completeness score (gamification, optional enhancement)

**Implements architecture:**
- Scheduled jobs with cron expressions
- Reminder worker (same draft review pattern as checklist)

**Avoids pitfalls:**
- No kill switch (already built in Phase 2, test here with high-volume scenario)
- UX pitfall: overwhelming Cat with notifications (batch reminders, only notify on review needed)

**Research flag:** Skip research, standard scheduled job pattern.

### Phase 5: Monitoring + Reliability Enhancements (Week 8+, Post-MVP)
**Rationale:** Production hardening based on real usage patterns. Add circuit breakers, dead-letter queue monitoring, error notifications to Cat, admin UI for manual overrides.

**Delivers:** Circuit breaker pattern for API clients (pause after 5 failures, auto-recover), DLQ monitoring and alert (email Cat if >5 jobs in DLQ), user-facing error notifications (Cat receives email on automation failure), admin UI for manual triggers (retry failed webhook, send doc request now), queue depth monitoring (alert if backlog grows).

**Uses stack:**
- opossum library (circuit breaker)
- Better Stack or Datadog (centralized logging + alerting)

**Avoids pitfalls:**
- API rate limit cascading (circuit breaker prevents thundering herd)
- Silent automation failures (Cat notified within 5 min)
- No manual override (admin UI provides retry/cancel buttons)

**Research flag:** Circuit breaker implementation and DLQ patterns are well-documented, skip research.

### Phase Ordering Rationale

- **Foundation first (Phase 1):** Idempotency, async processing, PII handling are impossible to retrofit cleanly. Must be built correctly from start.
- **End-to-end value second (Phases 2-3):** Complete checklist workflow (generate → review → send) delivers immediate ROI before adding document classification complexity.
- **Classification deferred to Phase 3:** Allows Phase 1-2 to deliver value while Cat continues manual doc filing. Classification can start simple (staging area) and improve iteratively.
- **Reminders optional (Phase 4):** Disabled initially per CLAUDE.md, enables only after trust established. Can be skipped for MVP launch.
- **Reliability enhancements post-MVP (Phase 5):** Production hardening based on real failure modes, not speculative engineering.

**Dependency graph validates ordering:**
```
Phase 1 (Foundation) → Phase 2 (CRM + Email) → Phase 3 (Docs) → Phase 4 (Reminders)
                                                                   ↓
                                          Phase 5 (Monitoring) ←──┘
```

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (CRM Integration):** GoHighLevel SDK version, OAuth flows, custom field schema need API documentation review. Finmo webhook signature validation algorithm needs official docs.
- **Phase 3 (Document Classification):** PDF parsing library performance testing with real mortgage docs needed. AI classification approach depends on existing mortgage.ai code availability (ask Taylor/Cat).

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Webhook + queue architecture is well-documented industry pattern. BullMQ docs comprehensive.
- **Phase 4 (Reminders):** Scheduled jobs with BullMQ repeatable pattern is standard.
- **Phase 5 (Monitoring):** Circuit breaker and DLQ monitoring patterns are mature.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified via npm (Feb 2026). Node.js + TypeScript is clear choice for GoHighLevel/Google API integration. BullMQ is industry standard for Node.js queues. |
| Features | MEDIUM | Feature expectations validated via mortgage automation vendors (Finmo, Lendesk, Floify) and industry research. No direct Finmo feature documentation reviewed, inferred from competitive analysis. |
| Architecture | HIGH | Webhook patterns, async processing, idempotency, human-in-loop are verified via 2026 sources and official BullMQ/webhook provider docs. Project structure matches Node.js best practices. |
| Pitfalls | MEDIUM | Webhook reliability, rate limits, OAuth failures validated via official API docs (Google, GoHighLevel) and webhook provider guides. Mortgage-specific pitfalls (doc classification, PII handling) based on industry sources, not Taylor's specific workflow. |

**Overall confidence:** HIGH for technical implementation patterns, MEDIUM for mortgage domain specifics.

### Gaps to Address

Research was comprehensive for technical architecture but has gaps in domain-specific workflows that need validation during planning:

- **Finmo webhook schema and signature validation:** Research confirms webhooks exist but exact payload structure, signature algorithm (HMAC-SHA256?), and retry behavior not documented. Requires Finmo API documentation review or trial account testing during Phase 1.
- **MyBrokerPro custom field schema:** GoHighLevel API V2 supports custom fields, but MyBrokerPro white-label may have pre-configured schema. Need Cat/Taylor to share current custom fields list and pipeline structure before Phase 2.
- **DOC_CHECKLIST_RULES_V2 implementation:** Rules documented in project files, but edge cases (e.g., multiple employment types, mixed residency) may emerge during testing. Plan for rule refinement iteration with Cat in Phase 1.
- **Google Drive folder structure:** Research assumes `/Mortgage Clients/{clientName}/{docType}/` but Taylor's actual structure needs confirmation (CLAUDE.md lists this as open question). Get screenshot/example before Phase 3.
- **Existing mortgage.ai classification code:** Feature research assumes AI classification needed, but Taylor may have existing code from previous projects. Ask before building new classifier in Phase 3.
- **OAuth delegation setup:** Gmail/Drive API can use service account with domain-wide delegation OR user OAuth for dev@venturemortgages.com. Need to confirm Workspace admin access and preferred approach before Phase 2.

## Sources

### Primary (HIGH confidence)
- [googleapis npm v171.4.0](https://www.npmjs.com/package/googleapis) — Verified Feb 2026, official Google Node.js client
- [BullMQ npm v5.67.3](https://www.npmjs.com/package/bullmq) — Verified Feb 2026, official queue library
- [BullMQ Official Docs](https://docs.bullmq.io) — Retry, scheduling, DLQ patterns
- [Express.js v5.2.1 release](https://www.npmjs.com/package/express) — Current stable version
- [TypeScript 5.9.x release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html) — Official Microsoft docs
- [GoHighLevel API Documentation](https://marketplace.gohighlevel.com/docs/oauth/Faqs/index.html) — OAuth, rate limits, webhooks
- [Gmail API Usage Limits](https://developers.google.com/workspace/gmail/api/reference/quota) — Official quota documentation
- [Google Drive API Limits](https://developers.google.com/workspace/drive/api/guides/limits) — Official rate limit docs
- [Using OAuth 2.0 for Google APIs](https://developers.google.com/identity/protocols/oauth2) — Token refresh, delegation
- [PIPEDA Requirements](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/) — Canadian privacy compliance

### Secondary (MEDIUM confidence)
- [Webhook Reliability Tricks for Idempotency](https://medium.com/@kaushalsinh73/top-7-webhook-reliability-tricks-for-idempotency-a098f3ef5809) — Industry patterns
- [Webhooks at Scale: Idempotent System Design](https://dev.to/art_light/webhooks-at-scale-designing-an-idempotent-replay-safe-and-observable-webhook-system-7lk) — Architecture patterns
- [Why You Can't Guarantee Webhook Ordering](https://www.svix.com/blog/guaranteeing-webhook-ordering/) — Event ordering pitfalls
- [Mortgage Document Automation Guide 2026](https://www.infrrd.ai/blog/mortgage-document-automation-guide) — Industry feature expectations
- [Perfect Canadian Mortgage Broker Tech Stack](https://www.lendesk.com/blog/perfect-broker-tech-stack) — Competitor analysis
- [Railway vs Render Comparison 2026](https://northflank.com/blog/railway-vs-render) — Hosting options
- [Pino vs Winston Performance](https://betterstack.com/community/comparisons/pino-vs-winston/) — Logging library comparison
- [Document Classification with OCR & AI](https://www.opsflowhq.com/newsletter-issues/how-to-classify-mortgage-documents-using-ocr-ai) — Classification patterns
- [Human-in-the-Loop AI Workflows](https://orkes.io/blog/human-in-the-loop/) — Review queue patterns
- [API Rate Limiting 2026 Guide](https://www.levo.ai/resources/blogs/api-rate-limiting-guide-2026) — Rate limit handling

### Tertiary (LOW confidence, needs validation)
- [5 Best Document Automation Tools for Mortgage Brokers](https://www.usecollect.com/blog/5-best-document-automation-tools-for-mortgage-brokers) — Feature benchmarking, vendor claims
- [The Future of Mortgage Automation 2026](https://www.docvu.ai/the-future-of-mortgage-automation-how-intelligent-document-processing-is-transforming-2026/) — Industry trends, marketing content
- [Building Webhook Systems with NestJS](https://dev.to/juan_castillo/building-a-webhook-systems-with-nestjs-handling-retry-security-dead-letter-queues-and-rate-4nm7) — Implementation examples, different framework

---
*Research completed: 2026-02-09*
*Ready for roadmap: yes*
