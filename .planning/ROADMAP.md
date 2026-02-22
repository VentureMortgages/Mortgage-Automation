# Roadmap: Venture Mortgages Doc Automation

## Overview

This roadmap transforms Venture Mortgages' manual document collection workflow into an automated system. Starting with foundational webhook infrastructure and PII-safe processing patterns, the system progressively builds capability: exploring MyBrokerPro's existing setup, generating personalized checklists from Finmo applications, drafting emails for Cat's review, monitoring incoming documents, classifying and filing them to Google Drive, tracking completion status, and finally enabling automated reminders. Each phase delivers verifiable value while maintaining human-in-the-loop control and compliance requirements.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

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
- [ ] **Phase 11: Drive Folder Linking + Deal Subfolders** - Store folder IDs, create deal-specific subfolders, file deal docs correctly
- [ ] **Phase 12: Original Document Preservation** - Always store originals, make renamed copy for filing
- [ ] **Phase 13: Email Wording & Notifications** - Fix client-facing email, add PRE Complete + unexpected doc alerts
- [ ] **Phase 14: CRM Views & Kill Switch** - MBP smart lists for doc tracking + automation toggle field
- [ ] **Phase 15: Automated Reminders** - Escalating follow-ups with educational content and CRM trigger (tabled)
- [ ] **Phase 16: Cat Onboarding SOP** - Create SOP document + walkthrough for Cat
- [ ] **Phase 17: Test Cleanup & Production Switch** - Remove [TEST] records, switch APP_ENV, final verification

## Phase Details

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
**Plans:** 3 plans

Plans:
- [ ] 01-01-PLAN.md — Config, types, and PII sanitizer (TDD) — foundation for all webhook modules
- [ ] 01-02-PLAN.md — Express server, BullMQ queue, webhook endpoint, health check + tests
- [ ] 01-03-PLAN.md — Finmo client, worker orchestrator, application entry point + tests

### Phase 2: CRM Exploration
**Goal**: Understand MyBrokerPro's existing pipelines, custom fields, and workflow automation before building integration
**Depends on**: Phase 1
**Requirements**: CRM-04
**Success Criteria** (what must be TRUE):
  1. Current MyBrokerPro pipeline stages, custom fields, and contact structure are documented
  2. Existing automation workflows (if any) built by Taylor/Cat are identified to avoid duplication
  3. Integration strategy is defined (which custom fields to use for checklist tracking, whether to create new or use existing)
  4. API authentication and rate limits are tested and understood
**Plans**: TBD

Plans:
- [ ] 02-01: TBD during planning

### Phase 3: Checklist Generation
**Goal**: System generates personalized document checklist matching DOC_CHECKLIST_RULES_V2 exactly from Finmo application data
**Depends on**: Phase 2
**Requirements**: CHKL-01, CHKL-02, CHKL-03, CHKL-04, CHKL-05, CHKL-06
**Success Criteria** (what must be TRUE):
  1. Employed borrower application generates checklist requesting 2 recent pay stubs, T4s, 90-day bank statements, and employment letter
  2. Self-employed borrower application generates checklist requesting Notice of Assessments (2 years), T1 Generals (2 years), corporate docs, and 90-day bank statements
  3. Co-borrower application generates duplicate document requests for second applicant (e.g., "John's T4" and "Jane's T4")
  4. Generated checklist excludes items Cat removed as unnecessary (signed credit consent, T2125 when T1 requested, bonus payment history when T4+LOE collected)
  5. Gift letter is flagged for internal tracking but NOT included in initial email to client
  6. All PRE and FULL documents are listed in single upfront request (no staged requests)
**Plans:** 4 plans

Plans:
- [ ] 03-01-PLAN.md — Project bootstrap + TypeScript type interfaces (Finmo types, rule engine types, checklist output types)
- [ ] 03-02-PLAN.md — Rule definitions for all 17 sections of DOC_CHECKLIST_RULES_V2 (~80-90 rules)
- [ ] 03-03-PLAN.md — Checklist generation engine (evaluates rules, builds per-borrower contexts, deduplicates, formats output)
- [ ] 03-04-PLAN.md — Test suite with fixtures covering all 6 success criteria and all CHKL requirements

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
**Plans:** 4 plans

