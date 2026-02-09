# Requirements: Venture Mortgages Doc Automation

**Defined:** 2026-02-09
**Core Value:** When a Finmo application comes in, the right documents get requested, tracked, filed, and followed up on — with minimal human effort and zero missed items.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Infrastructure

- [ ] **INFRA-01**: System receives Finmo "application submitted" webhook and returns HTTP 202 immediately
- [ ] **INFRA-02**: Webhook payloads are enqueued to BullMQ for async processing with idempotency (no duplicate processing)
- [ ] **INFRA-03**: Failed jobs retry with exponential backoff and land in dead-letter queue for manual review
- [ ] **INFRA-04**: All logging is PII-safe (no SIN numbers, income amounts, or addresses in logs — metadata only)
- [ ] **INFRA-05**: OAuth tokens for Gmail and Google Drive auto-refresh and alert on failure
- [ ] **INFRA-06**: Global kill switch to disable all automation via environment variable
- [ ] **INFRA-07**: System deploys to Railway or Render VPS with Redis for BullMQ

### Checklist Generation

- [ ] **CHKL-01**: System reads Finmo application fields (employment type, property type, deal type, down payment source, residency status, co-borrower) and generates personalized doc checklist
- [ ] **CHKL-02**: Checklist rules match DOC_CHECKLIST_RULES_V2.md exactly (Cat-approved, 17 sections)
- [ ] **CHKL-03**: All docs (PRE + FULL) are requested upfront in initial email; PRE/FULL tags are tracked internally only
- [ ] **CHKL-04**: Co-borrower applications generate duplicate doc requests for second applicant
- [ ] **CHKL-05**: Checklist excludes items Cat removed (e.g., signed credit consent auto-sent by Finmo, T2125 inside T1 package, bonus payment history if T4s+LOE collected)
- [ ] **CHKL-06**: Gift letter is flagged internally but NOT requested upfront (collected later when lender is picked)

### CRM Integration

- [ ] **CRM-01**: System creates/updates contact in MyBrokerPro (GoHighLevel) from Finmo application data
- [ ] **CRM-02**: System creates draft task in MyBrokerPro for Cat to review generated doc request email
- [ ] **CRM-03**: Checklist status (received/missing per doc) is tracked in MyBrokerPro custom fields
- [ ] **CRM-04**: System respects existing MyBrokerPro setup (pipelines, fields Cat/Taylor already configured) — no duplicate structures
- [ ] **CRM-05**: PRE-readiness notification: when all PRE docs are received, system notifies Taylor via CRM task

### Email

- [ ] **EMAIL-01**: System generates personalized doc request email using checklist output
- [ ] **EMAIL-02**: Email is created as draft for Cat to review before sending (human-in-the-loop)
- [ ] **EMAIL-03**: Emails send from admin@venturemortgages.com via Gmail API
- [ ] **EMAIL-04**: Email template is professional, clear, and lists required docs with brief explanations

### Document Intake

- [ ] **INTAKE-01**: System monitors docs@venturemortgages.co inbox for forwarded client doc emails from Cat
- [ ] **INTAKE-02**: System detects when client uploads documents through Finmo portal (via Finmo webhook/API)
- [ ] **INTAKE-03**: System extracts attachments from emails (PDF, images, Word docs)
- [ ] **INTAKE-04**: Non-PDF documents are auto-converted to PDF

### Document Classification & Filing

- [ ] **FILE-01**: System classifies received documents by type (pay stub, T4, NOA, LOE, etc.)
- [ ] **FILE-02**: System renames documents using Cat's existing naming convention
- [ ] **FILE-03**: System files documents to correct client folder/subfolder in Google Drive
- [ ] **FILE-04**: System handles re-uploads (document versioning — new version replaces or sits alongside old)
- [ ] **FILE-05**: Classification confidence below threshold routes doc to Cat for manual review

### Tracking

- [ ] **TRACK-01**: System updates MyBrokerPro checklist status when a document is received and filed
- [ ] **TRACK-02**: System maintains audit trail (who uploaded/accessed what, when) for compliance
- [ ] **TRACK-03**: Cat can view per-client doc status in MyBrokerPro dashboard (received/missing/pending review)

