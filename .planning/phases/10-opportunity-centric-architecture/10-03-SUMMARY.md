---
phase: 10-opportunity-centric-architecture
plan: 03
subsystem: crm
tags: [ghl, opportunities, doc-tracking, checklist-sync]

# Dependency graph
requires:
  - phase: 10-01
    provides: "Opportunity API functions (findOpportunityByFinmoId, updateOpportunityFields, updateOpportunityStage)"
  - phase: 10-02
    provides: "Opportunity-scoped doc tracking field IDs in .env (GHL_OPP_FIELD_*)"
provides:
  - "syncChecklistToCrm writes doc tracking to opportunity instead of contact"
  - "SyncChecklistInput.finmoApplicationId for opportunity lookup"
  - "SyncChecklistResult.trackingTarget for downstream consumers to know where tracking lives"
  - "Contact fallback when no opportunity found (backward compat)"
affects: [10-04, 10-05, webhook-worker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Opportunity-first tracking with contact fallback"
    - "Separate fieldIds configs for contact vs opportunity scope"

key-files:
  created: []
  modified:
    - "src/crm/checklist-sync.ts"
    - "src/crm/__tests__/checklist-sync.test.ts"
    - "src/webhook/worker.ts"
    - "src/webhook/__tests__/worker.test.ts"

key-decisions:
  - "Contact upsert gets borrower details only (no doc tracking fields) when opportunity is used"
  - "Opportunity field update failure triggers contact-level fallback (belt-and-suspenders)"
  - "finmoApplicationId passed from worker.ts (same UUID as applicationId from job data)"

patterns-established:
  - "Opportunity-first tracking: try opportunity, fall back to contact"
  - "Re-set mock return values in beforeEach after clearAllMocks (Vitest 4 resets implementations)"

requirements-completed: [OPP-01, OPP-02, OPP-06, OPP-08]

# Metrics
duration: 4min
completed: 2026-02-21
---

# Phase 10 Plan 03: Checklist Sync Refactor Summary

**syncChecklistToCrm now writes doc tracking fields to Finmo's existing opportunity via findOpportunityByFinmoId, with automatic contact-level fallback**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-21T23:25:09Z
- **Completed:** 2026-02-21T23:29:46Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Refactored syncChecklistToCrm to write doc tracking to opportunity instead of contact
- Added finmoApplicationId to SyncChecklistInput for opportunity lookup
- Contact fallback preserves backward compatibility when no opportunity found
- 26 tests covering opportunity-found, contact-fallback, and all error paths
- Full test suite passes (679 tests, 46 files)

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor checklist-sync.ts for opportunity-level tracking** - `ec9d777` (feat)
2. **Task 2: Update checklist-sync tests for opportunity-level tracking** - `2b4628e` (test)

## Files Created/Modified
- `src/crm/checklist-sync.ts` - Core orchestrator: finds opportunity, writes doc tracking there, falls back to contact
- `src/crm/__tests__/checklist-sync.test.ts` - 26 tests verifying opportunity and contact paths
- `src/webhook/worker.ts` - Passes finmoApplicationId to syncChecklistToCrm
- `src/webhook/__tests__/worker.test.ts` - Updated mock for trackingTarget and finmoApplicationId

## Decisions Made
- Contact upsert excludes doc tracking custom fields when opportunity is the tracking target (clean separation of concerns)
- When opportunity field update fails, falls back to contact-level tracking rather than leaving tracking nowhere (belt-and-suspenders reliability)
- finmoApplicationId is the same UUID as applicationId from webhook job data (Finmo stores this on the opportunity custom field)
- Re-set mock return values in beforeEach because Vitest 4 clearAllMocks resets implementations (unlike Jest)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated worker.test.ts mock for new SyncChecklistResult shape**
- **Found during:** Task 1 (checklist-sync refactor)
- **Issue:** Worker test mock for createMockCrmResult lacked new trackingTarget field, causing TypeScript error
- **Fix:** Added `trackingTarget: 'opportunity'` to the mock result
- **Files modified:** src/webhook/__tests__/worker.test.ts
- **Verification:** npx tsc --noEmit passes
- **Committed in:** ec9d777 (Task 1 commit)

**2. [Rule 1 - Bug] Updated worker.ts to pass finmoApplicationId**
- **Found during:** Task 1 (checklist-sync refactor)
- **Issue:** Worker was not passing the new finmoApplicationId field to syncChecklistToCrm, meaning opportunity lookup would never execute
- **Fix:** Added `finmoApplicationId: applicationId` to the syncChecklistToCrm call
- **Files modified:** src/webhook/worker.ts
- **Verification:** Full test suite passes
- **Committed in:** ec9d777 (Task 1 commit)

**3. [Rule 1 - Bug] Updated worker.test.ts assertion for finmoApplicationId in CRM call**
- **Found during:** Task 2 (test updates)
- **Issue:** Worker test expected exact args for syncChecklistToCrm but missing finmoApplicationId
- **Fix:** Added `finmoApplicationId: 'app-123'` to the expected call args
- **Files modified:** src/webhook/__tests__/worker.test.ts
- **Verification:** Full test suite passes (679/679)
- **Committed in:** 2b4628e (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 bugs)
**Impact on plan:** All fixes necessary for correctness. Worker integration was implied by the plan but not explicitly listed as a task. No scope creep.

## Issues Encountered
- Vitest 4 `clearAllMocks()` resets mock implementations (not just call history), requiring explicit re-setup in beforeEach. Solved by adding mock return value setup in the describe-level beforeEach.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- syncChecklistToCrm is now opportunity-centric, ready for Plan 10-04 (tracking-sync refactor)
- Plan 10-05 can safely remove deprecated moveToCollectingDocs since it is no longer imported by checklist-sync
- All 679 tests pass, TypeScript clean

---
*Phase: 10-opportunity-centric-architecture*
*Completed: 2026-02-21*
