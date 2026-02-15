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
- [ ] **Phase 7: Classification & Filing** - Classify, rename, convert, and file docs to Google Drive
- [ ] **Phase 8: Tracking Integration** - Update checklist status and notify on PRE-readiness
- [ ] **Phase 9: Automated Reminders** - Context-aware follow-ups for missing documents (disabled by default)

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
**Plans**: TBD

Plans:
- [ ] 08-01: TBD during planning

### Phase 9: Automated Reminders
**Goal**: System generates context-aware reminder drafts for clients with missing documents (disabled by default)
**Depends on**: Phase 8
**Requirements**: REMIND-01, REMIND-02, REMIND-03, REMIND-04
**Success Criteria** (what must be TRUE):
  1. Scheduled job infrastructure exists to check for clients with missing documents (e.g., 3 days, 7 days after initial request)
  2. Generated reminder email references specific missing documents by name (not generic "you have missing docs")
  3. Reminders are disabled by default (global toggle OFF plus per-client toggle capability)
  4. When Cat enables reminders for a client, reminder emails are drafted for Cat's review before sending (not auto-sent)
**Plans**: TBD

Plans:
- [ ] 09-01: TBD during planning

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
| 7. Classification & Filing | 0/5 | Planned | - |
| 8. Tracking Integration | 0/TBD | Not started | - |
| 9. Automated Reminders | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-09*
*Last updated: 2026-02-14 (Phase 6 complete)*