### Reminders

- [ ] **REMIND-01**: System has scheduled reminder infrastructure for missing documents (e.g., 3 days, 7 days after initial request)
- [ ] **REMIND-02**: Reminders are context-aware — reference specific missing documents by name
- [ ] **REMIND-03**: Reminders are disabled by default (global toggle + per-client toggle)
- [ ] **REMIND-04**: When enabled, reminder emails are drafted for Cat to review before sending

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Document Validation

- **VALID-01**: System extracts data from documents (amounts, dates, names) via OCR
- **VALID-02**: System validates consistency across documents (income on pay stub vs T4)
- **VALID-03**: System flags potential issues for broker review (e.g., tax amount owing on NOA)

### Advanced Classification

- **CLASS-01**: Batch upload with auto-split (one multi-page PDF split into individual docs)
- **CLASS-02**: Proactive document health check (flag docs expiring soon, e.g., pay stub >30 days)

### Client Experience

- **CLIENT-01**: Document completeness score visible to client ("Your application is 75% complete")
- **CLIENT-02**: Mobile-optimized document upload portal

### Lender-Specific

- **LENDER-01**: Checklist adapts when specific lender is selected (different lenders need different docs)
- **LENDER-02**: Bank statement retrieval integration (Flinks/Plaid)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Auto-send emails without Cat review | Compliance risk — human-in-the-loop required |
| Auto-submit to lenders | Broker judgment required — too risky to automate |
| Store PII in logs | PIPEDA compliance — metadata only |
| Build in GHL visual workflow builder | Client wants custom code via API |
| WhatsApp/text doc intake | Not used by clients currently — email + Finmo only |
| Lender submission automation | Downstream of doc collection — future scope |
| Budget call scheduling | Taylor handles manually |
| Client-facing portal | Finmo already handles client-facing interactions |
| Cross-document validation | High complexity — defer to v2 |
| First-time buyer declaration docs | Cat marked as "not necessary" |
| Payout statement (refi) | Handled by lawyers, not broker |
| Status certificate / Strata Form B | Handled by lawyers, not broker |
| Appraisal ordering | Only after approval, lender-ordered |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| INFRA-03 | Phase 1 | Pending |
| INFRA-04 | Phase 1 | Pending |
| INFRA-05 | Phase 5 | Pending |
| INFRA-06 | Phase 1 | Pending |
| INFRA-07 | Phase 1 | Pending |
| CHKL-01 | Phase 3 | Pending |
| CHKL-02 | Phase 3 | Pending |
| CHKL-03 | Phase 3 | Pending |
| CHKL-04 | Phase 3 | Pending |
| CHKL-05 | Phase 3 | Pending |
| CHKL-06 | Phase 3 | Pending |
| CRM-01 | Phase 4 | Pending |
| CRM-02 | Phase 4 | Pending |
| CRM-03 | Phase 4 | Pending |
| CRM-04 | Phase 2 | Pending |
| CRM-05 | Phase 4 | Pending |
| EMAIL-01 | Phase 5 | Pending |
| EMAIL-02 | Phase 5 | Pending |
| EMAIL-03 | Phase 5 | Pending |
| EMAIL-04 | Phase 5 | Pending |
| INTAKE-01 | Phase 6 | Pending |
| INTAKE-02 | Phase 6 | Pending |
| INTAKE-03 | Phase 6 | Pending |
| INTAKE-04 | Phase 6 | Pending |
| FILE-01 | Phase 7 | Pending |
| FILE-02 | Phase 7 | Pending |
| FILE-03 | Phase 7 | Pending |
| FILE-04 | Phase 7 | Pending |
| FILE-05 | Phase 7 | Pending |
| TRACK-01 | Phase 8 | Pending |
| TRACK-02 | Phase 8 | Pending |
| TRACK-03 | Phase 8 | Pending |
| REMIND-01 | Phase 9 | Pending |
| REMIND-02 | Phase 9 | Pending |
| REMIND-03 | Phase 9 | Pending |
| REMIND-04 | Phase 9 | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0

---
*Requirements defined: 2026-02-09*
*Last updated: 2026-02-09 after roadmap creation*
