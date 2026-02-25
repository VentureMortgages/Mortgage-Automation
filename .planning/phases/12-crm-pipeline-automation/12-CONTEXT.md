# Phase 12: CRM Pipeline Automation - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Make Cat's CRM workflow clean: deduplicate review tasks across the dual Leads/Live Deals pipelines, auto-move opportunity stages, auto-complete review tasks, and set contact type for professionals (realtors, lawyers) pushed by Finmo. All changes are internal CRM automation — no new client-facing behavior.

</domain>

<decisions>
## Implementation Decisions

### Task deduplication
- Review task goes on the **Live Deals pipeline opportunity ONLY** — Cat works from Live Deals, not Leads
- If the Live Deals opportunity doesn't exist yet (Finmo→MBP timing lag), **wait** — don't create the task until the opportunity appears. This relies on the retry mechanism from Phase 13 (SYNC-01)
- If a review task already exists for this application (duplicate webhook), **update the existing task** with the latest checklist rather than creating a duplicate
- Detection: match by contact ID + task title pattern to find existing tasks

### Stage move trigger
- Opportunity moves from "In Progress" to "Collecting Documents" **on email send** (detected via BCC), NOT on draft creation
- Rationale: Cat may edit the draft significantly or delay sending. The stage should reflect that the client has actually been contacted.
- This means the sent-detector (BCC feedback capture) triggers both: (1) feedback capture and (2) stage move

### Task auto-completion
- When the opportunity moves to "Collecting Documents", the "Review checklist" task is automatically marked completed
- This can happen in the same flow as the stage move (sent-detector fires both)
- Task found by contact ID + title pattern match

### Professional contact type assignment
- Finmo applications include a "professionals" section where borrowers add realtors, lawyers, etc.
- Finmo pushes these professional contacts to MBP but does NOT set the contact type field
- Our system should read the professional's role from the Finmo application data and set the corresponding MBP contact type field
- Need to: (1) discover available contact type options in MBP, (2) map Finmo professional roles to MBP contact types
- Applies to ALL professional types (realtor, lawyer, etc.), not just realtors

### Failure handling
- All CRM automation (stage moves, task completion, contact type setting) is **non-fatal**
- On failure: log the error and continue. Cat can move stages or complete tasks manually.
- No retries for these operations — they're convenience automations, not critical data operations

### Claude's Discretion
- Exact GHL API calls for task search, task update, stage move
- How to structure the sent-detector integration (extend existing or separate handler)
- Whether to batch the stage move + task completion into one flow or keep them independent

</decisions>

<specifics>
## Specific Ideas

- The sent-detector (BCC feedback capture from Phase 8.1) is the natural trigger point for stage move + task completion — it already fires when Cat sends an email
- For task dedup detection, use contact ID + a title pattern like "Review" or "checklist" — exact pattern TBD based on current task creation code
- Professional contacts from Finmo: check `finmoApp.application.professionals` or similar field for role/type data

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-crm-pipeline-automation*
*Context gathered: 2026-02-25*