Plans:
- [ ] 04-01-PLAN.md — CRM foundation: GHL SDK, types/constants, config, setup scripts for custom fields and ID fetching
- [ ] 04-02-PLAN.md — CRM service modules: contact upsert, task creation, opportunity/pipeline management
- [ ] 04-03-PLAN.md — Checklist-to-CRM field mapper (pure function) + barrel export
- [ ] 04-04-PLAN.md — Orchestrator (syncChecklistToCrm) + test suite (mapper, utilities, orchestration)

### Phase 5: Email Drafting
**Goal**: System generates professional doc request email and sends from admin@venturemortgages.com after Cat's review
**Depends on**: Phase 4
**Requirements**: EMAIL-01, EMAIL-02, EMAIL-03, EMAIL-04, INFRA-05
**Success Criteria** (what must be TRUE):
  1. Generated email lists all required documents with clear explanations for client
  2. Email is created as draft in system for Cat to review before sending (not auto-sent)
  3. After Cat approves via CRM task, email sends from admin@venturemortgages.com using Gmail API
  4. Email template is professional, on-brand, and matches tone Cat currently uses
  5. OAuth tokens for Gmail automatically refresh and system alerts on refresh failure
**Plans:** 2 plans

Plans:
- [ ] 05-01-PLAN.md — Email types, config, body generator (pure function), MIME encoder + TDD tests
- [ ] 05-02-PLAN.md — Gmail API client, draft orchestrator, send function, barrel export + tests

### Phase 6: Document Intake
**Goal**: System monitors email and Finmo portal for incoming client documents and extracts attachments
**Depends on**: Phase 5
**Requirements**: INTAKE-01, INTAKE-02, INTAKE-03, INTAKE-04
**Success Criteria** (what must be TRUE):
  1. Documents forwarded to docs@venturemortgages.co by Cat are detected within 5 minutes
  2. Documents uploaded via Finmo portal by client are detected via webhook or API polling
  3. PDF, image, and Word document attachments are successfully extracted from emails
  4. Non-PDF documents (images, Word) are automatically converted to PDF before processing
**Plans:** 4 plans

Plans:
- [ ] 06-01-PLAN.md — Intake types, config, and Gmail client refactor (readonly scope + impersonation)
- [ ] 06-02-PLAN.md — PDF converter TDD (image-to-PDF via pdf-lib, Word flagged for manual review)
- [ ] 06-03-PLAN.md — Gmail reader (history-based polling) and attachment extractor (MIME walking)
- [ ] 06-04-PLAN.md — Gmail monitor scheduler, Finmo doc handler, intake worker, barrel export

### Phase 7: Classification & Filing
**Goal**: System classifies documents by type, renames using Cat's convention, and files to correct Google Drive folder
**Depends on**: Phase 6
**Requirements**: FILE-01, FILE-02, FILE-03, FILE-04, FILE-05
**Success Criteria** (what must be TRUE):
  1. Received pay stub is classified as "pay stub" and filed to correct client subfolder with consistent naming
  2. Received T4 slip is classified as "T4" and renamed following Cat's naming convention
  3. When client re-uploads updated version of document, system handles versioning (replaces or versions appropriately)
  4. Documents with low classification confidence (below threshold) are flagged for Cat's manual review instead of auto-filing
  5. System files to existing Google Drive folder structure Cat uses (Mortgage Clients → client folders → subfolders)
**Plans:** 5 plans

Plans:
- [ ] 07-01-PLAN.md — Install deps (@anthropic-ai/sdk, zod), classification types, Zod schema, config
- [ ] 07-02-PLAN.md — Finmo document downloader (confirmed API endpoints) + Redis dedup
- [ ] 07-03-PLAN.md — Claude classifier (structured output TDD), naming module, subfolder router
- [ ] 07-04-PLAN.md — Google Drive client (service account auth) + filer (folder/file CRUD)
- [ ] 07-05-PLAN.md — Classification worker, intake queue bridge, barrel export

