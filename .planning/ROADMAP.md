# Roadmap: Venture Mortgages Doc Automation

## Milestones

- Completed **v1.0 Core Pipeline** - Phases 1-11 (shipped 2026-02-22)
- Completed **v1.1 Production Hardening** - Phases 12-16 (shipped 2026-03-03)
- Active **v1.2 Production Go-Live** - Phases 17-22 (in progress)

## Overview

This roadmap covers the full automation journey for Venture Mortgages' document collection workflow. v1.0 (Phases 1-11) built the core pipeline from Finmo webhook to Drive filing. v1.1 (Phases 12-16) hardened the live system with CRM pipeline automation, smart document matching, original preservation, timing resilience, and automated reminders. v1.2 (Phases 17-22) deploys v1.1 code to production, battle-tests every scenario with real messages, cleans up CRM data, verifies reminders, and hands off to Cat with SOPs and a testing checklist.

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

<details>
<summary>v1.1 Production Hardening (Phases 12-16) - SHIPPED 2026-03-03</summary>

- [x] **Phase 12: CRM Pipeline Automation** - Deduplicate tasks, auto-move stages, auto-complete review tasks, assign realtor contact type
- [x] **Phase 13: Original Document Preservation** - Store originals before classification/renaming, safety net for misroutes
- [x] **Phase 14: Smart Document Matching** - Signal-based AI agent for matching incoming docs to client folders
- [x] **Phase 15: Timing & Sync Resilience** - Retry CRM sync, file docs before MBP exists, subfolder catch-up
- [x] **Phase 16: Automated Reminders** - CRM tasks + Cat email notifications for outstanding docs every 3 days

</details>

### v1.2 Production Go-Live (Phases 17-22)

- [x] **Phase 17: Deploy & Configure** - Deploy v1.1 code to Railway, verify env vars, confirm services healthy (completed 2026-03-04)
- [x] **Phase 17.1: Close Production Gaps** - Co-borrower CRM contacts, Drive folder backfill spreadsheet, Finmo doc upload webhook (INSERTED, completed 2026-03-04)
- [x] **Phase 18: Battle Test -- Core Pipeline** - Verified: classification, matching, filing, CRM tracking all work (completed 2026-03-04)
- [x] **Phase 19: Battle Test -- Edge Cases** - Verified: multi-attach, unknown docs, sender signal behavior documented (completed 2026-03-04)
- [ ] **Phase 20: Data Preparation** - Backfill Drive folder links, clean up test data, fix stale CRM references
- [ ] **Phase 21: Reminders Verification** - Trigger reminder scan, verify CRM tasks and Cat email notifications
- [ ] **Phase 22: Cat Handoff** - SOP document and first-day testing checklist for Cat

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

### Phase 8.1: Feedback Loop (RAG) -- INSERTED
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

<details>
<summary>v1.1 Phase Details (Phases 12-16) - SHIPPED 2026-03-03</summary>

### Phase 12: CRM Pipeline Automation
**Goal**: Cat's CRM workflow runs cleanly -- one review task per application, stages advance automatically, tasks complete on their own
**Depends on**: Phase 11 (v1.0 complete, live system)
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04
**Success Criteria** (what must be TRUE):
  1. When a Finmo application is submitted, Cat sees exactly one "Review checklist" task in MBP (not two from Leads + Live Deals pipelines)
  2. When the checklist email draft is created, the opportunity moves from "In Progress" to "Collecting Documents" without Cat doing it manually
  3. When the opportunity reaches "Collecting Documents", the "Review checklist" task is automatically marked completed (Cat does not have to close it herself)
  4. When a Finmo application includes a realtor, the realtor's MBP contact is assigned the correct contact type (so Cat can filter realtors in CRM)
**Plans**: 3/3 complete

### Phase 13: Original Document Preservation
**Goal**: Cat can always find the original file a client submitted, even if AI classification was wrong or the file was renamed -- safety net before smart matching
**Depends on**: Phase 12 (needs stable CRM + Drive pipeline)
**Requirements**: ORIG-01, ORIG-02, ORIG-03
**Success Criteria** (what must be TRUE):
  1. Every document received (via email or Finmo) appears in `ClientFolder/Originals/` with its original filename before any classification or renaming happens
  2. Low-confidence documents are preserved in Originals instead of being deleted from temp storage (Cat gets the CRM task AND can find the file)
  3. When a client re-uploads a document, the new original is stored alongside the previous version in Originals (no overwriting)
