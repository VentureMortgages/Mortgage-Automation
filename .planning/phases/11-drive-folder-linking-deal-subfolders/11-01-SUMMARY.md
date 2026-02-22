---
phase: 11-drive-folder-linking-deal-subfolders
plan: 01
subsystem: crm
tags: [ghl, custom-fields, google-drive, setup-script]

# Dependency graph
requires:
  - phase: 10-opportunity-centric-architecture
    provides: opportunity-level custom fields and CRM config patterns
provides:
  - DRIVE_FOLDER_FIELD_DEF and OPP_DEAL_SUBFOLDER_FIELD_DEF type constants
  - CrmConfig.driveFolderIdFieldId and CrmConfig.oppDealSubfolderIdFieldId config entries
  - getContactDriveFolderId helper function for reading folder ID from contact custom fields
  - Setup script --drive-fields flag for provisioning both fields in MyBrokerPro
affects: [11-02, 11-03, drive-filing, classification-worker]

# Tech tracking
tech-stack:
  added: []
  patterns: [standalone field defs separate from doc-tracking arrays, config warnings for optional fields]

key-files:
  created: []
  modified:
    - src/crm/types/index.ts
    - src/crm/config.ts
    - src/crm/contacts.ts
    - src/crm/setup/create-custom-fields.ts

key-decisions:
  - "Drive folder field defs are standalone constants, not part of DOC_TRACKING_FIELD_DEFS or OPP_DOC_TRACKING_FIELD_DEFS arrays"
  - "Config fields are top-level on CrmConfig (not nested inside opportunityFieldIds) since they span contact and opportunity models"
  - "Validation warns but does not throw for missing drive folder field IDs (same pattern as opportunity field warnings)"

patterns-established:
  - "Standalone field definitions for non-doc-tracking CRM fields (separate from 9-field arrays)"
  - "Pure function pattern for reading custom field values from contact records (getContactDriveFolderId)"

requirements-completed: [DRIVE-01, DRIVE-03, DRIVE-07]

# Metrics
duration: 3min
completed: 2026-02-22
---

# Phase 11 Plan 01: CRM Config + Types for Drive Folder Linking Summary

**CRM config and types extended with Drive folder ID fields (contact + opportunity), contact helper, and setup script --drive-fields flag**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-22T00:39:44Z
- **Completed:** 2026-02-22T00:42:28Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- CrmConfig interface extended with driveFolderIdFieldId and oppDealSubfolderIdFieldId
- getContactDriveFolderId pure function for reading Drive folder ID from contact custom fields
- Setup script handles --drive-fields flag to provision both fields via CRM API
- All 692 existing tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Drive folder field definitions, config entries, and contact helper** - `324167d` (feat)
2. **Task 2: Update setup script to create Drive folder custom fields** - `16a37c6` (feat)

## Files Created/Modified
- `src/crm/types/index.ts` - Added DRIVE_FOLDER_FIELD_DEF and OPP_DEAL_SUBFOLDER_FIELD_DEF constants
- `src/crm/config.ts` - Added driveFolderIdFieldId and oppDealSubfolderIdFieldId to CrmConfig, populated via optionalEnv, validation warnings
- `src/crm/contacts.ts` - Added getContactDriveFolderId helper function
- `src/crm/setup/create-custom-fields.ts` - Added --drive-fields flag, createDriveFields function, updated JSDoc header

## Decisions Made
- Drive folder field definitions kept as standalone constants separate from the 9-field doc tracking arrays, because they serve a different purpose (folder references vs doc tracking)
- Both config fields placed at top level of CrmConfig (not nested) since driveFolderIdFieldId is contact-scoped and oppDealSubfolderIdFieldId is opportunity-scoped
- Validation follows the existing warning pattern (console.warn, not throw) for fields populated by setup scripts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

After deploying, run the setup script to create the custom fields in MyBrokerPro:
```bash
npx tsx src/crm/setup/create-custom-fields.ts --drive-fields
```
Then copy the printed env vars (GHL_FIELD_DRIVE_FOLDER_ID, GHL_OPP_FIELD_DEAL_SUBFOLDER_ID) into .env.

## Next Phase Readiness
- CRM types and config ready for 11-02 (folder creation and linking service)
- Setup script ready to provision fields against live CRM when needed
- getContactDriveFolderId available for 11-03 (worker integration)

## Self-Check: PASSED

- All 5 files verified present on disk
- Commit 324167d verified in git log
- Commit 16a37c6 verified in git log
- Key exports verified: DRIVE_FOLDER_FIELD_DEF, OPP_DEAL_SUBFOLDER_FIELD_DEF, driveFolderIdFieldId, oppDealSubfolderIdFieldId, getContactDriveFolderId, --drive-fields

---
*Phase: 11-drive-folder-linking-deal-subfolders*
*Completed: 2026-02-22*