### Phase 8: Tracking Integration
**Goal**: System updates checklist status in MyBrokerPro when documents are received and maintains audit trail
**Depends on**: Phase 7
**Requirements**: TRACK-01, TRACK-02, TRACK-03
**Success Criteria** (what must be TRUE):
  1. When document is classified and filed to Drive, checklist status in MyBrokerPro updates from "missing" to "received"
  2. Audit trail records show who uploaded each document and when (for compliance)
  3. Cat can view dashboard in MyBrokerPro showing per-client status (received/missing/pending review) without manual updates
**Plans:** 2 plans

Plans:
- [x] 08-01-PLAN.md — CRM extensions (getContact, notes, doc-type matcher) + missingDocs stage format
- [x] 08-02-PLAN.md — Tracking sync orchestrator, classification worker integration, barrel export

### Phase 8.1: Feedback Loop (RAG) — INSERTED
**Goal**: Capture Cat's email edits and use RAG to auto-apply similar past edits to future applications
**Depends on**: Phase 8
**Success Criteria** (what must be TRUE):
  1. When Cat sends a draft email (via BCC detection), original vs sent HTML is diffed by Gemini
  2. Feedback records (removed/added/reworded items + application context) stored in JSON
  3. On new applications, similar past feedback is retrieved via embeddings + cosine similarity
  4. Checklist items consistently removed across 2+ similar matches are auto-removed from new checklists
  5. E2E verified: create draft → edit → send → capture feedback → verify stored record
**Status**: COMPLETE (2026-02-21)

### Phase 10: Opportunity-Centric Architecture
**Goal**: Move doc tracking from contact-level to opportunity-level, supporting multi-deal clients naturally
**Depends on**: Phase 8
**Context**: Finmo already creates opportunities in GHL with rich custom fields (deal ID, link, borrower info, co-borrower info, transaction type). Our automation currently creates duplicate opportunities and stores doc tracking on the contact — which breaks when a client has multiple deals.
**Success Criteria** (what must be TRUE):
  1. System finds Finmo's existing opportunity (by Finmo deal ID) instead of creating its own
  2. Doc tracking fields (missingDocs, receivedDocs, docStatus, counters) live on the opportunity, not the contact
  3. Two simultaneous deals for the same client have independent checklists that don't overwrite each other
  4. Document reuse still works: reusable docs (IDs, T4s, bank statements) from the client folder are applied across deals
  5. Property-specific docs (purchase agreement, MLS, gift letter) are NOT reused across deals
  6. Pipeline stage advances per-opportunity (not per-contact)
  7. Contact-level custom fields for doc tracking are deprecated / removed
  8. Existing single-deal clients continue to work (backward compatible)
**Requirements**: OPP-01, OPP-02, OPP-03, OPP-04, OPP-05, OPP-06, OPP-07, OPP-08
**Plans:** 5/5 plans complete

Plans:
- [x] 10-01-PLAN.md — Opportunity types, config, and API functions (search, get, update, stage)
- [x] 10-02-PLAN.md — Setup scripts for opportunity-scoped custom fields (has checkpoint)
- [x] 10-03-PLAN.md — Checklist sync refactor: write doc tracking to opportunity
- [x] 10-04-PLAN.md — Tracking sync refactor: read/write opportunity + cross-deal reuse
- [x] 10-05-PLAN.md — Wire workers, update barrel export, clean up deprecated code

