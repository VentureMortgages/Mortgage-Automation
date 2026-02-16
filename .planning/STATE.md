# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-09)

**Core value:** When a Finmo application comes in, the right documents get requested, tracked, filed, and followed up on — with minimal human effort and zero missed items.
**Current focus:** Phase 7 - Classification & Filing (IN PROGRESS)

## Current Position

Phase: 7 of 9 (Classification & Filing)
Plan: 3 of 5 complete
Status: In Progress
Last activity: 2026-02-16 — Completed 07-03 (Classifier, naming, router)

Progress: [████████░░] 86%

## Performance Metrics

**Velocity:**
- Total plans completed: 20
- Average duration: 4 min
- Total execution time: 1.38 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 03-checklist-generation | 4/4 | 21 min | 5 min |
| 04-crm-integration | 4/4 | 14 min | 4 min |
| 05-email-drafting | 2/2 | 7 min | 4 min |
| 01-webhook-foundation | 3/3 | 12 min | 4 min |
| 06-document-intake | 4/4 | 17 min | 4 min |
| 07-classification-filing | 3/5 | 12 min | 4 min |

**Recent Trend:**
- Last 5 plans: 06-03 (3 min), 06-04 (6 min), 07-01 (4 min), 07-02 (4 min), 07-03 (4 min)
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

