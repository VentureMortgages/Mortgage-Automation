---
phase: 10-opportunity-centric-architecture
plan: 05
subsystem: crm
tags: [ghl, opportunities, barrel-export, deprecation, pipeline-wiring]

# Dependency graph
requires:
  - phase: 10-03
    provides: "checklist-sync refactored for opportunity-level doc tracking"
  - phase: 10-04
    provides: "tracking-sync refactored with cross-deal reuse logic"
provides:
  - "End-to-end pipeline wired: webhook/classification workers pass finmoApplicationId to opportunity tracking"
  - "Clean barrel export with only new opportunity API functions"
  - "Contact-level doc tracking deprecated (setup script, config warnings, @deprecated annotations)"
affects: [11-end-to-end-testing, future-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deprecation via @deprecated JSDoc + config warning (non-breaking)"
    - "Setup script CLI flag pattern for maintenance operations (--deprecate-contact-fields)"

key-files:
  created: []
  modified:
    - src/webhook/worker.ts
    - src/classification/classification-worker.ts
    - src/crm/index.ts
    - src/crm/contacts.ts
    - src/crm/config.ts
    - src/crm/types/index.ts
    - src/crm/setup/create-custom-fields.ts

key-decisions:
  - "finmoApplicationId sourced from finmoApp.application.id (canonical) in webhook worker"
  - "Deprecated functions kept in opportunities.ts for direct import by sent-detector.ts"
  - "Contact-level fieldIds validation downgraded to warning (not throw) for backward-compatible fallback"
  - "Setup script --deprecate-contact-fields renames via PUT API (field IDs remain valid after rename)"

patterns-established:
  - "CLI flag pattern for maintenance operations in setup scripts"
  - "Config validation tiers: required (throw), deprecated (warn), optional (warn)"

requirements-completed: [OPP-01, OPP-03, OPP-04, OPP-05, OPP-07, OPP-08]

# Metrics
duration: 4min
completed: 2026-02-21
---

# Phase 10 Plan 05: Cleanup and Barrel Exports Summary

**Workers wired with finmoApplicationId for opportunity-level tracking, barrel cleaned of deprecated functions, contact-level doc tracking fields deprecated with setup script and config warnings**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-21T23:42:04Z
- **Completed:** 2026-02-21T23:46:38Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Webhook worker passes `finmoApp.application.id` to checklist sync and logs `trackingTarget` for observability
- Classification worker passes `finmoApplicationId` to tracking sync with full opportunity-level log output
- Barrel export cleaned: `upsertOpportunity`, `moveToCollectingDocs`, `moveToAllDocsReceived` removed from public API
- Setup script supports `--deprecate-contact-fields` flag to rename 9 contact fields to "DEPRECATED - [name]"
- Contact-level `fieldIds` and `DOC_TRACKING_FIELD_DEFS` marked `@deprecated` with pointers to opportunity equivalents
- Config validation for contact field IDs downgraded from throw to warning (allows system to run after deprecation)
- All 692 tests pass, no new TypeScript errors in modified files

## Task Commits

Each task was committed atomically:

1. **Task 1: Update webhook worker and classification worker** - `ce91064` (feat)
2. **Task 2: Update barrel export and clean up deprecated exports** - `4c25b12` (refactor)
3. **Task 3: Deprecate contact-level doc tracking fields** - `58a84e0` (feat)

## Files Created/Modified
- `src/webhook/worker.ts` - Added finmoApp.application.id source, trackingTarget logging
- `src/classification/classification-worker.ts` - Added finmoApplicationId to tracking call, expanded tracking log
- `src/crm/index.ts` - Removed 3 deprecated function exports from barrel
- `src/crm/contacts.ts` - Added Phase 10 JSDoc note to upsertContact
- `src/crm/config.ts` - @deprecated on fieldIds, validation downgraded to warning
- `src/crm/types/index.ts` - @deprecated on DOC_TRACKING_FIELD_DEFS
- `src/crm/setup/create-custom-fields.ts` - Added --deprecate-contact-fields CLI flag with PUT rename logic

## Decisions Made
- **finmoApp.application.id as canonical source:** The webhook worker already had `finmoApplicationId: applicationId` from Plan 10-03. Updated to use `finmoApp.application.id` for clarity since it is the canonical Finmo application UUID.
- **Deprecated functions kept in opportunities.ts:** `moveToCollectingDocs` is still used by `sent-detector.ts` via direct import (not barrel). Functions stay exported from the module file but removed from the barrel public API.
- **Config validation tiers:** Contact field IDs now follow the same pattern as opportunity field IDs -- warn on missing, don't throw. This allows the system to function after the contact fields are renamed in the CRM (field IDs remain valid; only display names change).
- **Setup script PUT rename approach:** Renaming via `PUT /locations/:locationId/customFields/:fieldId` preserves field IDs and all historical data. Visual "DEPRECATED - " prefix makes fields obvious in the MBP UI.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

The `--deprecate-contact-fields` flag was implemented but NOT run against the live CRM. To deprecate the contact-level fields in production:

```bash
npx tsx src/crm/setup/create-custom-fields.ts --deprecate-contact-fields
```

This will rename the 9 contact-level doc tracking fields to "DEPRECATED - [name]" in the MyBrokerPro UI.

## Next Phase Readiness
- Phase 10 opportunity-centric architecture is now complete (all 5 plans)
- End-to-end pipeline uses opportunity-level tracking: webhook -> checklist sync -> opportunity, classification -> tracking sync -> opportunity
- Contact-level tracking preserved as fallback for clients without opportunities
- Ready for end-to-end integration testing or next phase

---
*Phase: 10-opportunity-centric-architecture*
*Completed: 2026-02-21*
