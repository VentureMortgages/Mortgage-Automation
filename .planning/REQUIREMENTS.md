# Requirements: Venture Mortgages Doc Automation

**Defined:** 2026-02-09
**Core Value:** When a Finmo application comes in, the right documents get requested, tracked, filed, and followed up on -- with minimal human effort and zero missed items.

## v1.0 Requirements (Validated)

All v1.0 requirements shipped and validated. See MILESTONES.md for details.

### Infrastructure (Phases 1, 5)

- [x] **INFRA-01**: System receives Finmo "application submitted" webhook and returns HTTP 202 immediately
- [x] **INFRA-02**: Webhook payloads are enqueued to BullMQ for async processing with idempotency
- [x] **INFRA-03**: Failed jobs retry with exponential backoff and land in dead-letter queue
- [x] **INFRA-04**: All logging is PII-safe (no SIN numbers, income amounts, or addresses)
- [x] **INFRA-05**: OAuth tokens for Gmail and Google Drive auto-refresh and alert on failure
- [x] **INFRA-06**: Global kill switch to disable all automation via environment variable
- [x] **INFRA-07**: System deploys to Railway with Redis for BullMQ

### Checklist Generation (Phase 3)

- [x] **CHKL-01**: Personalized doc checklist generated from Finmo application data
- [x] **CHKL-02**: Rules match DOC_CHECKLIST_RULES_V2.md exactly (103 rules, 17 sections)
- [x] **CHKL-03**: All docs (PRE + FULL) requested upfront; PRE/FULL tracked internally
- [x] **CHKL-04**: Co-borrower applications generate duplicate doc requests
- [x] **CHKL-05**: Excludes Cat-removed items (credit consent, T2125, bonus history)
- [x] **CHKL-06**: Gift letter flagged internally but not requested upfront

### CRM Integration (Phases 2, 4)

- [x] **CRM-01**: Contact created/updated in MBP from Finmo application data
- [x] **CRM-02**: Draft review task created in MBP for Cat
- [x] **CRM-03**: Checklist status tracked in MBP custom fields
- [x] **CRM-04**: Respects existing MBP setup (no duplicate structures)
- [x] **CRM-05**: PRE-readiness notification via CRM task

### Email (Phase 5)

- [x] **EMAIL-01**: Personalized doc request email from checklist
- [x] **EMAIL-02**: Created as draft for Cat to review
- [x] **EMAIL-03**: Sends from admin@venturemortgages.com via Gmail API
- [x] **EMAIL-04**: Professional template with doc explanations

### Document Intake (Phase 6)

- [x] **INTAKE-01**: Monitors docs@venturemortgages.com for forwarded client emails
- [x] **INTAKE-02**: Detects Finmo portal uploads via API
- [x] **INTAKE-03**: Extracts attachments from emails (PDF, images, Word)
- [x] **INTAKE-04**: Non-PDF documents auto-converted to PDF

### Classification & Filing (Phase 7)

- [x] **FILE-01**: Classifies documents by type (pay stub, T4, NOA, etc.)
- [x] **FILE-02**: Renames using Cat's naming convention
- [x] **FILE-03**: Files to correct client folder/subfolder in Google Drive
- [x] **FILE-04**: Handles re-uploads (versioning)
- [x] **FILE-05**: Low confidence routes to Cat for manual review

### Tracking (Phase 8)

- [x] **TRACK-01**: MBP checklist status updates when doc received and filed
- [x] **TRACK-02**: Audit trail (who uploaded what, when)
- [x] **TRACK-03**: Per-client doc status in MBP

### Opportunity-Centric (Phase 10)

- [x] **OPP-01**: Finds Finmo's existing opportunity by deal ID
- [x] **OPP-02**: Doc tracking on opportunity, not contact
- [x] **OPP-03**: Independent checklists per deal
- [x] **OPP-04**: Reusable docs applied across deals
- [x] **OPP-05**: Property-specific docs not reused across deals
- [x] **OPP-06**: Pipeline stage advances per-opportunity
- [x] **OPP-07**: Contact-level doc tracking deprecated
- [x] **OPP-08**: Backward compatible for single-deal clients

### Drive Folder Linking (Phase 11)

- [x] **DRIVE-01**: Client folder ID stored on CRM contact
- [x] **DRIVE-02**: Classification reads folder ID from CRM before filing
- [x] **DRIVE-03**: Deal subfolder created per Finmo application
- [x] **DRIVE-04**: Reusable docs filed at client folder level
- [x] **DRIVE-05**: Deal-specific docs filed in deal subfolder
- [x] **DRIVE-06**: Scanner checks both client and deal folders
- [x] **DRIVE-07**: Fallback to DRIVE_ROOT_FOLDER_ID

