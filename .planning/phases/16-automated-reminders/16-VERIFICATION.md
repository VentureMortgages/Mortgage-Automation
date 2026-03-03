---
phase: 16-automated-reminders
verified: 2026-03-03T16:52:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Trigger a real reminder scan on staging"
    expected: "Cat receives email with subject 'Follow up: Need docs - [Client Name]' and a CRM task appears with the missing doc list and draft follow-up text"
    why_human: "Live CRM, Gmail, and BullMQ scheduling cannot be exercised in automated tests"
  - test: "Second reminder cycle (6 business days after doc request)"
    expected: "Existing CRM task is updated with refreshed body — no duplicate task created"
    why_human: "Dedup logic tested in unit tests but needs live CRM task state verification"
  - test: "Receive all docs for an active reminder client"
    expected: "Pending 'Follow up: Need docs' CRM task is marked completed automatically"
    why_human: "Auto-close hook in tracking-sync needs live doc intake pipeline to trigger"
---

# Phase 16: Automated Reminders Verification Report

**Phase Goal:** Cat is notified when docs are overdue and has a ready-made follow-up message to send, without manually tracking who is late
**Verified:** 2026-03-03T16:52:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Success Criteria (from ROADMAP.md)

| #  | Success Criterion | Status | Evidence |
|----|-------------------|--------|----------|
| 1  | When docs outstanding 3+ days, CRM task appears for Cat with missing doc list + draft follow-up email | VERIFIED | `createOrUpdateReminderTask` in `reminder-task.ts`; task body from `generateReminderTaskBody` includes both doc list and draft email text; 14 tests passing |
| 2  | Cat receives email with subject "Follow up: Need docs - [Client Name]" | VERIFIED | `sendReminderNotification` in `notify-cat.ts`; subject constructed as `${emailConfig.subjectPrefix}Follow up: Need docs - ${borrowerName}`; test confirms format |
| 3  | Existing reminder task updated (not duplicated) on subsequent 3-day cycle | VERIFIED | `findReminderTask` + `createOrUpdateReminderTask` dedup logic; PUT replaces body if task found by title pattern "Follow up: Need docs"; test confirms update-not-create branch |
| 4  | Pending reminder task auto-closed when all docs received | VERIFIED | `closeReminderTask` imported and called in `tracking-sync.ts` at both opportunity-level (line 330) and contact fallback (line 475) when `newStatus === 'All Complete'` |

**Score:** 4/4 success criteria verified

### Observable Truths (from PLAN frontmatter)

**Plan 01 Truths:**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Scanner identifies opportunities where docs outstanding 3+ business days since email sent | VERIFIED | `scanForOverdueReminders` checks `businessDaysOverdue >= reminderConfig.intervalBusinessDays`; 8 scanner tests pass |
| 2 | Follow-up text lists each specific missing document by name | VERIFIED | `generateFollowUpText` maps `missingDocs` array to named list; 9 follow-up text tests pass |
| 3 | Scanner respects business days (skips Saturday/Sunday) | VERIFIED | `isBusinessDay(today)` guard at top of `scanForOverdueReminders`; `countBusinessDays` walks day-by-day skipping weekends; 22 business-days tests pass |
| 4 | Scanner skips terminal pipeline stages | VERIFIED | `isTerminalStage` check per opportunity; `crmConfig.stageIds.allDocsReceived` included |
| 5 | Scanner correctly computes reminder cycle number | VERIFIED | `reminderCycle = Math.floor(businessDaysOverdue / reminderConfig.intervalBusinessDays)` |

