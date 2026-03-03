---
phase: 16-automated-reminders
plan: 02
subsystem: reminders
tags: [crm-tasks, gmail, bullmq, scheduler, dedup, auto-close]

# Dependency graph
requires:
  - phase: 16-automated-reminders
    provides: "Plan 01: scanner, types, business days, follow-up text"
  - phase: 04-crm-integration
    provides: CRM task creation, config, devPrefix
  - phase: 05-email-drafting
    provides: Gmail draft create/send, MIME encoding, email config
  - phase: 08-tracking-integration
    provides: tracking-sync updateDocTracking with All Complete detection
provides:
  - createOrUpdateReminderTask with dedup by title pattern
  - closeReminderTask for auto-close on doc receipt
  - sendReminderNotification Cat email notification
  - runReminderScan daily orchestrator
  - startReminderScheduler/stopReminderScheduler BullMQ lifecycle
  - Auto-close hook in tracking-sync for All Complete status
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [bullmq-repeatable-job, reminder-task-dedup, auto-close-hook]

key-files:
  created:
    - src/reminders/reminder-task.ts
    - src/reminders/notify-cat.ts
    - src/reminders/scheduler.ts
    - src/reminders/__tests__/reminder-task.test.ts
    - src/reminders/__tests__/scheduler.test.ts
  modified:
    - src/reminders/index.ts
    - src/webhook/worker.ts
    - src/index.ts
    - src/crm/tracking-sync.ts

key-decisions:
  - "Copied taskFetch HTTP helper pattern from tasks.ts into reminder-task.ts (avoids breaking private internals)"
  - "Cat notification sent as draft+immediate-send (not raw send) to match existing Gmail patterns"
  - "BullMQ repeatable job cron: 0 9 * * 1-5 (9 AM UTC, Mon-Fri)"
  - "Auto-close hook added in both opportunity and contact fallback paths of tracking-sync"

patterns-established:
  - "Reminder task dedup: search by title pattern 'Follow up: Need docs', update body on match"
  - "Non-fatal reminder ops: all functions catch errors, log warnings, return safe defaults"
  - "BullMQ repeatable job registration on startup, removal on shutdown"

requirements-completed: [REMIND-01, REMIND-02, REMIND-03, REMIND-04]

# Metrics
duration: 5min
completed: 2026-03-03
---

# Phase 16 Plan 02: Reminder System Wiring Summary

**CRM task dedup + Cat email notification + BullMQ daily scheduler + tracking-sync auto-close hook**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-03T00:42:05Z
- **Completed:** 2026-03-03T00:48:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- CRM reminder tasks with title-based dedup: find existing "Follow up: Need docs" task and update body, or create new
- Cat receives email notification with subject "[TEST] Follow up: Need docs - [Client Name]" containing doc count and days overdue
- Daily reminder scan orchestrator wired into BullMQ (9 AM UTC Mon-Fri repeatable job)
- Auto-close hook in tracking-sync: when All Complete status detected, closeReminderTask fires in both opportunity and contact fallback paths
- All reminder operations are non-fatal (errors logged, never thrown)

## Task Commits

Each task was committed atomically:

1. **Task 1: CRM reminder task CRUD + Cat email notification** - `572e340` (feat, TDD)
2. **Task 2: Scheduler + auto-close hook + system wiring** - `dd5ce8d` (feat)

## Files Created/Modified
- `src/reminders/reminder-task.ts` - findReminderTask, createOrUpdateReminderTask, closeReminderTask with taskFetch pattern
- `src/reminders/notify-cat.ts` - sendReminderNotification via Gmail draft+send
- `src/reminders/scheduler.ts` - runReminderScan orchestrator, start/stop BullMQ repeatable job
- `src/reminders/__tests__/reminder-task.test.ts` - 14 tests (task CRUD dedup + Cat notification)
- `src/reminders/__tests__/scheduler.test.ts` - 6 tests (scan orchestrator + error handling)
- `src/reminders/index.ts` - Barrel export updated with all Plan 02 functions
- `src/webhook/worker.ts` - Added 'reminder-scan' job routing
- `src/index.ts` - startReminderScheduler on startup, stopReminderScheduler on shutdown
- `src/crm/tracking-sync.ts` - closeReminderTask hook on All Complete (both paths)

## Decisions Made
- Copied the taskFetch HTTP helper pattern from tasks.ts rather than extracting it to a shared module -- avoids breaking existing internals and keeps reminder-task.ts self-contained
- Cat notification uses draft+send pattern (not raw Gmail send) to match existing email sending patterns in the codebase
- Auto-close hook placed in both the opportunity-level and contact-level fallback paths of tracking-sync to ensure coverage regardless of tracking target
- Repeatable job key stored in module-level variable for cleanup during graceful shutdown

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Reminders are controlled by existing env vars (REMINDER_ENABLED, REMINDER_INTERVAL_DAYS).

## Next Phase Readiness
- Phase 16 (Automated Reminders) is complete -- all 4 REMIND requirements fulfilled
- Reminder system is fully operational: daily scan, CRM tasks, Cat emails, auto-close
- Kill switches: REMINDER_ENABLED env var + AUTOMATION_KILL_SWITCH (global)
- Ready for production deployment (set APP_ENV=production, ensure REMINDER_ENABLED=true)

## Self-Check: PASSED

- All 9 created/modified files verified present on disk
- Commit 572e340 (Task 1) verified in git log
- Commit dd5ce8d (Task 2) verified in git log
- 895 tests passing (20 new + 875 existing)
- TypeScript compilation clean (npx tsc --noEmit)

---
*Phase: 16-automated-reminders*
*Completed: 2026-03-03*
