---
phase: 16-automated-reminders
plan: 01
subsystem: reminders
tags: [business-days, scanner, crm, ghl-api, follow-up, tdd]

# Dependency graph
requires:
  - phase: 04-crm-integration
    provides: CRM opportunity search, custom field reading, contact lookup
  - phase: 08-tracking-integration
    provides: parseOpportunityTrackingFields for reading missing/received docs
provides:
  - ReminderConfig, OverdueOpportunity, ReminderScanResult types
  - countBusinessDays and isBusinessDay business day math utilities
  - scanForOverdueReminders scanner that finds overdue opportunities
  - generateFollowUpText and generateReminderTaskBody for follow-up content
  - isTerminalStage for pipeline stage filtering
  - searchOpportunitiesByStage for stage-based opportunity search
affects: [16-automated-reminders]

# Tech tracking
tech-stack:
  added: []
  patterns: [stage-based-opportunity-search, weekend-aware-business-days, reminder-cycle-calculation]

key-files:
  created:
    - src/reminders/types.ts
    - src/reminders/business-days.ts
    - src/reminders/scanner.ts
    - src/reminders/scanner-search.ts
    - src/reminders/follow-up-text.ts
    - src/reminders/index.ts
    - src/reminders/__tests__/business-days.test.ts
    - src/reminders/__tests__/scanner.test.ts
    - src/reminders/__tests__/follow-up-text.test.ts
  modified: []

key-decisions:
  - "Weekend start dates advance clock to next Monday (Sat->Mon = 0 elapsed business days)"
  - "searchOpportunitiesByStage uses stage_id filter to avoid scanning all opportunities"
  - "Follow-up text uses plain text format for easy copy/paste by Cat"
  - "reminderConfig reads REMINDER_ENABLED and REMINDER_INTERVAL_DAYS from env (kill switch)"

patterns-established:
  - "Business day math with weekend-start normalization for edge cases"
  - "Stage-based opportunity search without contactId dependency"
  - "Reminder cycle calculation: Math.floor(daysOverdue / interval)"

requirements-completed: [REMIND-01, REMIND-03]

# Metrics
duration: 6min
completed: 2026-03-03
---

# Phase 16 Plan 01: Core Reminder Engine Summary

**Business day math, overdue opportunity scanner, and follow-up text generator for automated doc reminders**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-03T00:32:53Z
- **Completed:** 2026-03-03T00:39:12Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Business day utilities (countBusinessDays, isBusinessDay) with 22 test cases covering weekends, month/year boundaries, and weekend-start normalization
- Reminder scanner that searches "Collecting Documents" stage, reads docRequestSent date, counts business days, and identifies overdue opportunities with missing docs
- Follow-up text generator producing professional, doc-specific email text Cat can copy/paste and CRM task body with full context
- Barrel export via index.ts for clean public API

## Task Commits

Each task was committed atomically:

1. **Task 1: Types + business day utilities** - `66a58ea` (feat)
2. **Task 2: Reminder scanner + follow-up text generator** - `cd175e1` (feat)

## Files Created/Modified
- `src/reminders/types.ts` - ReminderConfig, OverdueOpportunity, ReminderScanResult types, isTerminalStage, reminderConfig
- `src/reminders/business-days.ts` - countBusinessDays, isBusinessDay, re-exports addBusinessDays
- `src/reminders/scanner.ts` - scanForOverdueReminders: core scan logic with stage filter, business day check, missing doc detection
- `src/reminders/scanner-search.ts` - searchOpportunitiesByStage: GHL API search by pipeline + stage without contactId
- `src/reminders/follow-up-text.ts` - generateFollowUpText (client email) and generateReminderTaskBody (CRM task for Cat)
- `src/reminders/index.ts` - Barrel export of all public types and functions
- `src/reminders/__tests__/business-days.test.ts` - 22 tests for date math
- `src/reminders/__tests__/scanner.test.ts` - 8 tests for scanner (mocked CRM API)
- `src/reminders/__tests__/follow-up-text.test.ts` - 9 tests for text generation

## Decisions Made
- Weekend start dates normalize to next Monday for counting (Saturday->Monday = 0 elapsed business days) -- prevents false positives from weekend-dated doc requests
- Created separate `scanner-search.ts` module for stage-based search rather than extending existing `searchOpportunities` which requires contactId -- cleaner separation, scanner-specific concerns
- Follow-up text uses plain text format (not HTML) for easy copy/paste from CRM task body
- reminderConfig is mutable for testing (properties not readonly) while maintaining const binding

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed countBusinessDays weekend start edge case**
- **Found during:** Task 1 (business day utilities)
- **Issue:** Plan specified Saturday->Monday = 0 but naive (from, to] counting gave 1 (Monday counted as business day)
- **Fix:** Added weekend-start normalization: if `from` is not a business day, advance to next business day before counting
- **Files modified:** src/reminders/business-days.ts
- **Verification:** All 22 business-days tests pass
- **Committed in:** 66a58ea (Task 1 commit)

**2. [Rule 3 - Blocking] Created scanner-search.ts for stage-based search**
- **Found during:** Task 2 (scanner)
- **Issue:** Existing searchOpportunities requires contactId -- scanner needs to search by stage across ALL contacts
- **Fix:** Created new searchOpportunitiesByStage function using pipeline_stage_id GHL parameter
- **Files modified:** src/reminders/scanner-search.ts
- **Verification:** Scanner tests pass with mocked search function
- **Committed in:** cd175e1 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both auto-fixes necessary for correctness and completeness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All reminder engine functions are tested and exported via index.ts
- Plan 02 can wire scanForOverdueReminders into BullMQ scheduler and create CRM tasks/Cat notifications
- reminderConfig provides kill switch (REMINDER_ENABLED env var) and interval control (REMINDER_INTERVAL_DAYS)

## Self-Check: PASSED

- All 9 created files verified present on disk
- Commit 66a58ea (Task 1) verified in git log
- Commit cd175e1 (Task 2) verified in git log
- 875 tests passing (39 new + 836 existing)
- TypeScript compilation clean (npx tsc --noEmit)

---
*Phase: 16-automated-reminders*
*Completed: 2026-03-03*