### Phase 11: Drive Folder Linking + Deal Subfolders
**Goal**: Client folder ID stored on CRM, deal-specific subfolders for property docs, correct filing everywhere
**Depends on**: Phase 10 (opportunity-centric architecture)
**Requirements**: DRIVE-01, DRIVE-02, DRIVE-03, DRIVE-04, DRIVE-05, DRIVE-06, DRIVE-07
**Success Criteria** (what must be TRUE):
  1. Client Drive folder ID stored on CRM contact when created (webhook worker)
  2. Classification worker reads folder ID from contact before filing
  3. Deal-specific subfolder created per Finmo application (e.g., `BRXM-F050382/Property/`)
  4. Reusable docs (income, IDs, bank statements) filed at client folder level (shared across deals)
  5. Deal-specific docs (purchase agreement, MLS, gift letter) filed in deal subfolder
  6. Drive scanner checks both client folder (reusable) and deal subfolder (deal-specific) when building checklist
  7. Falls back to DRIVE_ROOT_FOLDER_ID if no folder ID on contact (backward compat)
**Plans:** 3 plans

Plans:
- [x] 11-01-PLAN.md — CRM config, types, contact helper, and setup script for Drive folder fields
- [ ] 11-02-PLAN.md — Webhook worker folder persistence, deal subfolder creation, dual Drive scan
- [ ] 11-03-PLAN.md — Classification worker CRM-based folder resolution and property/reusable routing

### Phase 12: Original Document Preservation
**Goal**: Every received document is preserved in its original form, with a renamed copy filed using Cat's naming conventions
**Depends on**: Phase 11 (needs correct client folder + deal subfolders)
**Success Criteria** (what must be TRUE):
  1. Every document received (email or Finmo) is uploaded to `ClientFolder/Originals/` with its original filename
  2. A copy is made, renamed using Cat's naming conventions, and filed in the proper subfolder
  3. Low-confidence documents are stored in Originals (not deleted from temp storage as today)
  4. Cat can find the original file even if AI misclassified it
  5. Document replacement: new version of same doc type updates the renamed copy but original is preserved as new file
**Plans**: TBD

Plans:
- [ ] 12-01: TBD during planning

### Phase 13: Email Wording & Notifications
**Goal**: Client-facing emails direct to admin@, Cat receives key alerts, unexpected docs flagged
**Depends on**: Phase 10 (opportunity-centric for correct alert context)
**Success Criteria** (what must be TRUE):
  1. Doc request email tells clients to send docs to admin@venturemortgages.com (not docs@ or dev@)
  2. If docs@ receives an email from a non-@venturemortgages.com domain, alert email sent to admin@ for Cat
  3. When all PRE documents are received (docStatus = "PRE Complete"), email sent to admin@ for Cat to review before passing to Taylor
  4. When an incoming doc is classified but doesn't match any checklist item (no-match-in-checklist), alert Cat at admin@ ("Unexpected doc received: [type] for [client] — not on checklist, filed to Drive")
  5. No alert for normal doc arrivals via email (Cat already sees those in admin@)
**Note**: Finmo "smart docs" is currently OFF — no Finmo doc upload alerts needed unless they turn it on
**Plans**: TBD

Plans:
- [ ] 13-01: TBD during planning

### Phase 14: CRM Views & Kill Switch
**Goal**: Cat can track missing docs in MBP views + automation can be toggled per-client or globally from MBP
**Depends on**: Phase 10 (opportunity-centric — views show per-deal status)
**Success Criteria** (what must be TRUE):
  1. MyBrokerPro smart list or pipeline view shows opportunities grouped by docStatus (In Progress / PRE Complete / All Complete)
  2. Cat can see which specific docs are missing for each deal from the CRM view
  3. Leverages existing MyBrokerPro features (smart lists, pipeline views, custom field filters) — no custom dashboard
  4. "Doc Automation" toggle field on contact or opportunity — webhook worker checks this before processing
  5. Global kill switch also exposed as a MBP field (so Taylor/Cat can disable without server access)
**Plans**: TBD

Plans:
- [ ] 14-01: TBD during planning

