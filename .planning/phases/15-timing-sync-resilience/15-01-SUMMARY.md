---
phase: 15-timing-sync-resilience
plan: 01
subsystem: crm
tags: [ghl-tasks, retry, drive-subfolder, bullmq, failure-visibility]

# Dependency graph
requires:
  - phase: 10-opportunity-centric-architecture
    provides: CRM retry flow with processCrmRetry and retry scheduling
  - phase: 11-drive-folder-linking-deal-subfolders
    provides: Deal subfolder creation and findOrCreateFolder
  - phase: 13-original-document-preservation
    provides: preCreateSubfolders for standard subfolder pre-creation
provides:
  - createFailureTask reusable helper for any pipeline failure CRM task
  - CRM task on retry exhaustion so Cat has visibility into sync failures
  - Deal subfolder catch-up on retry success when initial webhook had null dealSubfolderId
affects: [15-timing-sync-resilience]

# Tech tracking
tech-stack:
  added: []
  patterns: [non-fatal failure task pattern, subfolder catch-up on retry]

key-files:
  created: []
  modified:
    - src/crm/tasks.ts
    - src/crm/index.ts
    - src/crm/__tests__/tasks.test.ts
    - src/webhook/worker.ts
    - src/webhook/__tests__/worker.test.ts

key-decisions:
  - "createFailureTask is non-fatal (catches all errors, returns undefined) to match existing CRM task patterns"
  - "Deal subfolder catch-up guarded on DRIVE_ROOT_FOLDER_ID being set to avoid undefined parent folder"
  - "Subfolder catch-up uses actualDealSubfolderId variable to thread created folder ID through to link step"

patterns-established:
  - "createFailureTask: generic non-fatal CRM task creator for pipeline failures, reusable beyond retry exhaustion"

requirements-completed: [SYNC-01, SYNC-02]

# Metrics
duration: 4min
completed: 2026-03-02
---

# Phase 15 Plan 01: CRM Retry Failure Visibility Summary

**createFailureTask helper for Cat-visible CRM tasks on pipeline failures, wired into retry exhaustion with deal subfolder catch-up on retry success**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-02T23:38:56Z
- **Completed:** 2026-03-02T23:42:43Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- createFailureTask: reusable, non-fatal CRM task creator assigned to Cat with devPrefix title and 1 business day due date
- Retry exhaustion now creates actionable CRM task for Cat with client name, Finmo deal ID, and verification instructions
- Deal subfolder catch-up: creates subfolder retroactively when retry succeeds with null dealSubfolderId
- All 836 tests passing (8 new: 4 for createFailureTask, 4 for worker retry changes)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create createFailureTask helper in CRM tasks module** - `7370cb6` (feat)
2. **Task 2: Wire failure task into CRM retry exhaustion + deal subfolder catch-up** - `cb12b50` (feat)

## Files Created/Modified
- `src/crm/tasks.ts` - Added createFailureTask helper (non-fatal, assigned to Cat, devPrefix title)
- `src/crm/index.ts` - Added createFailureTask to barrel exports
- `src/crm/__tests__/tasks.test.ts` - 4 new tests for createFailureTask
- `src/webhook/worker.ts` - Wired failure task into exhaustion path, added subfolder catch-up on retry success
- `src/webhook/__tests__/worker.test.ts` - 4 new tests for exhaustion task + subfolder catch-up

## Decisions Made
- createFailureTask follows same non-fatal pattern as createOrUpdateReviewTask (catches all errors, returns undefined)
- Deal subfolder catch-up guarded on DRIVE_ROOT_FOLDER_ID to prevent undefined parent folder
- Used actualDealSubfolderId variable to thread caught-up folder ID through existing link code

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added driveRootFolderId guard to subfolder catch-up**
- **Found during:** Task 2 (subfolder catch-up implementation)
- **Issue:** Catch-up code used `driveRootFolderId!` without checking it was set, which would pass undefined to findOrCreateFolder
- **Fix:** Added `&& driveRootFolderId` to the catch-up guard condition
- **Files modified:** src/webhook/worker.ts
- **Verification:** Existing test "should not store subfolder link when dealSubfolderId is null" passes (no DRIVE_ROOT_FOLDER_ID set = no catch-up)
- **Committed in:** cb12b50 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Guard was necessary for correctness when DRIVE_ROOT_FOLDER_ID is not set. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- createFailureTask available for any future pipeline failure notification needs
- Ready for 15-02 (duplicate opportunity suppression, if planned)

---
*Phase: 15-timing-sync-resilience*
*Completed: 2026-03-02*
