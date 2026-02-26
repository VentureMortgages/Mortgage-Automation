---
phase: 12-crm-pipeline-automation
plan: 02
subsystem: crm
tags: [ghl, pipeline, opportunities, tasks, sent-detector]

# Dependency graph
requires:
  - phase: 12-01
    provides: "findReviewTask + completeTask in src/crm/tasks.ts"
  - phase: 10-opportunity-centric-architecture
    provides: "searchOpportunities + updateOpportunityStage in src/crm/opportunities.ts"
provides:
  - "Opportunity-level stage move in sent-detector (replaces deprecated upsert)"
  - "Review task auto-completion on doc-request email send"
affects: [12-crm-pipeline-automation, pipeline-stages]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Opportunity-level CRM operations in intake flow"]

key-files:
  created: []
  modified:
    - src/intake/sent-detector.ts
    - src/intake/__tests__/sent-detector.test.ts

key-decisions:
  - "Stage move uses searchOpportunities (first result) rather than findOpportunityByFinmoId since sent-detector lacks finmoApplicationId context"
  - "Review task auto-complete happens in same sent-detector flow (not a separate event handler)"

patterns-established:
  - "Non-fatal CRM operations in intake: try/catch with errors.push(), never block detection result"

requirements-completed: [PIPE-02, PIPE-03]

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 12 Plan 02: Sent-Detector Refactor Summary

**Opportunity-level stage move + review task auto-completion wired into BCC sent-detector flow**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-26T00:35:43Z
- **Completed:** 2026-02-26T00:37:43Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Replaced deprecated `moveToCollectingDocs` (upsert-based) with `searchOpportunities` + `updateOpportunityStage` (opportunity-level API)
- Added review task auto-completion: when Cat sends doc-request email, the "Review doc request" CRM task is automatically marked complete
- Added 5 new tests covering task completion scenarios (success, already completed, not found, no opportunity, error handling)
- All 743 tests pass across 46 test files with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor sent-detector for opportunity-level stage move + task completion** - `03896d1` (feat)
2. **Task 2: Update sent-detector tests for new stage move + task completion** - `78a11d9` (test)

## Files Created/Modified
- `src/intake/sent-detector.ts` - Replaced deprecated moveToCollectingDocs with opportunity-level API; added review task auto-completion
- `src/intake/__tests__/sent-detector.test.ts` - Updated mocks for new API; added 5 new tests (17 total, was 12)

## Decisions Made
- Used `searchOpportunities` (returns first Live Deals opportunity) rather than `findOpportunityByFinmoId` because the sent-detector context lacks a finmoApplicationId. The first Live Deals opportunity is sufficient since most contacts have only one active deal.
- Review task auto-complete is inline in the sent-detector flow (step 3b) rather than a separate event handler, keeping the logic colocated with the stage move.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 12 is now complete (all 3 plans: 12-01, 12-02, 12-03 executed)
- The deprecated `moveToCollectingDocs` is no longer used by the sent-detector but remains in opportunities.ts for backward compatibility
- Pipeline automation foundation ready for next milestone phases

## Self-Check: PASSED

All files and commits verified:
- [x] src/intake/sent-detector.ts exists
- [x] src/intake/__tests__/sent-detector.test.ts exists
- [x] 12-02-SUMMARY.md exists
- [x] Commit 03896d1 found
- [x] Commit 78a11d9 found

---
*Phase: 12-crm-pipeline-automation*
*Completed: 2026-02-26*
