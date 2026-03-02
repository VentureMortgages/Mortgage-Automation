# Phase 16: Automated Reminders - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Notify Cat when client docs are overdue (3+ days since doc request email sent). Create a CRM task with a draft follow-up email Cat can copy/paste. Send Cat an email notification. Refresh the reminder every 3 days if docs are still missing. Auto-close reminders when all docs are received. Cat sends the follow-up manually — the system never auto-sends to clients.

</domain>

<decisions>
## Implementation Decisions

### Reminder trigger & timing
- **Clock starts on email sent date** — detected via BCC/sent-detector (not webhook date). This is when the client was actually asked for docs.
- **Daily scheduled scan** — once per day, scan all active opportunities for overdue docs and create/update reminders. Simpler than per-opportunity delayed jobs.
- **Business days only** — skip Saturday/Sunday. Cat won't action reminders on weekends.
- **3-day cycle** — first reminder 3 business days after email sent, then every 3 business days after that if docs still missing.

### Follow-up message content
- **List each specific missing doc** — "We're still waiting for: 2 recent pay stubs, T4 for 2024, 90-day bank statements"
- Tone should match existing doc request email template (professional, friendly, specific)
- Cat copy/pastes from the CRM task body — system does NOT auto-send

### Cat's notification experience
- **CRM task** with title pattern "Follow up: Need docs - [Client Name]" listing missing docs + draft follow-up email text
- **Email to Cat** with same subject line, containing client details and the draft text
- Task is **updated** (not duplicated) on subsequent reminder cycles — refreshed missing-docs list
- Task auto-closes when all required docs are received

### Auto-close & edge cases
- **Auto-close on all docs received** — when tracking sync marks all items as received, close any pending reminder task
- **Remind indefinitely** — keep refreshing every 3 days until all docs received or deal cancelled. No max cap.
- **Partial receipt** — reminder refreshes with only the remaining missing docs listed
- **Cancelled deals** — reminders stop when opportunity stage moves to a terminal stage (cancelled, funded, etc.)

### Claude's Discretion
- How to implement the daily scan (BullMQ repeatable job vs cron-like setInterval)
- How to detect "email sent date" from existing data (Redis thread store, CRM fields, or Gmail API)
- Email template for Cat's notification
- How to determine terminal pipeline stages
- Whether to use existing `createOrUpdateReviewTask` pattern or a new dedicated reminder task function

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createOrUpdateReviewTask()` in crm/tasks.ts — upsert pattern (find by contact + title, update or create). Can be adapted for reminder tasks.
- `createFailureTask()` in crm/tasks.ts — non-fatal CRM task creator. Shows the pattern for new task types.
- `createCrmNote()` in crm/notes.ts — CRM timeline entries
- `buildChecklistSummary()` in crm/checklist-mapper.ts — generates human-readable checklist status (received/missing counts)
- Gmail draft/send infrastructure in email/ — could be used to send Cat notification emails
- BullMQ delayed jobs — already used for CRM retry scheduling (worker.ts)
- `tracking-sync.ts` — updates checklist status when docs are received. Integration point for auto-close.
- `sent-detector.ts` — detects when Cat sends an email (BCC capture). Could store the sent timestamp for clock start.

### Established Patterns
- Non-fatal try/catch for all CRM operations
- BullMQ job routing by name in createWorker()
- Gmail polling runs every 120s via intake worker
- Thread-to-contact mapping in Redis (matching/thread-store.ts)

### Integration Points
- `sent-detector.ts` — where to record the "email sent" timestamp (clock start)
- `tracking-sync.ts` — where doc receipt is tracked (trigger for reminder refresh/auto-close)
- `worker.ts createWorker()` — where to register new job types (reminder scan)
- `index.ts` — where to start the daily scan scheduler

</code_context>

<specifics>
## Specific Ideas

- The daily scan should check all opportunities in "Collecting Documents" stage with an email sent date > 3 business days ago
- Reminder CRM task should include: client name, list of missing docs with explanations, draft follow-up email text ready to copy/paste
- Cat's email notification should be a simple heads-up pointing her to the CRM task — not a duplicate of all the content
- The "email sent date" could be stored as a custom field on the opportunity when the sent-detector fires (simplest source of truth)

</specifics>

<deferred>
## Deferred Ideas

- Auto-send reminder emails directly to clients — out of scope per CLAUDE.md (human-in-the-loop required)
- Escalation to Taylor after N reminders — not requested
- Different reminder intervals for different doc types — keep it simple with uniform 3-day cycle
- SMS/WhatsApp reminders — clients use email only for now

</deferred>

---

*Phase: 16-automated-reminders*
*Context gathered: 2026-03-02*
