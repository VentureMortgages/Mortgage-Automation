---
phase: 04-crm-integration
plan: 02
subsystem: crm
tags: [gohighlevel, contacts, tasks, opportunities, pipeline, upsert]

# Dependency graph
requires:
  - phase: 04-crm-integration
    plan: 01
    provides: "GHL SDK client, CRM config with devPrefix(), typed constants for entity IDs"
provides:
  - "Contact upsert by email with Finmo-field protection"
  - "Contact lookup by email via POST /contacts/search"
  - "Task creation for Cat (doc review) and Taylor (PRE-readiness)"
  - "Opportunity upsert for pipeline stage management (Collecting Docs, All Docs Received)"
  - "addBusinessDays utility for due date calculation"
  - "Shared CRM error types (CrmApiError, CrmRateLimitError, CrmAuthError)"
affects: [04-03, 04-04, 05-email-drafting, 08-tracking-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Raw fetch with typed error classification per CRM module", "Finmo-managed field protection via Set-based filtering", "Config-driven user/stage ID validation at function call time"]

key-files:
  created:
    - "src/crm/errors.ts"
    - "src/crm/contacts.ts"
    - "src/crm/tasks.ts"
    - "src/crm/opportunities.ts"
  modified: []

key-decisions:
  - "Created shared errors.ts module for CRM error types (not in plan, but needed by all 3 service modules)"
  - "Used raw fetch instead of GHL SDK for all CRM operations (consistent with Plan 01 setup scripts pattern)"
  - "Finmo-managed fields stripped via ReadonlySet filter rather than documentation-only guard"

patterns-established:
  - "CRM service module pattern: domain function -> taskFetch/crmFetch/oppFetch -> typed error classification"
  - "Config validation at call time: throw descriptive error if user/stage ID empty (not at import time)"
  - "devPrefix applied to all user-visible CRM values (names, task titles, opportunity names)"

# Metrics
duration: 3min
completed: 2026-02-14
---

# Phase 4 Plan 02: CRM Service Modules Summary

**Contact upsert/lookup, task creation for Cat and Taylor, and pipeline opportunity management with Finmo-field protection and typed error handling**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T00:24:00Z
- **Completed:** 2026-02-14T00:26:40Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Contact upsert by email with automatic Finmo-managed field filtering (Deal ID, Application ID, Deal Link never overwritten)
- Contact lookup via POST /contacts/search endpoint
- Task creation with business-day due dates: Cat gets review tasks, Taylor gets PRE-readiness notifications
- Opportunity upsert for idempotent pipeline stage transitions (Collecting Documents and All Docs Received)
- Shared typed error hierarchy for all CRM API operations

## Task Commits

Each task was committed atomically:

1. **Task 1: Build contact upsert and lookup service** - `209616d` (feat)
2. **Task 2: Build task creation and opportunity management services** - `4c304e5` (feat)

## Files Created/Modified
- `src/crm/errors.ts` - Typed error classes: CrmApiError, CrmRateLimitError, CrmAuthError
- `src/crm/contacts.ts` - upsertContact (email dedup, Finmo-field protection) and findContactByEmail
- `src/crm/tasks.ts` - createReviewTask (Cat), createPreReadinessTask (Taylor), addBusinessDays utility
- `src/crm/opportunities.ts` - upsertOpportunity, moveToCollectingDocs, moveToAllDocsReceived

## Decisions Made
- **Shared errors module:** Created `src/crm/errors.ts` as a separate module rather than defining error classes in each service file. All three CRM modules (contacts, tasks, opportunities) need the same typed errors, so a shared module avoids duplication and ensures consistent error handling.
- **Raw fetch over GHL SDK:** Used raw `fetch` for all API calls rather than the GHL SDK methods. This is consistent with the approach established in Plan 01 (setup scripts used raw fetch because SDK types were incomplete). Raw fetch gives us full control over error classification and avoids SDK type compatibility issues.
- **Set-based Finmo field protection:** Rather than relying on documentation to tell callers "don't pass Finmo fields," the contacts module actively strips Finmo-managed field IDs from the customFields array using a ReadonlySet. This is a programmatic guard against accidental overwrites.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Created shared CRM errors module**
- **Found during:** Task 1 (contacts service)
- **Issue:** Plan specifies typed error classes (CrmRateLimitError, CrmAuthError, CrmApiError) for contacts.ts but doesn't mention a shared location. Tasks.ts and opportunities.ts (Task 2) need the same errors.
- **Fix:** Created `src/crm/errors.ts` with all three error classes. All CRM service modules import from this shared file.
- **Files modified:** src/crm/errors.ts (created)
- **Verification:** `npx tsc --noEmit` passes; all 3 modules import from errors.ts
- **Committed in:** 209616d (Task 1 commit)

**2. [Rule 1 - Bug] Fixed ReadonlySet type for Finmo field filtering**
- **Found during:** Task 1 (contacts service)
- **Issue:** `new Set([EXISTING_FIELDS.FINMO_DEAL_ID, ...])` inferred a narrow literal type Set, causing TS2345 when checking `field.id` (type `string`) against it.
- **Fix:** Explicitly typed as `ReadonlySet<string>` for correct string comparison.
- **Files modified:** src/crm/contacts.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 209616d (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correctness and code reuse. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None beyond what was documented in Plan 01 (setup scripts must be run to populate .env values before runtime CRM operations work).

## Next Phase Readiness
- All CRM service modules are complete and ready for Plan 03 (checklist-to-CRM field mapper)
- Plan 03 will compose these services into the checklist sync workflow
- Setup scripts from Plan 01 must be run before any live CRM operations

## Self-Check: PASSED

- All 4 created files exist on disk
- Commit 209616d (Task 1) exists in git log
- Commit 4c304e5 (Task 2) exists in git log
- TypeScript compilation passes with zero errors

---
*Phase: 04-crm-integration*
*Completed: 2026-02-14*
