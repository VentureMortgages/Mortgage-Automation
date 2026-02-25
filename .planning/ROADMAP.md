# Roadmap: Venture Mortgages Doc Automation

## Milestones

- Completed **v1.0 Core Pipeline** - Phases 1-11 (shipped 2026-02-22)
- Active **v1.1 Production Hardening** - Phases 12-16 (in progress)

## Overview

This roadmap covers the full automation journey for Venture Mortgages' document collection workflow. v1.0 (Phases 1-11) built the core pipeline from Finmo webhook to Drive filing. v1.1 (Phases 12-16) hardens the live system: fixing CRM workflow gaps that create duplicate tasks and require manual stage moves, making folder matching and timing resilient to real-world edge cases, preserving original documents, and implementing a reminder system so Cat gets notified about outstanding docs.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>v1.0 Core Pipeline (Phases 1-11) - SHIPPED 2026-02-22</summary>

- [x] **Phase 1: Webhook Foundation** - Reliable webhook receiver with async queue processing and idempotency
- [x] **Phase 2: CRM Exploration** - Understand MyBrokerPro setup and design integration strategy
- [x] **Phase 3: Checklist Generation** - Auto-generate personalized doc request from Finmo application
- [x] **Phase 4: CRM Integration** - Create contacts, tasks, and track checklist status in MyBrokerPro
- [x] **Phase 5: Email Drafting** - Generate and send doc request emails from admin@venturemortgages.com
- [x] **Phase 6: Document Intake** - Monitor email and Finmo for incoming client documents
- [x] **Phase 7: Classification & Filing** - Classify, rename, convert, and file docs to Google Drive
- [x] **Phase 8: Tracking Integration** - Update checklist status and notify on PRE-readiness
- [x] **Phase 8.1: Feedback Loop (RAG)** - Capture Cat's email edits and auto-apply to future similar applications (INSERTED)
- [x] **Phase 10: Opportunity-Centric Architecture** - Move doc tracking from contact to opportunity level, support multi-deal clients
- [x] **Phase 11: Drive Folder Linking + Deal Subfolders** - Store folder IDs, create deal-specific subfolders, file deal docs correctly

</details>

### v1.1 Production Hardening (Phases 12-16)

- [ ] **Phase 12: CRM Pipeline Automation** - Deduplicate tasks, auto-move stages, auto-complete review tasks, assign realtor contact type
- [ ] **Phase 13: Timing & Sync Resilience** - Retry CRM sync, file docs before MBP exists, research Finmo external system API
- [ ] **Phase 14: Folder Matching & Backfill** - CRM-first folder resolution, email/phone fallback, multi-borrower routing, subfolder pre-creation, interactive backfill
- [ ] **Phase 15: Original Document Preservation** - Store originals before classification, preserve low-confidence docs, handle re-uploads
- [ ] **Phase 16: Automated Reminders** - CRM tasks + Cat email notifications for outstanding docs every 3 days

## Phase Details

<details>
<summary>v1.0 Phase Details (Phases 1-11) - SHIPPED 2026-02-22</summary>

### Phase 1: Webhook Foundation
**Goal**: System reliably receives and processes Finmo webhooks without duplicates, timeouts, or PII exposure
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-06, INFRA-07
**Success Criteria** (what must be TRUE):
  1. Finmo "application submitted" webhook is received and returns HTTP 202 within 5 seconds
  2. Duplicate webhook deliveries are automatically deduplicated (no duplicate processing)
  3. Failed processing jobs retry automatically with exponential backoff and land in dead-letter queue after exhaustion
  4. System logs contain no sensitive data (SIN numbers, income amounts, addresses never appear in logs)
  5. Global kill switch can disable all automation via environment variable
  6. System runs on Railway or Render VPS with Redis for queue infrastructure
**Plans:** 3/3 complete

### Phase 2: CRM Exploration
**Goal**: Understand MyBrokerPro's existing pipelines, custom fields, and workflow automation before building integration
**Depends on**: Phase 1
**Requirements**: CRM-04
**Success Criteria** (what must be TRUE):
  1. Current MyBrokerPro pipeline stages, custom fields, and contact structure are documented
  2. Existing automation workflows (if any) built by Taylor/Cat are identified to avoid duplication
  3. Integration strategy is defined (which custom fields to use for checklist tracking, whether to create new or use existing)
  4. API authentication and rate limits are tested and understood
**Plans**: Complete (via Phase 4)