**Plan 02 Truths:**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6  | CRM task appears with missing doc list and draft follow-up email | VERIFIED | `generateReminderTaskBody` includes both; task body confirmed in tests |
| 7  | Cat receives email with correct subject pattern | VERIFIED | Subject: `${subjectPrefix}Follow up: Need docs - ${borrowerName}`; matches REMIND-02 spec |
| 8  | Second reminder cycle updates existing task (no duplicate) | VERIFIED | `findReminderTask` + PUT update path; 14 reminder-task tests confirm dedup |
| 9  | All docs received closes pending reminder task | VERIFIED | `closeReminderTask` wired in `tracking-sync.ts` at both opportunity + contact fallback paths |
| 10 | Daily scan runs automatically via BullMQ repeatable job | VERIFIED | `startReminderScheduler` adds `reminder-scan` job with cron `0 9 * * 1-5`; `createWorker` routes `reminder-scan` to `runReminderScan` |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Provides | Status | Details |
|----------|----------|--------|---------|
| `src/reminders/types.ts` | ReminderConfig, OverdueOpportunity, ReminderScanResult types + isTerminalStage | VERIFIED | 77 lines; all 3 interfaces + const + function exported |
| `src/reminders/business-days.ts` | countBusinessDays, isBusinessDay, re-exports addBusinessDays | VERIFIED | 65 lines; full implementation with weekend-start normalization |
| `src/reminders/scanner.ts` | scanForOverdueReminders — finds overdue opps by stage + elapsed days | VERIFIED | 138 lines; full logic: kill switch, weekend guard, stage search, tracking parse, cycle calc |
| `src/reminders/scanner-search.ts` | searchOpportunitiesByStage — GHL API search by stage without contactId | VERIFIED | 65 lines; uses pipeline_id + pipeline_stage_id params |
| `src/reminders/follow-up-text.ts` | generateFollowUpText, generateReminderTaskBody | VERIFIED | 88 lines; both functions produce substantive output; doc names rendered in both |
| `src/reminders/reminder-task.ts` | findReminderTask, createOrUpdateReminderTask, closeReminderTask | VERIFIED | 185 lines; dedup logic, taskFetch pattern, non-fatal wrappers |
| `src/reminders/notify-cat.ts` | sendReminderNotification via Gmail draft+send | VERIFIED | 77 lines; MIME encode, draft create, send, non-fatal wrapper |
| `src/reminders/scheduler.ts` | runReminderScan, startReminderScheduler, stopReminderScheduler | VERIFIED | 179 lines; BullMQ cron setup, per-opp orchestration, graceful shutdown |
| `src/reminders/index.ts` | Barrel export of all public types and functions | VERIFIED | Exports all 3 types + 9 functions from 5 modules |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scanner.ts` | `crm/opportunities.ts` | `getOpportunity` per scanned opp | VERIFIED | Direct import + call on line 17, 73 |
| `scanner.ts` | `crm/tracking-sync.ts` | `parseOpportunityTrackingFields` to read missing docs | VERIFIED | Direct import + call on line 18, 101 |
| `scheduler.ts` | `scanner.ts` | `scanForOverdueReminders` call | VERIFIED | Import on line 17, call on line 59 |
| `scheduler.ts` | `reminder-task.ts` | `createOrUpdateReminderTask` for each overdue opp | VERIFIED | Import on line 19, call on line 83 |
| `scheduler.ts` | `notify-cat.ts` | `sendReminderNotification` for each overdue opp | VERIFIED | Import on line 20, call on line 86 |
| `crm/tracking-sync.ts` | `reminder-task.ts` | `closeReminderTask` on All Complete | VERIFIED | Import on line 43, called at lines 330 + 475 (both paths) |
| `src/index.ts` | `scheduler.ts` | `startReminderScheduler` on startup | VERIFIED | Import on line 31, await call on line 54 |
| `src/index.ts` | `scheduler.ts` | `stopReminderScheduler` on shutdown | VERIFIED | Called on line 66 in shutdown handler |
| `webhook/worker.ts` | `scheduler.ts` | `runReminderScan` for `reminder-scan` job type | VERIFIED | Import on line 33, routing on lines 551-553 |

All 9 key links WIRED.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| REMIND-01 | 16-01, 16-02 | CRM task with missing doc list + draft follow-up email when 3+ days outstanding | SATISFIED | `scanForOverdueReminders` + `createOrUpdateReminderTask` + `generateReminderTaskBody`; task body includes doc list and draft email |
| REMIND-02 | 16-02 | Cat email notification: subject "Follow up: Need docs - [Client Name]" | SATISFIED | `sendReminderNotification` in `notify-cat.ts`; subject pattern verified in tests |
| REMIND-03 | 16-01, 16-02 | Reminder refreshes every 3 days — updated task, not duplicate | SATISFIED | `findReminderTask` dedup by title pattern + PUT update on match; cycle calculation in scanner |
| REMIND-04 | 16-02 | Reminders stop automatically when all required docs received | SATISFIED | `closeReminderTask` in `tracking-sync.ts` at `newStatus === 'All Complete'` — both opportunity and contact fallback paths |

All 4 REMIND requirements SATISFIED. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `reminder-task.ts` | 50 | `return null` | INFO | Intentional non-fatal error return in `findReminderTask` catch block — correct pattern |

No blocker or warning anti-patterns. The single `return null` is the documented non-fatal error handling pattern (consistent with `findReviewTask` in `crm/tasks.ts`).

### Test Coverage

| Test File | Tests | Status |
|-----------|-------|--------|
| `__tests__/business-days.test.ts` | 22 | PASSED |
| `__tests__/scanner.test.ts` | 8 | PASSED |
| `__tests__/follow-up-text.test.ts` | 9 | PASSED |
| `__tests__/reminder-task.test.ts` | 14 | PASSED |
| `__tests__/scheduler.test.ts` | 6 | PASSED |
| **Total reminder tests** | **59** | **PASSED** |
| **Full test suite** | **895** | **PASSED** |

TypeScript compilation: CLEAN (no errors).
No regressions in existing tests.

### Human Verification Required

The following items require a live environment to verify — all automated checks pass.

#### 1. End-to-End Reminder Trigger

**Test:** Create a test opportunity in "Collecting Documents" stage with a `docRequestSent` date 3+ business days ago and 1+ missing docs. Wait for the 9 AM UTC BullMQ job (or trigger `runReminderScan()` directly via a temporary endpoint).
**Expected:** Cat receives an email with subject "Follow up: Need docs - [Client Name]". A CRM task titled "Follow up: Need docs - [Client Name]" appears assigned to Cat containing the missing doc list and a draft email ready to copy/paste.
**Why human:** Live CRM task creation and Gmail delivery require production/staging infrastructure.

#### 2. Dedup on Second Reminder Cycle

**Test:** After the first reminder fires, wait another 3 business days (or advance the `docRequestSent` date) and trigger another scan.
**Expected:** The existing CRM task body is updated with a refreshed missing-doc list and new due date. No second task is created.
**Why human:** Title-based dedup logic requires live CRM task state to confirm only one task exists per contact.

#### 3. Auto-Close on Doc Receipt

**Test:** With an active "Follow up: Need docs" CRM task in place, process the final outstanding document through the intake pipeline for that contact.
**Expected:** The CRM task is automatically marked completed (closed) after tracking-sync detects "All Complete" status.
**Why human:** The auto-close path requires the full doc intake pipeline to run end-to-end in production.

### Gaps Summary

None. All must-haves are verified. The phase goal is achieved.

---

_Verified: 2026-03-03T16:52:00Z_
_Verifier: Claude (gsd-verifier)_
