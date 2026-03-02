# Phase 15: Timing & Sync Resilience - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Handle the real-world timing gap between Finmo webhook and MBP opportunity creation gracefully. Ensure no lost docs, no failed syncs, and Cat has visibility when things go wrong permanently. Includes a research spike on Finmo's external system API. Builds on the existing CRM retry mechanism (worker.ts step 8b) and Phase 14's matching agent.

</domain>

<decisions>
## Implementation Decisions

### CRM retry strategy
- **Keep current 35 min window** (3 attempts at 5/10/20 min) — covers the typical 4-15 min MBP lag with margin
- **On exhaustion: CRM task for Cat** — create a task: "MBP opportunity not found for [Client] — checklist tracked at contact level, please verify"
- Currently it's log-only (console.warn) — upgrade to CRM task so Cat has visibility
- **Stage catch-up on retry success** — Claude decides the safer option based on existing sent-detector flow
- **Deal subfolder on retry** — if dealSubfolderId is null when retry succeeds and we now have the opportunity, create the deal subfolder and link it

### Docs before CRM exists
- **Retroactive tracking via Drive re-scan** — when the CRM sync retry succeeds, it already re-scans Drive and regenerates the checklist. This naturally picks up any docs filed between the webhook and the retry. No separate tracking queue needed.
- **No-contact docs use Phase 14 auto-create** — if matching agent can't find any contact, auto-create (Phase 14) already handles this: creates contact + folder + files the doc + notifies Cat
- **No notification for pending tracking** — CRM tracking catches up silently. Cat only sees the final state. Low signal-to-noise.
- **Tracking TTL: same as retry window** — if opportunity isn't there within 35 min, it stays contact-level. The retry mechanism already handles this.

### Finmo external system API
- **Research + implement if viable** — investigate Finmo's API docs, test if an "update external system" or "trigger sync" endpoint exists. If it works, wire it into the webhook flow to eliminate the MBP timing gap entirely.
- **Explore blind** — no known docs for this endpoint. Check Finmo's public API and test what we already have access to.
- **If dead end: document and move on** — record findings, the retry mechanism handles it. No further exploration needed.

### Failure visibility for Cat
- **All permanent pipeline failures surface as CRM tasks** — CRM sync exhausted, doc filing failed, email draft creation failed
- **CRM task only (for now)** — no email alerts. Add email alerts later if Cat misses things.
- **Include context in task** — "CRM sync failed for John Smith after 3 retries over 35 min. Finmo app: BRXM-F050746. Checklist at contact level. Check if Live Deals opp exists."
- **One task per failure** — each failure gets its own CRM task at current volume (<1/week expected). Cat resolves individually.

### Claude's Discretion
- Exact implementation of the failure notification system (shared helper vs per-callsite)
- Whether stage catch-up on retry success is safe given the sent-detector flow
- How to structure the Finmo API research spike (test script vs manual exploration)
- Error message wording in CRM tasks

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `processCrmRetry()` in worker.ts (lines 365-497) — already implements the full retry loop with Drive re-scan and checklist regeneration
- `CrmRetryJobData` type in types.ts — carries all context needed for retry
- `RETRY_DELAYS` constant and `MAX_RETRY_ATTEMPTS` — configurable retry schedule
- `createOrUpdateReviewTask()` in crm/tasks.ts — can be adapted for failure notification tasks
- `createCrmNote()` in crm/notes.ts — informational CRM notes for timeline entries
- BullMQ delayed jobs — already used for retry scheduling, same pattern applies for any new deferred jobs

### Established Patterns
- Non-fatal try/catch wrapping for all CRM operations (Phase 12 decision)
- BullMQ job routing by name in createWorker() (line 512) — 'crm-sync-retry' routes to processCrmRetry
- Dead-letter pattern: failed jobs preserved indefinitely for manual review
- Contact-level fallback when opportunity not found (checklist-sync.ts lines 170-184)

### Integration Points
- `worker.ts` step 8b — where CRM retry is scheduled (line 278-303)
- `processCrmRetry()` — where retry succeeds/exhausts (needs failure task creation on exhaustion)
- `classification-worker.ts` — where doc filing happens (needs failure task on permanent failure)
- `createEmailDraft()` — where draft creation happens (needs failure task on Gmail API errors)
- `finmo-client.ts` — where Finmo API calls live (research spike starts here)

</code_context>

<specifics>
## Specific Ideas

- The retry mechanism is mostly built — Phase 15 is about closing gaps: failure visibility, subfolder catch-up, and the Finmo API research
- Cat's CRM task for failures should be actionable: include the client name, what failed, and what Cat should check manually
- The Finmo API research should start with the existing `finmo-client.ts` and the Finmo API base URL we already authenticate against

</specifics>

<deferred>
## Deferred Ideas

- Email alerts for Cat on permanent failures — start with CRM tasks, add email if Cat misses things
- Grouped daily digest of failures — not needed at current volume, revisit at scale
- Automatic re-attempt when Cat manually creates the MBP opportunity — would need CRM webhook from GHL

</deferred>

---

*Phase: 15-timing-sync-resilience*
*Context gathered: 2026-03-02*