### Phase 3: Checklist Generation
**Goal**: System generates personalized document checklist matching DOC_CHECKLIST_RULES_V2 exactly from Finmo application data
**Depends on**: Phase 2
**Requirements**: CHKL-01, CHKL-02, CHKL-03, CHKL-04, CHKL-05, CHKL-06
**Success Criteria** (what must be TRUE):
  1. Employed borrower application generates checklist requesting 2 recent pay stubs, T4s, 90-day bank statements, and employment letter
  2. Self-employed borrower application generates checklist requesting Notice of Assessments (2 years), T1 Generals (2 years), corporate docs, and 90-day bank statements
  3. Co-borrower application generates duplicate document requests for second applicant
  4. Generated checklist excludes items Cat removed as unnecessary
  5. Gift letter is flagged for internal tracking but NOT included in initial email to client
  6. All PRE and FULL documents are listed in single upfront request
**Plans:** 4/4 complete

### Phase 4: CRM Integration
**Goal**: System creates contacts, tasks, and tracks checklist status in MyBrokerPro for Cat's workflow
**Depends on**: Phase 3
**Requirements**: CRM-01, CRM-02, CRM-03, CRM-05
**Success Criteria** (what must be TRUE):
  1. When Finmo application submitted, contact is created or updated in MyBrokerPro with borrower details
  2. Draft review task is created in MyBrokerPro assigned to Cat when checklist is generated
  3. Checklist status (received/missing per document) is visible in MyBrokerPro custom fields
  4. When all PRE documents are received, task is created for Taylor notifying PRE-readiness
  5. Cat can view per-client document status without leaving MyBrokerPro
**Plans:** 4/4 complete

### Phase 5: Email Drafting
**Goal**: System generates professional doc request email and sends from admin@venturemortgages.com after Cat's review
**Depends on**: Phase 4
**Requirements**: EMAIL-01, EMAIL-02, EMAIL-03, EMAIL-04, INFRA-05
**Success Criteria** (what must be TRUE):
  1. Generated email lists all required documents with clear explanations for client
  2. Email is created as draft in system for Cat to review before sending
  3. After Cat approves via CRM task, email sends from admin@venturemortgages.com using Gmail API
  4. Email template is professional, on-brand, and matches tone Cat currently uses
  5. OAuth tokens for Gmail automatically refresh and system alerts on refresh failure
**Plans:** 2/2 complete

### Phase 6: Document Intake
**Goal**: System monitors email and Finmo portal for incoming client documents and extracts attachments
**Depends on**: Phase 5
**Requirements**: INTAKE-01, INTAKE-02, INTAKE-03, INTAKE-04
**Success Criteria** (what must be TRUE):
  1. Documents forwarded to docs@venturemortgages.com by Cat are detected within 5 minutes
  2. Documents uploaded via Finmo portal by client are detected via webhook or API polling
  3. PDF, image, and Word document attachments are successfully extracted from emails
  4. Non-PDF documents (images, Word) are automatically converted to PDF before processing
**Plans:** 4/4 complete

### Phase 7: Classification & Filing
**Goal**: System classifies documents by type, renames using Cat's convention, and files to correct Google Drive folder
**Depends on**: Phase 6
**Requirements**: FILE-01, FILE-02, FILE-03, FILE-04, FILE-05
**Success Criteria** (what must be TRUE):
  1. Received pay stub is classified as "pay stub" and filed to correct client subfolder with consistent naming
  2. Received T4 slip is classified as "T4" and renamed following Cat's naming convention
  3. When client re-uploads updated version of document, system handles versioning
  4. Documents with low classification confidence are flagged for Cat's manual review instead of auto-filing
  5. System files to existing Google Drive folder structure Cat uses
**Plans:** 5/5 complete

### Phase 8: Tracking Integration
**Goal**: System updates checklist status in MyBrokerPro when documents are received and maintains audit trail
**Depends on**: Phase 7
**Requirements**: TRACK-01, TRACK-02, TRACK-03
**Success Criteria** (what must be TRUE):
  1. When document is classified and filed to Drive, checklist status in MyBrokerPro updates from "missing" to "received"
  2. Audit trail records show who uploaded each document and when
  3. Cat can view dashboard in MyBrokerPro showing per-client status without manual updates
**Plans:** 2/2 complete

