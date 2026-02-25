# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** When a Finmo application comes in, the right documents get requested, tracked, filed, and followed up on — with minimal human effort and zero missed items.
**Current focus:** Milestone v1.1 — Production Hardening

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-02-25 — Milestone v1.1 started

## Performance Metrics

**Velocity (v1.0):**
- Total plans completed: 31
- Average duration: 4 min
- Total execution time: 2.15 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 03-checklist-generation | 4/4 | 21 min | 5 min |
| 04-crm-integration | 4/4 | 14 min | 4 min |
| 05-email-drafting | 2/2 | 7 min | 4 min |
| 01-webhook-foundation | 3/3 | 12 min | 4 min |
| 06-document-intake | 4/4 | 17 min | 4 min |
| 07-classification-filing | 5/5 | 20 min | 4 min |
| 08-tracking-integration | 2/2 | 10 min | 5 min |
| 10-opportunity-centric-architecture | 5/5 | 19 min | 4 min |
| 11-drive-folder-linking-deal-subfolders | 3/3 | 8 min | 3 min |

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
- MockOAuth2 class instead of vi.fn().mockImplementation for constructor mocking (Vitest 4 requires class-based constructors)
- SUBFOLDER_NAMES as Partial<Record> lookup for clean resolveTargetFolder branching
- Best-effort client folder resolution via CRM contact lookup with driveRootFolderId fallback (Phase 8 adds precise mapping)
- CRM task creation failure during low-confidence review is non-fatal (logged, not thrown)
- Temp file written to OS tmpdir before classification enqueue; queue job data contains path only (no buffer in Redis)
- MockQueue class-based constructor for Vitest 4 compatibility (arrow functions break constructor mocking)
- MissingDocEntry stage type includes LENDER_CONDITION (matches full ChecklistStage union)
- Three-tier matching strategy for doc-type matcher: label prefix > contains (>=3 chars) > known aliases
- missingDocs CRM field stores MissingDocEntry[] (structured with stage) instead of string[]
- mapChecklistToDocNames kept as-is (backward compat); new mapChecklistToDocEntries added alongside
- Notes attributed to Cat's userId for CRM timeline visibility
- LATER/CONDITIONAL/LENDER_CONDITION stage docs don't increment PRE or FULL counters
- Tracking call in classification worker wrapped in own try/catch (non-fatal to filing)
- parseContactTrackingFields exported as pure function for independent testability
- Legacy API (POST /locations/:locationId/customFields) with model='opportunity' for opportunity-scoped field creation (V2 API only supports Custom Objects and Company)
- Separate "Doc Tracking" field group on opportunities (not reusing contact-level "Finmo Integration" group)
- ReadonlySet<string> annotation to widen as-const literal union for Set.has() compatibility
- Contact upsert excludes doc tracking custom fields when opportunity is the tracking target (clean separation)
- Opportunity field update failure triggers contact-level fallback (belt-and-suspenders reliability)
- finmoApplicationId is the same UUID as applicationId from webhook job data
- Vitest 4 clearAllMocks resets mock implementations (unlike Jest), requiring explicit re-setup in beforeEach
- PROPERTY_SPECIFIC_TYPES imported from drive/doc-expiry.ts (single source of truth for single-deal vs cross-deal routing)
- Audit note created on contact (not opportunity) because GHL notes are contact-scoped
- PRE readiness task fires once per doc receipt even when updating multiple opportunities
- ambiguous-deal returns updated:false (safe failure) rather than guessing which opportunity
- Contact-level fallback in tracking-sync preserves backward compat for clients without opportunities
- firstMatchedDocName tracked via loop variable for efficient audit note (no re-fetch needed)
- finmoApplicationId sourced from finmoApp.application.id (canonical) in webhook worker
- Deprecated functions (upsertOpportunity, moveToCollectingDocs, moveToAllDocsReceived) kept in opportunities.ts for direct import by sent-detector.ts, removed from barrel
- Contact-level fieldIds validation downgraded from throw to warning (deprecated, fallback-only)
- Setup script --deprecate-contact-fields renames via PUT API (field IDs remain valid after rename)
- Drive folder field defs are standalone constants (not part of DOC_TRACKING or OPP_DOC_TRACKING arrays)
- driveFolderIdFieldId and oppDealSubfolderIdFieldId are top-level on CrmConfig (span contact/opportunity models)
- Validation warns but does not throw for missing drive folder field IDs (same pattern as opportunity field warnings)
- Folder ID persistence uses upsertContact with customFields to store clientFolderId on contact before CRM sync step
- Deal subfolder name derived from opportunity name via extractDealReference (lastIndexOf ' - ' pattern)
- Dual-scan merges client + deal folder docs with spread operator before filtering
- All CRM persistence operations wrapped in non-fatal try/catch (failures must not block pipeline)
- Contact fetched once via getContact and shared with tracking-sync via prefetchedContact (saves one API call per classification job)
- Property-specific vs reusable routing in classification worker uses PROPERTY_SPECIFIC_TYPES from drive/doc-expiry.ts (single source of truth)
- getContact failure in classification worker is non-fatal, falls back to DRIVE_ROOT_FOLDER_ID
- Deal subfolder resolution only attempted when both contactId and applicationId are present
- extractDriveFolderId normalizes both raw IDs and full Drive URLs to folder IDs (fixes "File not found: ." error)

### Pending Todos

None yet.

### Blockers/Concerns

- SPF/DKIM/DMARC not configured on venturemortgages.com — emails may go to spam (Taylor action item)
- Google Sheets API scope missing from domain-wide delegation — budget sheet broken
- 2+ [TEST] opportunities in MBP need cleanup

## Session Continuity

Last session: 2026-02-25 (milestone v1.1 initialization)
Stopped at: Defining requirements
Resume file: None
Next: Define v1.1 requirements and roadmap

---
*State initialized: 2026-02-09*
*Last updated: 2026-02-25 (milestone v1.1 started)*