- Used union types with string fallback for Finmo enum fields (forward compatibility with unknown API values)
- Added FinmoAddress and FinmoAddressSituation types beyond plan spec (needed for property descriptions)
- Type-only barrel exports to ensure no runtime code in type module
- Extracted ChecklistStage and ChecklistScope as named type aliases for reuse
- Getter displayName on rules for dynamic tax year rendering at evaluation time
- Sole prop vs incorporated detection with safe fallback (request both if uncertain)
- Dormant rules for non-detectable sections (maternity, probation, stated income, bankruptcy, residency)
- 103 total rules faithful to every item in DOC_CHECKLIST_RULES_V2 (vs plan estimate of 80-90)
- Added stats field to GeneratedChecklist interface (needed for CRM/logging downstream consumers)
- Property descriptions built from address data with cascading fallbacks
- per_property rules evaluated using main borrower context
- Empty property checklists omitted from output
- resolveJsonModule added to tsconfig for typed JSON test fixture imports
- Vite resolver plugin for .js-to-.ts resolution in Vitest 4 (NodeNext compat)
- getTaxYears tested directly for dynamic behavior (displayName getters use new Date(), not context date)
- Inline fixture modification pattern (spread + override) for edge case test variants
- Used named import { HighLevel } instead of default import (CJS module compat with NodeNext)
- Raw fetch for setup scripts instead of SDK (SDK CreateCustomFieldsDTO missing parentId/picklistOptions)
- Config allows empty strings for IDs populated by setup scripts (validates at runtime, not config load)
- Created shared errors.ts module for CRM error types (reused by contacts, tasks, opportunities modules)
- Raw fetch for all CRM operations (consistent with setup scripts; SDK types incomplete for some endpoints)
- Finmo-managed fields stripped via ReadonlySet filter in contacts.ts (programmatic guard, not docs-only)
- Config-as-parameter pattern for mapper functions (pure, no module-level config imports)
- CrmConfig imported from config.js not types/index.js (corrected plan's import path)
- Eager dotenv loading in barrel export acceptable for server-side Node.js runtime
- Optional checklistSummary parameter added to createReviewTask (backward-compatible extension)
- SyncChecklistResult uses optional fields + errors array for partial failure reporting
- Noon UTC timestamps (T12:00:00Z) in date tests to prevent timezone-related day-of-week shifts
- Section-based body generation (array of sections joined by blank lines) for clean email formatting
- Named constants for intro and closing paragraphs (easy for Cat to edit wording)
- Body uses \n internally; MIME encoder converts to CRLF (separation of concerns)
- Test greeting assertion checks greeting line only, not full body (avoids false positives)
- Lazy singleton for Gmail client (cached after first init, same pattern as CRM client)
- GmailAuthError with code property for typed auth error detection in INFRA-05 alerting
- Internal Gmail client functions not exported from barrel (implementation detail encapsulation)
- loadServiceAccountKey validates client_email and private_key after base64 decode
- Arrays replaced with [Array(N)] summaries in sanitizer (security: arrays may contain PII objects)
- firstName/lastName excluded from PII_FIELDS (needed for borrower identification in structured logs)
- ReadonlySet for PII_FIELDS (immutable at runtime, prevents accidental modification)
- Depth limit of 10 for sanitizer recursion guard
- Redis URL parsed into config object instead of ioredis instance (avoids version mismatch with bullmq's bundled ioredis)
- No top-level ioredis dependency — bullmq bundles its own internally
- vi.hoisted() for mock variables in Vitest 4 (factory functions hoisted above const declarations)
- extractApplicationId exported for direct unit testing of payload shape handling
- createApp factory pattern for Express test isolation (fresh instance per test)
- processJob exported directly for unit testing without BullMQ Worker infrastructure
- Single process for server + worker (appropriate for <10 webhooks/day scale)
- Shutdown order: HTTP server -> worker -> queue (prevents orphan connections)
- Worker concurrency 1 (sequential processing, sufficient for current volume)
- Kill switch checked at both webhook and worker layers (belt-and-suspenders defense)
- Map-based client cache replacing single-variable singleton for multi-scope/multi-user Gmail clients
- loadServiceAccountKey extracted as shared helper for both compose and readonly client creation
- OAuth2 mode warning (not error) when impersonateAs differs from token user — fails at API call time
- ConversionStrategy as union type (not enum) for consistency with project's type patterns
- Buffer-to-Uint8Array conversion before pdf-lib embed calls (pdf-lib marker scanning fails on Node.js Buffer)
- Word documents throw ConversionError instead of auto-converting (LibreOffice system dep deferred)
- Minimal valid JPEG/PNG hex fixtures for deterministic tests (no external test image files)
- Gmail client passed as parameter to reader functions (pure, testable without module mocking)
- Stale historyId detected by HTTP 404 or 'notFound' in error message (Gmail returns either)
- Parallel fallback: messages.list + getProfile called with Promise.all on stale historyId
- Parts without filename skipped in attachment extraction (inline text/HTML are not file attachments)
- Default mimeType to application/octet-stream when MIME part has no mimeType field
- ioredis added as direct dependency for Redis key-value access (historyId persistence, overriding earlier "no top-level ioredis" decision)
- Named import { Redis as IORedis } for NodeNext module compat (default export not constructable)
- Finmo handler uses fire-and-forget queue.add with .then/.catch (respond 202 immediately)
- processIntakeJob catches ConversionError per-attachment without failing the whole job
- IntakeDocument objects logged then discarded (Phase 7 will consume them via classification queue)
- Zod v4 (4.3.6) installed as dependency of @anthropic-ai/sdk, compatible with zodOutputFormat helper
- 36 document types (not 33 as estimated) covering all mortgage doc categories from DRIVE_STRUCTURE analysis
- driveRootFolderId optional in config (populated by setup script or env var, not required at load time)
- Kill switch at config level (CLASSIFICATION_ENABLED=false) following same pattern as webhook kill switch
- Redis set (SISMEMBER/SADD) for Finmo dedup instead of key-value (simpler atomic membership check, no expiry needed)
- Defensive signed URL extraction checks url/signedUrl/downloadUrl fields (Finmo response shape undocumented)
- Per-file error catching in downloadFinmoDocument (one bad file does not abort remaining downloads)
- Mark doc request processed even with partial errors (prevent infinite re-processing loops)
- zodOutputFormat takes single argument (Zod schema) in @anthropic-ai/sdk v0.74.0 (plan referenced two-arg version)
- Classifier validates response with ClassificationResultSchema.parse() after JSON.parse (belt-and-suspenders)
- Person subfolder names use first name only per Drive conventions (Terry/, Kathy/, Susan/)
- sanitizeFilename preserves $, +, () characters that appear in Cat's naming (e.g., $630k+)

### Pending Todos

None yet.

### Blockers/Concerns

**Phase 2 (CRM Exploration):**
- Need to confirm MyBrokerPro credentials work and explore existing setup before designing integration
- Subfolder structure inside client Drive folders needs documentation

**Phase 3 (Checklist Generation):** COMPLETE
- All edge cases tested: multi-income dedup, empty borrowers, unknown income types, minimal data
- 58 integration tests pass covering all CHKL requirements

**Phase 4 (CRM Integration):** COMPLETE
- All 4 plans executed: foundation, services, mapper, orchestrator + tests
- 93 total tests pass (35 CRM-specific + 58 checklist)
- syncChecklistToCrm ready for Phase 1 webhook handler
- CRM setup scripts must be run against live CRM before runtime operations work

**Phase 5 (Email Drafting):** COMPLETE
- All 2 plans executed: email body/MIME + Gmail API integration
- 124 total tests pass (31 email + 93 CRM/checklist)
- createEmailDraft and sendEmailDraft ready for Phase 1 webhook handler
- Gmail API requires service account setup before live testing (GCP project, delegation, env var)

**Phase 1 (Webhook Foundation):** COMPLETE
- 01-01 complete: shared config, webhook types, PII sanitizer (28 tests)
- 01-02 complete: Express webhook receiver, BullMQ queue, health check (16 tests)
- 01-03 complete: Finmo client, worker pipeline orchestrator, entry point (14 tests)
- 183 total tests pass (58 webhook + 125 prior)
- Full pipeline: webhook POST -> BullMQ -> worker -> Finmo API -> checklist -> CRM -> email draft

**Phase 6 (Document Intake):** COMPLETE
- 06-01 complete: intake types, config, Gmail readonly client (0 new tests, 183 existing pass)
- 06-02 complete: PDF converter with pdf-lib, TDD (15 new tests, 198 total pass)
- 06-03 complete: Gmail reader & attachment extractor (25 new tests, 223 total pass)
- 06-04 complete: Gmail monitor, Finmo handler, intake worker, barrel (18 new tests, 241 total pass)
- Full intake pipeline: Gmail polling -> message processing -> attachment download -> PDF conversion -> IntakeDocument
- Finmo document webhook handler with dedup; actual file download deferred (API undocumented)
- Barrel export at src/intake/index.ts provides clean import surface for Phase 7

**Phase 7 (Classification & Filing):** IN PROGRESS
- 07-01 complete: classification types, Zod schema, config (0 new tests, 241 existing pass)
- 07-02 complete: Finmo document download pipeline (29 new tests, 270 total pass)
- 07-03 complete: classifier, naming, router TDD (42 new tests, 312 total pass)
- @anthropic-ai/sdk + zod installed; DOCUMENT_TYPES (36), SUBFOLDER_ROUTING, DOC_TYPE_LABELS ready
- ClassificationConfig with Anthropic API key, model, confidence threshold, Drive settings, kill switch
- finmo-downloader.ts: listDocRequests, getDocRequestDetail, getSignedDownloadUrl, downloadFinmoFile
- processFinmoSource now real implementation (dedup -> download -> convert -> IntakeDocument)
- classifyDocument: Claude Haiku 4.5 with structured output, PDF truncation, filename hint
- generateFilename: Cat's naming convention (Name - DocType [Institution] [Year] [Amount].pdf)
- routeToSubfolder: maps all 36 doc types to correct Drive subfolder target
- ANTHROPIC_API_KEY required for classifier; DRIVE_ROOT_FOLDER_ID for filer (Plan 04)

## Session Continuity

Last session: 2026-02-16 (plan execution)
Stopped at: Completed 07-03-PLAN.md — Classifier, naming, router
Resume file: None
Next: 07-04-PLAN.md (Drive filer)

---
*State initialized: 2026-02-09*
*Last updated: 2026-02-16 (07-03 complete, Classifier, naming, router)*
