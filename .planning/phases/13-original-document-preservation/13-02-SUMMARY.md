---
phase: 13-original-document-preservation
plan: 02
subsystem: classification
tags: [google-drive, originals, needs-review, safety-net, crm-tasks]

# Dependency graph
requires:
  - phase: 13-original-document-preservation
    plan: 01
    provides: storeOriginal function, CLIENT_SUBFOLDERS, findOrCreateFolder
  - phase: 07-classification-filing
    provides: classification-worker.ts, filer.ts (uploadFile, findOrCreateFolder)
provides:
  - Classification worker stores originals before filing (ORIG-01)
  - Low-confidence docs routed to Needs Review/ with Drive link in CRM task (ORIG-02)
  - Belt-and-suspenders try/catch around storeOriginal in success path
affects: [14-smart-document-matching]

# Tech tracking
tech-stack:
  added: []
  patterns: [Needs Review routing with Drive link in CRM task, belt-and-suspenders non-fatal wrapping]

key-files:
  created: []
  modified:
    - src/classification/classification-worker.ts
    - src/classification/__tests__/classification-worker.test.ts

key-decisions:
  - "storeOriginal wrapped in try/catch in classification worker (belt-and-suspenders) even though storeOriginal itself never throws"
  - "Low-confidence docs get both Needs Review/ copy AND Originals/ copy for full audit trail"
  - "CRM task includes direct Drive link (https://drive.google.com/file/d/{id}/view) for Cat to click"
  - "Original filename preserved in Needs Review/ (not classified name)"

patterns-established:
  - "Needs Review routing: findOrCreateFolder + uploadFile with original filename, then CRM task with Drive link"
  - "Low-confidence handler resolves client folder independently (same contact/root fallback pattern as success path)"

requirements-completed: [ORIG-01, ORIG-02]

# Metrics
duration: 4min
completed: 2026-03-02
---

# Phase 13 Plan 02: Wire Originals + Needs Review into Classification Worker Summary

**storeOriginal called before every filing, low-confidence docs routed to Needs Review/ with Drive link in CRM task for Cat**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-02T18:35:16Z
- **Completed:** 2026-03-02T18:39:09Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- ORIG-01: Every document gets a timestamped copy in Originals/ before classification/renaming (client folder level, non-fatal)
- ORIG-02: Low-confidence docs saved to Needs Review/ folder with original filename, CRM task includes Drive link for Cat
- Low-confidence docs also get Originals/ copy for full audit trail
- 11 new tests covering originals storage, Needs Review routing, graceful degradation, and call ordering
- All 767 tests passing across 47 test files, TypeScript clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Store original before classification filing + Needs Review routing** - `a08b316` (feat)
2. **Task 2: Add tests for originals storage and Needs Review routing** - `c222d70` (test)

## Files Created/Modified
- `src/classification/classification-worker.ts` - Added storeOriginal call before filing, replaced low-confidence handler with Needs Review routing
- `src/classification/__tests__/classification-worker.test.ts` - 11 new tests for ORIG-01 and ORIG-02, mocks for storeOriginal and findOrCreateFolder

## Decisions Made
- Belt-and-suspenders try/catch around storeOriginal in success path -- storeOriginal internally never throws, but the outer catch prevents any unexpected rejection from blocking filing
- Low-confidence docs get BOTH a Needs Review/ copy (for Cat to review) AND an Originals/ copy (for audit trail) -- cheap storage, maximum safety
- CRM task body includes both the filename and a clickable Drive link -- Cat can find the file without browsing folders
- Original filename used in Needs Review/ (not the classified/renamed filename) -- preserves what the client actually sent

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added try/catch around storeOriginal in success path**
- **Found during:** Task 2 (test for storeOriginal failure)
- **Issue:** Plan initially said no try/catch needed because storeOriginal never throws, but test mock with mockRejectedValue showed that a mock/edge case rejection would bubble up and break filing
- **Fix:** Added belt-and-suspenders try/catch with empty catch block around the storeOriginal call
- **Files modified:** src/classification/classification-worker.ts
- **Verification:** Test "continues filing when storeOriginal fails" now passes
- **Committed in:** c222d70 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential safety fix -- ensures originals storage truly cannot block filing under any circumstances. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 13 complete: originals safety net fully operational
- Every doc gets Originals/ copy before classification
- Low-confidence docs routed to Needs Review/ with CRM task for Cat
- Ready for Phase 14 (smart document matching) -- safety net makes AI matching safe to deploy

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 13-original-document-preservation*
*Completed: 2026-03-02*