### Phase 15: Automated Reminders (Tabled)
**Goal**: Escalating context-aware follow-ups for missing documents with educational content
**Depends on**: Phase 13, Phase 14
**Success Criteria** (what must be TRUE):
  1. Reminder tone/content escalates over time as client delays (friendly → firmer → urgent)
  2. Reminders link to Venture Mortgages website pages explaining how to obtain each document type
  3. CRM trigger button: Cat clicks → system reads missingDocs → generates follow-up draft in Gmail
  4. Follow-up drafts go through same BCC feedback loop (RAG learns from Cat's edits to follow-ups too)
  5. Reminders disabled by default (global + per-client toggle via Phase 14)
  6. Cat can trigger from MyBrokerPro or Gmail — TBD based on Cat's preference
**Status**: Tabled — requirements captured, will implement after verification of Phases 10-14
**Plans**: TBD

Plans:
- [ ] 15-01: TBD during planning

### Phase 16: Cat Onboarding SOP
**Goal**: Create documentation and walkthrough for Cat to use the system
**Depends on**: Phases 10-14 (system should be stable before onboarding)
**Success Criteria** (what must be TRUE):
  1. SOP document covers: where drafts appear, how to edit/send, what CRM fields mean, what to do on manual review tasks
  2. Document explains the feedback loop (why editing drafts directly matters)
  3. Troubleshooting section: what to do if something looks wrong, how to disable
  4. 15-minute walkthrough session with Cat (Taylor to schedule)
**Plans**: TBD

Plans:
- [ ] 16-01: TBD during planning

### Phase 17: Test Cleanup & Production Switch
**Goal**: Clean up dev artifacts, remove [TEST] records, verify production readiness
**Depends on**: Phase 16 (onboarding done, ready to go live)
**Success Criteria** (what must be TRUE):
  1. All [TEST] prefixed opportunities, tasks, and contacts cleaned up from MBP
  2. Railway APP_ENV verified as production
  3. EMAIL_BCC set to docs@venturemortgages.com
  4. EMAIL_SENDER set to admin@venturemortgages.com
  5. SPF/DKIM/DMARC verified on venturemortgages.com (Taylor action item — flagged if not done)
  6. End-to-end test with one real Finmo application in production mode
  7. data/feedback-records.json test data cleared
**Plans**: TBD

Plans:
- [ ] 17-01: TBD during planning

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Webhook Foundation | 3/3 | Complete | 2026-02-13 |
| 2. CRM Exploration | N/A | Complete (via Phase 4) | 2026-02-13 |
| 3. Checklist Generation | 4/4 | Complete | 2026-02-13 |
| 4. CRM Integration | 4/4 | Complete | 2026-02-13 |
| 5. Email Drafting | 2/2 | Complete | 2026-02-14 |
| 6. Document Intake | 4/4 | Complete | 2026-02-14 |
| 7. Classification & Filing | 5/5 | Complete | 2026-02-15 |
| 8. Tracking Integration | 2/2 | Complete | 2026-02-16 |
| 8.1 Feedback Loop (RAG) | N/A | Complete (outside GSD) | 2026-02-21 |
| 10. Opportunity-Centric Architecture | 5/5 | Complete    | 2026-02-21 |
| 11. Drive Folder Linking + Deal Subfolders | 1/3 | In progress | - |
| 12. Original Doc Preservation | 0/TBD | Not started (blocked by 11) | - |
| 13. Email Wording & Notifications | 0/TBD | Not started | - |
| 14. CRM Views & Kill Switch | 0/TBD | Not started | - |
| 15. Automated Reminders | 0/TBD | Tabled | - |
| 16. Cat Onboarding SOP | 0/TBD | Not started (after 10-14) | - |
| 17. Test Cleanup & Production Switch | 0/TBD | Not started (last phase) | - |

### Action Items (Non-Code)
| Item | Owner | Status |
|------|-------|--------|
| SPF/DKIM/DMARC setup on venturemortgages.com | Taylor (DNS registrar) | NOT DONE — emails may go to spam |
| Confirm Finmo "smart docs" stays OFF (no overlap) | Taylor | Confirmed OFF (2026-02-21) |
| Ask Cat notification preferences | Taylor/Luca | Parked |
| Schedule Cat onboarding walkthrough | Taylor | After Phase 16 |

---
*Roadmap created: 2026-02-09*
*Last updated: 2026-02-22 (Phase 11 plan 01 complete — CRM config + types for Drive folder linking)*
