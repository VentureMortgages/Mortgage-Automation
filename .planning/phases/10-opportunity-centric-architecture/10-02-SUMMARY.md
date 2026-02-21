---
phase: 10-opportunity-centric-architecture
plan: 02
subsystem: crm
tags: [ghl, custom-fields, opportunities, setup-scripts]

# Dependency graph
requires:
  - phase: 04-crm-integration
    provides: "DOC_TRACKING_FIELD_DEFS, FIELD_GROUP_ID, create-custom-fields.ts setup pattern"
provides:
  - "Opportunity-scoped custom field creation via --model=opportunity flag"
  - "Opportunity doc tracking field ID listing via fetch-ids.ts"
  - "findOrCreateOppFieldGroup() for Doc Tracking group management"
affects: [10-03, 10-04, 10-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLI --model flag for contact/opportunity model selection"
    - "Group discovery before field creation (findOrCreate pattern)"

key-files:
  created: []
  modified:
    - src/crm/setup/create-custom-fields.ts
    - src/crm/setup/fetch-ids.ts

key-decisions:
  - "Used legacy API (POST /locations/:locationId/customFields) with model='opportunity' instead of V2 API (V2 only supports Custom Objects and Company)"
  - "Separate 'Doc Tracking' field group on opportunities (not reusing contact-level 'Finmo Integration' group)"
  - "ReadonlySet<string> type annotation to widen as-const string literal union for Set.has() compatibility"

patterns-established:
  - "CLI flag pattern: --model=opportunity for setup scripts that target different CRM models"
  - "Group findOrCreate: check existing groups via GET, create if missing, before creating child fields"

requirements-completed: [OPP-02, OPP-07]

# Metrics
duration: 5min
completed: 2026-02-21
---

# Phase 10 Plan 02: Setup Scripts for Opportunity-Scoped Fields Summary

**Setup scripts updated with --model=opportunity flag to create doc tracking fields on CRM opportunities with automatic group discovery/creation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-21T22:29:08Z
- **Completed:** 2026-02-21T22:34:30Z
- **Tasks:** 1/2 (Task 2 is human-action checkpoint)
- **Files modified:** 2

## Accomplishments
- create-custom-fields.ts accepts --model=opportunity flag, uses OPP_DOC_TRACKING_FIELD_DEFS, and creates a "Doc Tracking" group on opportunities before creating child fields
- fetch-ids.ts lists opportunity doc tracking field IDs in GHL_OPP_FIELD_* format alongside existing pipeline/user ID listing
- Backward compatible: default model remains 'contact', existing field creation unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Update setup scripts for opportunity-scoped fields** - `f8e7f6d` (feat)

**Task 2:** Checkpoint (human-action) -- Run setup script against live CRM to create fields, then fetch IDs. Awaiting user execution.

## Files Created/Modified
- `src/crm/setup/create-custom-fields.ts` - Added --model CLI arg, OPP_DOC_TRACKING_FIELD_DEFS import, findOrCreateOppFieldGroup() for group management, model-aware field creation
- `src/crm/setup/fetch-ids.ts` - Added fetchCustomFields() helper, opportunity doc tracking field listing with GHL_OPP_FIELD_* env var output

## Decisions Made
- Used legacy API (`POST /locations/:locationId/customFields`) with `model: 'opportunity'` instead of Custom Fields V2 API (V2 only supports Custom Objects and Company per GHL docs)
- Separate "Doc Tracking" field group on opportunities rather than reusing contact-level "Finmo Integration" group (cleaner separation, different model scope)
- `ReadonlySet<string>` type annotation to widen `as const` literal union type for `Set.has()` compatibility with `string` parameter

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type error in fetch-ids.ts Set.has() call**
- **Found during:** Task 1 (TypeScript compilation check)
- **Issue:** `OPP_DOC_TRACKING_FIELD_DEFS` uses `as const`, narrowing `name` to a string literal union. `Set.has(f.name)` where `f.name` is `string` caused TS2345 assignability error.
- **Fix:** Annotated Set as `ReadonlySet<string>` to widen the type
- **Files modified:** src/crm/setup/fetch-ids.ts
- **Verification:** `npx tsc --noEmit` passes for modified files
- **Committed in:** f8e7f6d (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor type fix required for TypeScript strict mode. No scope creep.

## Issues Encountered
None -- plan executed cleanly aside from the type narrowing fix.

## User Setup Required

**Task 2 requires running setup scripts against the live CRM.** Steps:

1. Create opportunity fields:
   ```bash
   npx tsx src/crm/setup/create-custom-fields.ts --model=opportunity
   ```

2. Fetch field IDs:
   ```bash
   npx tsx src/crm/setup/fetch-ids.ts
   ```

3. Copy `GHL_OPP_FIELD_*` values into `.env`

If the legacy API does not support `model: 'opportunity'`, create the 9 doc tracking fields manually in the GHL UI under a "Doc Tracking" field group on opportunities, then use fetch-ids to retrieve their IDs.

## Next Phase Readiness
- Task 1 code is ready; Task 2 (live CRM execution) blocks downstream plans that need field IDs
- Once field IDs are in .env, plans 10-03 through 10-05 can proceed
- Existing contact field creation is unaffected (backward compatible)

## Self-Check: PASSED

All artifacts verified:
- `src/crm/setup/create-custom-fields.ts` -- FOUND
- `src/crm/setup/fetch-ids.ts` -- FOUND
- Commit `f8e7f6d` -- FOUND

---
*Phase: 10-opportunity-centric-architecture*
*Completed: 2026-02-21 (Task 1 only; Task 2 pending)*