## v1.1 Requirements

Requirements for milestone v1.1 -- Production Hardening. Each maps to roadmap phases 12-16.

### CRM Pipeline (Phase 12)

- [x] **PIPE-01**: System creates only one "Review checklist" task per Finmo application, even though Finmo creates 2 MBP opportunities (Leads + Live Deals)
- [x] **PIPE-02**: When checklist email draft is created, opportunity automatically moves from "In Progress" to "Collecting Documents"
- [x] **PIPE-03**: When opportunity moves to "Collecting Documents", the "Review checklist" task is automatically marked completed
- [x] **PIPE-04**: When Finmo app includes a realtor, the realtor contact in MBP is assigned the correct contact type

### Timing & Sync (Phase 13)

- [x] **SYNC-01**: If MBP opportunity doesn't exist when webhook fires, system retries CRM sync at increasing intervals (5/10/20 min) until opportunity appears
- [x] **SYNC-02**: Documents uploaded before MBP opportunity exists are filed to Drive immediately; CRM tracking is retried when opportunity becomes available
- [x] **SYNC-03**: Research whether Finmo "update external system" API can trigger MBP sync on demand (eliminates delay)

### Folder Matching (Phase 14)

- [x] **FOLD-01**: Client folder resolution uses CRM contact ID -> stored Drive folder URL as primary method (not name matching)
- [x] **FOLD-02**: When CRM lookup fails, fallback matching uses email address or phone number in addition to name
- [x] **FOLD-03**: Multi-borrower folders are owned by the primary borrower -- co-borrower docs route through primary borrower's CRM contact
- [x] **FOLD-04**: Doc subfolders (Income/, Property/, Down Payment/, etc.) are pre-created when the client folder is first set up
- [x] **FOLD-05**: Interactive backfill script matches existing CRM contacts to their Drive folders (human confirms each match before storing)

### Original Preservation (Phase 15)

- [x] **ORIG-01**: Every received document is stored in `ClientFolder/Originals/` with its original filename before classification
- [x] **ORIG-02**: Low-confidence documents are preserved in Originals (not deleted from temp storage)
- [x] **ORIG-03**: When a document is re-uploaded, new original is stored alongside previous versions (no overwrite in Originals)

### Reminders (Phase 16)

- [x] **REMIND-01**: When docs are outstanding for 3+ days, a CRM task is created for Cat listing missing documents with a draft follow-up email to copy/paste
- [x] **REMIND-02**: Cat receives an email notification: Subject "Follow up: Need docs - [Client Name]", Body includes client details and draft follow-up email text
- [x] **REMIND-03**: Reminder task refreshes every 3 days if docs are still missing (updated task, not duplicates)
- [x] **REMIND-04**: Reminders stop automatically when all required docs are received

## v1.2 Requirements

Requirements for milestone v1.2 -- Production Go-Live. Deploy, verify, and hand off to Cat.

### Deploy & Configure

- [ ] **DEPLOY-01**: Latest code deployed to Railway from GitHub (T1 fix + battle-test endpoint)
- [ ] **DEPLOY-02**: Railway env vars verified -- APP_ENV=production, CAT_EMAIL set, all services connected
- [ ] **DEPLOY-03**: Health endpoint returns OK, kill switch OFF, Gmail poller actively running

### Battle Testing -- Intake Pipeline

- [ ] **BTEST-01**: Forward a doc to docs@ -> classified with correct type, borrower name, year
- [ ] **BTEST-02**: Matched to correct CRM contact by borrower name extracted from PDF
- [ ] **BTEST-03**: Filed to correct client Drive folder/subfolder with Cat's naming convention
- [ ] **BTEST-04**: CRM doc checklist updated with received document status
- [ ] **BTEST-05**: T1 docs named "Name - T1 YYYY" (no institution/amount) -- Cat's bug report verified fixed

### Battle Testing -- Edge Cases

- [ ] **EDGE-01**: Unknown sender with extractable first+last name -> auto-created contact + Drive folder
- [ ] **EDGE-02**: Ambiguous or partial name (last name only) -> routed to Needs Review with CRM task
- [ ] **EDGE-03**: Multiple attachments in one email -> each classified and filed independently
- [ ] **EDGE-04**: Low-confidence classification -> doc in Needs Review/ folder with CRM task for Cat
- [ ] **EDGE-05**: Co-borrower doc -> matched via borrower traversal, filed to correct client folder

