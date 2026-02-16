---
phase: 07-classification-filing
plan: 05
subsystem: classification
tags: [bullmq, google-drive, crm, pipeline, worker, barrel-export]

# Dependency graph
requires:
  - phase: 07-02
    provides: Finmo document download pipeline
  - phase: 07-03
    provides: Classifier, naming, router modules
  - phase: 07-04
    provides: Drive client and filer module
provides:
  - Classification worker orchestrating full pipeline (classify -> name -> route -> file)
  - Intake worker wired to classification queue (temp file + enqueue)
  - Barrel export for all classification module public API
  - Low-confidence -> CRM manual review task (FILE-05)
  - Existing file versioning (FILE-04)
affects: [08-tracking-integration, entry-point, graceful-shutdown]

# Tech tracking
tech-stack:
  added: []
  patterns: [classification-pipeline, temp-file-enqueue, barrel-export]

key-files:
  created:
    - src/classification/classification-worker.ts
    - src/classification/index.ts
    - src/classification/__tests__/classification-worker.test.ts
  modified:
    - src/intake/intake-worker.ts
    - src/intake/index.ts
    - src/intake/__tests__/intake-worker.test.ts

key-decisions:
  - "Best-effort client folder resolution via CRM contact lookup with driveRootFolderId fallback"
  - "CRM task creation failure during low-confidence review is non-fatal (logged, not thrown)"
  - "Temp file written before enqueue; classification queue job contains path only (no buffer in Redis)"
  - "MockQueue class-based constructor for Vitest 4 compatibility in intake worker tests"

patterns-established:
  - "Pipeline worker pattern: per-stage try/catch with temp file cleanup in all paths"
  - "Classification queue enqueue pattern: writeFile + Queue.add with jobId dedup"

# Metrics
duration: 4min
completed: 2026-02-15
---

# Phase 7 Plan 5: Classification Worker & Integration Summary

**BullMQ classification worker orchestrating full pipeline (classify -> name -> route -> file to Drive) with low-confidence manual review routing and temp file enqueue from intake**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-16T02:01:23Z
- **Completed:** 2026-02-16T02:05:40Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Classification worker processes doc-classification queue jobs with full pipeline: read temp file -> classify via Claude -> check confidence -> generate filename -> route to subfolder -> file to Drive
- Low-confidence classifications (below threshold) create CRM manual review task for Cat (FILE-05)
- Existing files are updated instead of duplicated for versioning (FILE-04)
- Intake worker (both Gmail and Finmo sources) now writes PDFs to temp files and enqueues ClassificationJobData to classification queue
- Barrel export at src/classification/index.ts provides clean import surface for Phase 8
- 354 total tests pass (11 new classification worker + 343 existing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create classification worker with full pipeline orchestration** - `c8e1fc1` (feat)
2. **Task 2: Update intake worker to enqueue to classification queue and create barrel export** - `f67cb36` (feat)

## Files Created/Modified
- `src/classification/classification-worker.ts` - BullMQ worker processing doc-classification queue, orchestrates classify -> name -> route -> file pipeline
- `src/classification/index.ts` - Barrel export for all classification module public API (types, config, classifier, naming, router, drive-client, filer, worker)
- `src/classification/__tests__/classification-worker.test.ts` - 11 tests covering full pipeline, low confidence, versioning, error handling, temp file cleanup
- `src/intake/intake-worker.ts` - Added temp file writing and classification queue enqueue for both Gmail and Finmo sources
- `src/intake/index.ts` - Added closeClassificationQueue export
- `src/intake/__tests__/intake-worker.test.ts` - Updated mocks for Queue, fs, crypto, classification-worker imports

## Decisions Made
- Best-effort client folder resolution: looks up contact via CRM email search, falls back to driveRootFolderId, routes to manual review if neither available. Phase 8 will add Drive folder ID as CRM custom field for precise resolution.
- CRM task creation failures during low-confidence manual review routing are caught and logged without crashing the pipeline (non-fatal).
- Temp files written to OS tmpdir with randomUUID filenames before enqueue; classification queue job data contains only the path (no buffer in Redis).
- Used class-based MockQueue constructor in intake worker tests (Vitest 4 requires `class` or `function` keyword for constructor mocks, not arrow functions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Vitest 4 Queue constructor mock**
- **Found during:** Task 2 (intake worker test updates)
- **Issue:** `vi.fn(() => mockQueue)` arrow function mock fails in Vitest 4 — "The vi.fn() mock did not use 'function' or 'class' in its implementation"
- **Fix:** Used `class MockQueue` pattern with instance methods matching Queue API
- **Files modified:** src/intake/__tests__/intake-worker.test.ts
- **Verification:** All 14 intake worker tests pass
- **Committed in:** f67cb36 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Fix necessary for test compatibility with Vitest 4. No scope creep.

## Issues Encountered
None beyond the Vitest mock pattern fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full Phase 7 classification & filing pipeline complete
- End-to-end flow wired: Gmail/Finmo intake -> temp file -> classification queue -> classify -> name -> route -> file to Drive (or CRM manual review)
- Barrel export provides clean import surface for Phase 8 (tracking integration)
- Runtime requirements: ANTHROPIC_API_KEY, DRIVE_ROOT_FOLDER_ID, Google credentials, CRM API key
- Phase 8 should add Drive folder ID as CRM custom field for precise client folder resolution

## Self-Check: PASSED

All 6 files verified present. Both task commits (c8e1fc1, f67cb36) verified in git log. 354 tests pass.

---
*Phase: 07-classification-filing*
*Completed: 2026-02-15*