### Phase 8.1: Feedback Loop (RAG) — INSERTED
**Goal**: Capture Cat's email edits and use RAG to auto-apply similar past edits to future applications
**Depends on**: Phase 8
**Success Criteria** (what must be TRUE):
  1. When Cat sends a draft email (via BCC detection), original vs sent HTML is diffed by Gemini
  2. Feedback records stored in Redis
  3. On new applications, similar past feedback is retrieved via embeddings + cosine similarity
  4. Checklist items consistently removed across 2+ similar matches are auto-removed from new checklists
  5. E2E verified: create draft, edit, send, capture feedback, verify stored record
**Plans**: Complete (outside GSD)

### Phase 10: Opportunity-Centric Architecture
**Goal**: Move doc tracking from contact-level to opportunity-level, supporting multi-deal clients naturally
**Depends on**: Phase 8
**Requirements**: OPP-01, OPP-02, OPP-03, OPP-04, OPP-05, OPP-06, OPP-07, OPP-08
**Success Criteria** (what must be TRUE):
  1. System finds Finmo's existing opportunity by deal ID instead of creating its own
  2. Doc tracking fields live on the opportunity, not the contact
  3. Two simultaneous deals for the same client have independent checklists
  4. Document reuse works across deals for reusable doc types
  5. Property-specific docs are NOT reused across deals
  6. Pipeline stage advances per-opportunity
  7. Contact-level custom fields for doc tracking are deprecated
  8. Existing single-deal clients continue to work
**Plans:** 5/5 complete

### Phase 11: Drive Folder Linking + Deal Subfolders
**Goal**: Client folder ID stored on CRM, deal-specific subfolders for property docs, correct filing everywhere
**Depends on**: Phase 10
**Requirements**: DRIVE-01, DRIVE-02, DRIVE-03, DRIVE-04, DRIVE-05, DRIVE-06, DRIVE-07
**Success Criteria** (what must be TRUE):
  1. Client Drive folder ID stored on CRM contact when created
  2. Classification worker reads folder ID from contact before filing
  3. Deal-specific subfolder created per Finmo application
  4. Reusable docs filed at client folder level
  5. Deal-specific docs filed in deal subfolder
  6. Drive scanner checks both client folder and deal subfolder
  7. Falls back to DRIVE_ROOT_FOLDER_ID if no folder ID on contact
**Plans:** 3/3 complete

</details>

### Phase 12: CRM Pipeline Automation
**Goal**: Cat's CRM workflow runs cleanly -- one review task per application, stages advance automatically, tasks complete on their own
**Depends on**: Phase 11 (v1.0 complete, live system)
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04
**Success Criteria** (what must be TRUE):
  1. When a Finmo application is submitted, Cat sees exactly one "Review checklist" task in MBP (not two from Leads + Live Deals pipelines)
  2. When the checklist email draft is created, the opportunity moves from "In Progress" to "Collecting Documents" without Cat doing it manually
  3. When the opportunity reaches "Collecting Documents", the "Review checklist" task is automatically marked completed (Cat does not have to close it herself)
  4. When a Finmo application includes a realtor, the realtor's MBP contact is assigned the correct contact type (so Cat can filter realtors in CRM)
**Plans**: TBD

Plans:
- [ ] 12-01: TBD during planning

### Phase 13: Timing & Sync Resilience
**Goal**: System handles the real-world timing gap between Finmo webhook and MBP opportunity creation gracefully -- no lost docs, no failed syncs
**Depends on**: Phase 12 (pipeline automation uses opportunity stages)
**Requirements**: SYNC-01, SYNC-02, SYNC-03
**Success Criteria** (what must be TRUE):
  1. When the Finmo webhook fires before MBP has created the opportunity, the system retries CRM sync at 5/10/20 minute intervals until the opportunity appears (no manual intervention needed)
  2. Documents uploaded by a client before the MBP opportunity exists are filed to Google Drive immediately and their CRM tracking is retroactively applied once the opportunity becomes available
  3. A decision is documented on whether Finmo's "update external system" API can trigger MBP sync on demand (research spike with findings recorded)
**Plans**: TBD

Plans:
- [ ] 13-01: TBD during planning

