# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-09)

**Core value:** When a Finmo application comes in, the right documents get requested, tracked, filed, and followed up on — with minimal human effort and zero missed items.
**Current focus:** Phase 4 - CRM Integration (COMPLETE)

## Current Position

Phase: 4 of 9 (CRM Integration)
Plan: 4 of 4 complete
Status: Phase Complete
Last activity: 2026-02-14 — Completed 04-04 (CRM orchestrator + test suite)

Progress: [████████░░] 73%

## Performance Metrics

**Velocity:**
- Total plans completed: 8
- Average duration: 4 min
- Total execution time: 0.58 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 03-checklist-generation | 4/4 | 21 min | 5 min |
| 04-crm-integration | 4/4 | 14 min | 4 min |

**Recent Trend:**
- Last 5 plans: 03-04 (8 min), 04-01 (5 min), 04-02 (3 min), 04-03 (2 min), 04-04 (4 min)
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

**Phase 5 (Email Drafting):**
- OAuth delegation setup for Gmail/Drive needs confirmation (service account vs user OAuth)

**Phase 7 (Classification & Filing):**
- Decision needed: reuse existing mortgage.ai PDF classification code or build new classifier

## Session Continuity

Last session: 2026-02-14 (plan execution)
Stopped at: Completed 04-04-PLAN.md — CRM orchestrator + test suite (Phase 4 complete)
Resume file: None
Next: Phase 5 (Email Drafting) or next priority phase

---
*State initialized: 2026-02-09*
*Last updated: 2026-02-14 (04-04 complete, Phase 4 complete)*