**Plans**: 2/2 complete

### Phase 14: Smart Document Matching
**Goal**: Every incoming document is matched to the correct client folder using a signal-based AI agent -- handles third-party senders, name ambiguity, and joint/solo application overlap
**Depends on**: Phase 13 (originals stored first = safety net for misroutes)
**Requirements**: FOLD-01, FOLD-02, FOLD-03, FOLD-04, FOLD-05
**Success Criteria** (what must be TRUE):
  1. When a client replies to the doc request email, the system matches via thread context and auto-files with high confidence
  2. When a third party sends docs, the system extracts the client name from the document content and matches to the correct contact/opportunity
  3. When confidence is >= 0.8, the document is auto-filed and a CRM note logs the reasoning
  4. When confidence is < 0.8, a CRM task is created for Cat showing top candidates with reasoning
  5. When a joint-application client also has a solo folder, docs route to the correct opportunity's folder
  6. Full matching decision log stored in Redis with 90-day TTL
**Plans**: 3/3 complete

### Phase 15: Timing & Sync Resilience
**Goal**: System handles the real-world timing gap between Finmo webhook and MBP opportunity creation gracefully
**Depends on**: Phase 14 (matching agent routes docs even when CRM isn't ready)
**Requirements**: SYNC-01, SYNC-02, SYNC-03
**Success Criteria** (what must be TRUE):
  1. When Finmo webhook fires before MBP opportunity exists, system retries CRM sync at increasing intervals until opportunity appears
  2. Documents uploaded before MBP opportunity exists are filed to Drive immediately and CRM tracking is retroactively applied
  3. Decision documented on whether Finmo "update external system" API can trigger MBP sync on demand
**Plans**: 2/2 complete

### Phase 16: Automated Reminders
**Goal**: Cat is notified when docs are overdue and has a ready-made follow-up message to send
**Depends on**: Phase 15 (needs complete filing pipeline)
**Requirements**: REMIND-01, REMIND-02, REMIND-03, REMIND-04
**Success Criteria** (what must be TRUE):
  1. When docs outstanding for 3+ days, CRM task appears for Cat listing missing docs with draft follow-up email
  2. Cat receives email with subject "Follow up: Need docs - [Client Name]" containing draft follow-up text
  3. If docs still missing after 3 more days, existing reminder task is updated (not duplicated)
  4. When all required docs received, pending reminder tasks auto-close and no further emails sent
**Plans**: 2/2 complete

</details>

### Phase 17: Deploy & Configure
**Goal**: Latest v1.1 code is running in production on Railway with all environment variables correct, all services connected, and health checks passing
**Depends on**: Phase 16 (v1.1 complete)
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03
**Success Criteria** (what must be TRUE):
  1. Railway deployment is running the latest GitHub commit (including T1 naming fix + battle-test endpoint + reminders)
  2. Railway env vars are verified correct: APP_ENV=production, CAT_EMAIL set, REDIS_URL connected, GOOGLE_SERVICE_ACCOUNT_KEY present, kill switch OFF
  3. Health endpoint returns 200 OK, Gmail poller is actively running (visible in logs), and no startup errors in Railway logs
**Plans**: 1 plan
Plans:
- [ ] 17-01-PLAN.md -- Deploy v1.1 code, configure env vars, verify health

### Phase 17.1: Close Production Gaps -- INSERTED
**Goal**: Fix three production gaps before battle testing — co-borrower CRM contacts, Drive folder backfill for existing clients, and Finmo document upload webhook
**Depends on**: Phase 17 (system deployed and healthy)
**Requirements**: COBORROW-01, DATA-01, INTAKE-02
**Success Criteria** (what must be TRUE):
  1. Joint Finmo applications create CRM contacts for ALL borrowers (not just main), each linked to the same Drive folder
  2. Google Sheet populated with best-guess CRM contact → Drive folder pairings for human review (no auto-update)
  3. Finmo document upload webhook route is registered and enqueues uploads for processing
**Plans**: 3
Plans:
- [ ] 17.1-01-PLAN.md -- Co-borrower CRM contact creation
- [ ] 17.1-02-PLAN.md -- Drive folder backfill spreadsheet
- [ ] 17.1-03-PLAN.md -- Wire up Finmo document upload webhook

### Phase 18: Battle Test -- Core Pipeline
**Goal**: The full intake pipeline (forward doc to docs@, classify, match to client, file to Drive, update CRM) works end-to-end with real Gmail messages in production
**Depends on**: Phase 17 (code must be deployed and healthy)
**Requirements**: BTEST-01, BTEST-02, BTEST-03, BTEST-04, BTEST-05
**Success Criteria** (what must be TRUE):
  1. A real document forwarded to docs@ is classified with the correct document type, borrower name, and year
  2. The classified document is matched to the correct CRM contact by name extracted from the PDF
  3. The document is filed to the correct client folder and subfolder in Google Drive, renamed using Cat's naming convention
  4. The CRM opportunity's doc checklist custom field is updated to reflect the received document
  5. A T1 (personal tax return) document is named "Name - T1 YYYY" without institution or amount -- verifying Cat's bug report is fixed
**Plans**: 1 plan
Plans:
- [ ] 17-01-PLAN.md -- Deploy v1.1 code, configure env vars, verify health

### Phase 19: Battle Test -- Edge Cases
**Goal**: Every edge-case scenario the system will encounter in production is verified working -- unknown senders, ambiguous names, multiple attachments, low-confidence classifications, and co-borrower documents
**Depends on**: Phase 18 (core pipeline must work before testing edges)
**Requirements**: EDGE-01, EDGE-02, EDGE-03, EDGE-04, EDGE-05
**Success Criteria** (what must be TRUE):
  1. An email from an unknown sender with an extractable first+last name results in a new CRM contact and Drive folder being auto-created
  2. An email with only a partial name (last name only or ambiguous) is routed to Needs Review with a CRM task for Cat showing candidates
  3. An email with multiple attachments has each attachment classified and filed independently (not just the first one)
  4. A document with low classification confidence lands in the Needs Review/ folder with a CRM task for Cat explaining why
  5. A co-borrower's document is matched via borrower traversal and filed to the correct primary client folder
**Plans**: 1 plan
Plans:
- [ ] 17-01-PLAN.md -- Deploy v1.1 code, configure env vars, verify health

### Phase 20: Data Preparation
**Goal**: CRM and Drive data is clean and ready for Cat to start using the system -- existing contacts linked to their Drive folders, test data removed, stale references fixed
**Depends on**: Phase 19 (system verified working before touching production data)
**Requirements**: DATA-01, DATA-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. Backfill script has been run and existing CRM contacts are linked to their corresponding Drive folders (human-confirmed matches)
  2. All [TEST] contacts and opportunities have been removed from MBP (Cat sees only real clients)
  3. Any stale or broken Drive folder IDs in CRM have been identified and corrected (no dead links when system tries to file docs)
**Plans**: 1 plan
Plans:
- [ ] 17-01-PLAN.md -- Deploy v1.1 code, configure env vars, verify health

### Phase 21: Reminders Verification
**Goal**: The reminder system fires correctly in production -- CRM tasks are created for stale opportunities and Cat receives email notifications about pending doc follow-ups
**Depends on**: Phase 20 (needs clean data so reminders target real clients, not test data)
**Requirements**: REMIND-05, REMIND-06
**Success Criteria** (what must be TRUE):
  1. Triggering /admin/trigger-reminder-scan produces CRM tasks for opportunities with docs outstanding 3+ days, listing specific missing documents with draft follow-up text
  2. Cat receives an email notification for each reminder with subject "Follow up: Need docs - [Client Name]" and the draft follow-up text she can copy/paste
**Plans**: 1 plan
Plans:
- [ ] 17-01-PLAN.md -- Deploy v1.1 code, configure env vars, verify health

### Phase 22: Cat Handoff
**Goal**: Cat has everything she needs to start using the system tomorrow morning -- a clear SOP explaining what the system does and how to interact with it, plus a step-by-step checklist for her first real test
**Depends on**: Phase 21 (all testing and data prep complete)
**Requirements**: HANDOFF-01, HANDOFF-02
**Success Criteria** (what must be TRUE):
  1. SOP document exists that Cat can reference: how to forward docs, what the system does automatically, how to handle Needs Review tasks, how to disable the system, and who to contact if something goes wrong
  2. First-day testing checklist exists with step-by-step instructions Cat can follow to verify the system works with a real document (forward a doc, wait, check Drive, check CRM)
**Plans**: 1 plan
Plans:
- [ ] 17-01-PLAN.md -- Deploy v1.1 code, configure env vars, verify health

## Progress

**Execution Order:**
Phases execute in numeric order: 17 -> 18 -> 19 -> 20 -> 21 -> 22

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
| 12. CRM Pipeline Automation | v1.1 | 3/3 | Complete | 2026-02-26 |
| 13. Original Doc Preservation | v1.1 | 2/2 | Complete | 2026-03-02 |
| 14. Smart Document Matching | v1.1 | 3/3 | Complete | 2026-03-02 |
| 15. Timing & Sync Resilience | v1.1 | 2/2 | Complete | 2026-03-02 |
| 16. Automated Reminders | v1.1 | 2/2 | Complete | 2026-03-03 |
| 17. Deploy & Configure | 1/1 | Complete    | 2026-03-04 | - |
| 17.1. Close Production Gaps | 3/3 | Complete    | 2026-03-04 | 2026-03-04 |
| 18. Battle Test -- Core Pipeline | v1.2 | Complete    | 2026-03-04 | 2026-03-04 |
| 19. Battle Test -- Edge Cases | v1.2 | Complete    | 2026-03-04 | 2026-03-04 |
| 20. Data Preparation | v1.2 | 0/TBD | In progress | - |
| 21. Reminders Verification | v1.2 | 0/TBD | Not started | - |
| 22. Cat Handoff | v1.2 | 0/TBD | Not started | - |
| 24. Checklist Bug Fixes + Audit | v1.2 | Complete    | 2026-03-04 | 2026-03-04 |
| 25. Smart Forwarding + Filing Feedback | 2/3 | In Progress|  | - |

### Action Items (Non-Code)
| Item | Owner | Status |
|------|-------|--------|
| SPF/DKIM/DMARC setup on venturemortgages.com | Taylor (DNS registrar) | NOT DONE -- emails may go to spam |
| Confirm Finmo "smart docs" stays OFF (no overlap) | Taylor | Confirmed OFF (2026-02-21) |

### Phase 23: Forwarding notes parsing and backfill script fix

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 22
**Plans:** 0/0 plans complete

Plans:
- [ ] TBD (run /gsd:plan-phase 23 to break down)

### Phase 24: Fix checklist engine bugs and comprehensive rule coverage

**Goal:** Fix all 9 known bugs in the checklist engine and CRM contact handling, activate dormant auto-detectable rules, harden fragile detection patterns, and audit every Finmo UI field for complete rule coverage
**Requirements**: BUG-01, BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-07, BUG-08, BUG-09, AUDIT-01
**Depends on:** Phase 23
**Plans:** 3/3 plans complete

Plans:
- [x] 24-01-PLAN.md -- Fix checklist engine bugs 1-5 and 7 (per-property eval, empty assets DP, gift detection, pension/CPP/OAS, dormant rules, rental use types)
- [x] 24-02-PLAN.md -- Fix CRM bugs 8-9 (borrower contact type, professional sync)
- [x] 24-03-PLAN.md -- Comprehensive field audit and BUG 6 documentation

### Phase 25: Smart Forwarding Notes & Filing Feedback

**Goal:** Fix the three cascading failures exposed by Cat's Wong-Ranasinghe forwarded email: replace the regex forwarding note parser with AI, add Drive folder fuzzy matching before auto-creating new folders, and send a filing confirmation email back to the sender (Cat or dev@) so they know what happened.
**Requirements**: FWD-01 (AI note parsing), FWD-02 (Drive folder matching), FWD-03 (confirmation email), FWD-04 (link existing folders to CRM contacts)
**Depends on:** Phase 24
**Plans:** 2/3 plans executed

Plans:
- [ ] 25-01-PLAN.md -- AI forwarding note parser + intake worker per-attachment assignment + Wong-Ranasinghe data fix
- [ ] 25-02-PLAN.md -- Drive folder fuzzy matching before auto-create
- [ ] 25-03-PLAN.md -- Filing confirmation email to sender (in-thread reply)

---
*Roadmap created: 2026-02-09*
*Last updated: 2026-03-06 (Phase 25 planned -- 3 plans in 2 waves)*