### Battle Testing -- Reminders

- [ ] **REMIND-05**: Manual reminder scan produces CRM tasks for stale opportunities
- [ ] **REMIND-06**: Cat email notification fires for pending doc reminders

### Data Preparation

- [ ] **DATA-01**: Backfill script links existing CRM contacts to their Drive folders
- [ ] **DATA-02**: [TEST] contacts and opportunities removed from MBP
- [ ] **DATA-03**: Stale/broken Drive folder IDs identified and corrected in CRM

### Cat Handoff

- [ ] **HANDOFF-01**: SOP for Cat -- how to forward docs, expected system behavior, Needs Review process, troubleshooting
- [ ] **HANDOFF-02**: First-day testing checklist -- step-by-step for Cat to verify system works with a real doc

## Future Requirements

Deferred -- not blocking go-live.

### CRM Views

- **VIEW-01**: MBP smart list shows opportunities grouped by doc status
- **VIEW-02**: Cat can see missing docs per deal from MBP view
- **VIEW-03**: Per-client automation toggle field

### Notifications

- **NOTIF-01**: Email alert to Cat when all PRE docs received
- **NOTIF-02**: Email alert for unexpected doc (not on checklist)

### Document Validation (v2+)

- **VALID-01**: Data extraction via OCR
- **VALID-02**: Cross-document consistency validation
- **VALID-03**: Proactive issue flagging

### Advanced Classification (v2+)

- **CLASS-01**: Batch upload with auto-split
- **CLASS-02**: Proactive doc health check (expiring docs)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Auto-send emails without Cat review | Compliance risk -- human-in-the-loop required |
| Auto-send reminder emails | Cat reviews and sends manually from CRM task |
| Auto-submit to lenders | Broker judgment required |
| Store PII in logs | PIPEDA compliance -- metadata only |
| Build in GHL visual workflow builder | Custom code via API |
| WhatsApp/text doc intake | Not used by clients |
| Lender submission automation | Future scope |
| Budget call scheduling | Taylor handles manually |
| Client-facing portal | Finmo handles client interactions |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

### v1.0 (Complete)

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01..07 | Phase 1, 5 | Complete |
| CHKL-01..06 | Phase 3 | Complete |
| CRM-01..05 | Phase 2, 4 | Complete |
| EMAIL-01..04 | Phase 5 | Complete |
| INTAKE-01..04 | Phase 6 | Complete |
| FILE-01..05 | Phase 7 | Complete |
| TRACK-01..03 | Phase 8 | Complete |
| OPP-01..08 | Phase 10 | Complete |
| DRIVE-01..07 | Phase 11 | Complete |

### v1.1 (Complete)

| Requirement | Phase | Status |
|-------------|-------|--------|
| PIPE-01..04 | Phase 12 | Complete |
| SYNC-01..03 | Phase 13 | Complete |
| FOLD-01..05 | Phase 14 | Complete |
| ORIG-01..03 | Phase 15 | Complete |
| REMIND-01..04 | Phase 16 | Complete |

### v1.2 (Active)

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEPLOY-01 | Phase 17 | Pending |
| DEPLOY-02 | Phase 17 | Pending |
| DEPLOY-03 | Phase 17 | Pending |
| BTEST-01 | Phase 18 | Pending |
| BTEST-02 | Phase 18 | Pending |
| BTEST-03 | Phase 18 | Pending |
| BTEST-04 | Phase 18 | Pending |
| BTEST-05 | Phase 18 | Pending |
| EDGE-01 | Phase 19 | Pending |
| EDGE-02 | Phase 19 | Pending |
| EDGE-03 | Phase 19 | Pending |
| EDGE-04 | Phase 19 | Pending |
| EDGE-05 | Phase 19 | Pending |
| DATA-01 | Phase 20 | Pending |
| DATA-02 | Phase 20 | Pending |
| DATA-03 | Phase 20 | Pending |
| REMIND-05 | Phase 21 | Pending |
| REMIND-06 | Phase 21 | Pending |
| HANDOFF-01 | Phase 22 | Pending |
| HANDOFF-02 | Phase 22 | Pending |

**Coverage:**
- v1.2 requirements: 20 total
- Mapped to phases: 20/20
- Unmapped: 0

---
*Requirements defined: 2026-02-09*
*Last updated: 2026-03-04 after v1.2 roadmap creation (20 requirements mapped to Phases 17-22)*
