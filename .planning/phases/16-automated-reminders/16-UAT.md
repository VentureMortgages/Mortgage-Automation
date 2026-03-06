---
status: testing
phase: 16-automated-reminders
source: 16-01-SUMMARY.md, 16-02-SUMMARY.md
started: 2026-03-03T01:00:00Z
updated: 2026-03-03T01:00:00Z
---

## Current Test

number: 1
name: Reminder scan finds overdue opportunity
expected: |
  Trigger a manual reminder scan via the admin endpoint or BullMQ job.
  If there's an opportunity in "Collecting Documents" stage with docRequestSent 3+ business days ago and missing docs, the scan log should show it was identified as overdue.
  Check Railway logs for scan output (opportunity ID, days overdue, missing doc count).
awaiting: user response

## Tests

### 1. Reminder scan finds overdue opportunity
expected: Trigger a reminder scan. If any opportunity is in "Collecting Documents" with docRequestSent 3+ business days ago and missing docs, it appears in scan results (Railway logs show opp ID, business days overdue, missing doc count).
result: [pending]

### 2. CRM task created for Cat
expected: After a scan finds an overdue opportunity, a CRM task appears in MyBrokerPro with title "Follow up: Need docs - [Client Name]". Task body contains: list of specific missing documents, draft follow-up email text Cat can copy/paste, and days overdue.
result: [pending]

### 3. Cat receives email notification
expected: After a scan creates a reminder task, Cat receives an email with subject "[TEST] Follow up: Need docs - [Client Name]" containing the client name, missing doc count, and days overdue. Email is sent to the configured notification address (dev@venturemortgages.com in test mode).
result: [pending]

### 4. Task dedup on subsequent cycle
expected: Trigger a second reminder scan for the same overdue opportunity. The existing CRM task is updated (body refreshed with current missing docs list) rather than a duplicate task being created. Only one "Follow up: Need docs" task exists per client.
result: [pending]

### 5. Auto-close on all docs received
expected: When tracking-sync marks an opportunity's doc status as "All Complete" (all required docs received), any existing reminder task for that client is automatically closed/completed. No further reminder emails are sent for that client.
result: [pending]

### 6. Terminal stage skips reminders
expected: Opportunities in terminal pipeline stages (Cancelled, Funded, etc.) are not flagged as overdue even if they have missing docs and docRequestSent > 3 days. Scanner skips them entirely.
result: [pending]

### 7. Kill switch works
expected: Setting REMINDER_ENABLED=false in environment prevents the reminder scan from running. The scheduler logs "Reminders disabled" (or similar) and does not create tasks or send emails.
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0

## Gaps

[none yet]