### Phase 14: Folder Matching & Backfill
**Goal**: Every client's documents land in the right Google Drive folder regardless of name ambiguity, and existing clients are linked to their folders
**Depends on**: Phase 12 (needs stable CRM integration)
**Requirements**: FOLD-01, FOLD-02, FOLD-03, FOLD-04, FOLD-05
**Success Criteria** (what must be TRUE):
  1. Client folder resolution checks CRM contact's stored Drive folder URL first (not name matching) -- name matching is only a fallback
  2. When CRM lookup fails and name matching fails, the system tries email address and phone number to find the right folder
  3. Co-borrower documents are routed through the primary borrower's CRM contact and land in the primary borrower's Drive folder
  4. When a client folder is first created, doc subfolders (Income/, Property/, Down Payment/, etc.) are pre-created automatically
  5. Running the backfill script presents each unlinked CRM contact alongside candidate Drive folders and waits for human confirmation before storing the match
**Plans**: TBD

Plans:
- [ ] 14-01: TBD during planning

### Phase 15: Original Document Preservation
**Goal**: Cat can always find the original file a client submitted, even if AI classification was wrong or the file was renamed
**Depends on**: Phase 14 (needs correct folder resolution + subfolders)
**Requirements**: ORIG-01, ORIG-02, ORIG-03
**Success Criteria** (what must be TRUE):
  1. Every document received (via email or Finmo) appears in `ClientFolder/Originals/` with its original filename before any classification or renaming happens
  2. Low-confidence documents are preserved in Originals instead of being deleted from temp storage (Cat gets the CRM task AND can find the file)
  3. When a client re-uploads a document, the new original is stored alongside the previous version in Originals (no overwriting)
**Plans**: TBD

Plans:
- [ ] 15-01: TBD during planning

### Phase 16: Automated Reminders
**Goal**: Cat is notified when docs are overdue and has a ready-made follow-up message to send, without manually tracking who is late
**Depends on**: Phase 15 (needs complete filing pipeline including originals)
**Requirements**: REMIND-01, REMIND-02, REMIND-03, REMIND-04
**Success Criteria** (what must be TRUE):
  1. When docs have been outstanding for 3+ days, a CRM task appears for Cat listing the missing documents with a draft follow-up email she can copy and paste
  2. Cat receives an email with subject "Follow up: Need docs - [Client Name]" containing client details and the draft follow-up text
  3. If docs are still missing after another 3 days, the existing reminder task is updated (not duplicated) with a refreshed missing-docs list
  4. When all required docs are received, any pending reminder tasks are automatically closed and no further reminder emails are sent
**Plans**: TBD

Plans:
- [ ] 16-01: TBD during planning

## Progress

**Execution Order:**
Phases execute in numeric order: 12 -> 13 -> 14 -> 15 -> 16

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Webhook Foundation | v1.0 | 3/3 | Complete | 2026-02-13 |
| 2. CRM Exploration | v1.0 | N/A | Complete | 2026-02-13 |
| 3. Checklist Generation | v1.0 | 4/4 | Complete | 2026-02-13 |
| 4. CRM Integration | v1.0 | 4/4 | Complete | 2026-02-13 |
| 5. Email Drafting | v1.0 | 2/2 | Complete | 2026-02-14 |
| 6. Document Intake | v1.0 | 4/4 | Complete | 2026-02-14 |
| 7. Classification & Filing | v1.0 | 5/5 | Complete | 2026-02-15 |
| 8. Tracking Integration | v1.0 | 2/2 | Complete | 2026-02-16 |
| 8.1 Feedback Loop (RAG) | v1.0 | N/A | Complete | 2026-02-21 |
| 10. Opportunity-Centric | v1.0 | 5/5 | Complete | 2026-02-21 |
| 11. Drive Folder Linking | v1.0 | 3/3 | Complete | 2026-02-22 |
| 12. CRM Pipeline Automation | v1.1 | 0/TBD | Not started | - |
| 13. Timing & Sync Resilience | v1.1 | 0/TBD | Not started | - |
| 14. Folder Matching & Backfill | v1.1 | 0/TBD | Not started | - |
| 15. Original Doc Preservation | v1.1 | 0/TBD | Not started | - |
| 16. Automated Reminders | v1.1 | 0/TBD | Not started | - |

### Action Items (Non-Code)
| Item | Owner | Status |
|------|-------|--------|
| SPF/DKIM/DMARC setup on venturemortgages.com | Taylor (DNS registrar) | NOT DONE -- emails may go to spam |
| Confirm Finmo "smart docs" stays OFF (no overlap) | Taylor | Confirmed OFF (2026-02-21) |

---
*Roadmap created: 2026-02-09*
*Last updated: 2026-02-25 (v1.1 roadmap -- phases 12-16 defined, replacing old unstarted phases 12-17)*
