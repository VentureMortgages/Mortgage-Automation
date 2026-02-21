---
phase: 10-opportunity-centric-architecture
plan: 04
subsystem: crm
tags: [ghl, opportunities, doc-tracking, tracking-sync, cross-deal-reuse]

# Dependency graph
requires:
  - phase: 10-01
    provides: "Opportunity API functions (searchOpportunities, getOpportunity, updateOpportunityFields, updateOpportunityStage, getOpportunityFieldValue)"
  - phase: 10-03
    provides: "Checklist-sync writes doc tracking to opportunity (established opportunity-first pattern)"
provides:
  - "updateDocTracking reads/writes doc tracking fields on opportunities (not contacts)"
  - "parseOpportunityTrackingFields for opportunity-specific field format"
  - "Cross-deal document reuse: reusable docs update ALL open opportunities"
  - "Single-deal tracking: property-specific docs update only matched opportunity"
  - "Contact-level fallback when no open opportunities exist"
  - "ambiguous-deal error reason for unresolvable property-specific docs"
affects: [10-05, classification-worker, webhook-worker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PROPERTY_SPECIFIC_TYPES from doc-expiry.ts governs single-deal vs cross-deal routing"
    - "resolveTargetOpportunity matches by EXISTING_OPP_FIELDS.FINMO_APPLICATION_ID, single-opp fallback"
    - "PRE readiness task created once even for cross-deal updates (preTaskCreated flag)"
    - "Audit note on contact (once), not per-opportunity"

key-files:
  created: []
  modified:
    - "src/crm/tracking-sync.ts"
    - "src/crm/__tests__/tracking-sync.test.ts"
    - "src/crm/index.ts"

key-decisions:
  - "PROPERTY_SPECIFIC_TYPES imported from drive/doc-expiry.ts (not redefined) for single source of truth"
  - "Audit note created on contact (not opportunity) because notes are contact-scoped in GHL"
  - "PRE readiness task fired once per doc receipt even when updating 3+ opportunities"
  - "ambiguous-deal returns updated:false (safe failure) rather than guessing which opportunity"
  - "Contact-level fallback preserves backward compatibility for clients without opportunities"
  - "firstMatchedDocName tracked in loop variable (not re-fetched) for audit note efficiency"

patterns-established:
  - "Cross-deal reuse: non-property-specific docs fan out to all open opportunities"
  - "Property-specific resolution: Finmo App ID match > single-opp fallback > ambiguous error"
  - "Separate updateDocTrackingOnContact function encapsulates legacy contact path"

requirements-completed: [OPP-02, OPP-03, OPP-04, OPP-05, OPP-06]

# Metrics
duration: 6min
completed: 2026-02-21
---

# Phase 10 Plan 04: Tracking Sync Refactor Summary

**updateDocTracking reads/writes opportunity fields with cross-deal reuse for reusable docs and single-deal targeting for property-specific docs via PROPERTY_SPECIFIC_TYPES**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-21T23:32:58Z
- **Completed:** 2026-02-21T23:38:57Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Refactored updateDocTracking to read/write opportunity fields instead of contact fields
- Implemented cross-deal document reuse: reusable docs (T4, pay stub, bank statement, ID) update ALL open opportunities
- Property-specific docs (purchase agreement, MLS) update only the matched opportunity by Finmo Application ID
- Contact-level fallback preserves backward compatibility when no opportunities exist
- 36 tests covering opportunity-level, cross-deal, single-deal, ambiguous-deal, contact-fallback, and error paths
- Full test suite passes (692 tests, 46 files)

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor tracking-sync.ts for opportunity-level tracking** - `93b70b2` (feat)
2. **Task 2: Rewrite tracking-sync tests for opportunity-level tracking** - `08abe1e` (test)

## Files Created/Modified
- `src/crm/tracking-sync.ts` - Core orchestrator: reads/writes opportunity tracking fields, cross-deal reuse, contact fallback
- `src/crm/__tests__/tracking-sync.test.ts` - 36 tests covering all tracking paths and edge cases
- `src/crm/index.ts` - Added parseOpportunityTrackingFields to barrel export

## Decisions Made
- PROPERTY_SPECIFIC_TYPES imported from drive/doc-expiry.ts (single source of truth, not redefined)
- Audit note created on contact (not opportunity) since GHL notes are contact-scoped
- PRE readiness task fires once per doc receipt even when updating multiple opportunities
- ambiguous-deal returns updated:false (safe failure) rather than guessing which opportunity
- Contact-level fallback preserves backward compat for clients without opportunities
- firstMatchedDocName tracked via loop variable for efficient audit note (no re-fetch)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used wrong field ID constant in property-specific test**
- **Found during:** Task 2 (test writing)
- **Issue:** Test used hardcoded 'finmo-app-id-field' instead of EXISTING_OPP_FIELDS.FINMO_APPLICATION_ID
- **Fix:** Imported EXISTING_OPP_FIELDS and used the real constant
- **Files modified:** src/crm/__tests__/tracking-sync.test.ts
- **Verification:** All 36 tests pass
- **Committed in:** 08abe1e (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test correctness fix. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- tracking-sync is now opportunity-centric, ready for Plan 10-05 (cleanup + barrel exports)
- Classification worker still calls updateDocTracking with same interface (backward compatible)
- Plan 10-05 can safely remove deprecated moveToAllDocsReceived since tracking-sync now uses updateOpportunityStage directly
- All 692 tests pass, TypeScript clean (no new errors)

## Self-Check: PASSED
- All 4 files found (tracking-sync.ts, tracking-sync.test.ts, index.ts, 10-04-SUMMARY.md)
- Commit 93b70b2 found (Task 1)
- Commit 08abe1e found (Task 2)
- 692 tests pass, 46 test files
- TypeScript clean (no new errors)

---
*Phase: 10-opportunity-centric-architecture*
*Completed: 2026-02-21*
