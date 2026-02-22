---
phase: 11-drive-folder-linking-deal-subfolders
plan: 02
subsystem: webhook
tags: [google-drive, crm, webhook-worker, folder-linking, deal-subfolders]

# Dependency graph
requires:
  - phase: 11-drive-folder-linking-deal-subfolders
    provides: CrmConfig.driveFolderIdFieldId, CrmConfig.oppDealSubfolderIdFieldId, getContactDriveFolderId
provides:
  - Webhook worker persists clientFolderId on CRM contact after folder creation
  - Webhook worker creates deal subfolder per Finmo application and stores dealSubfolderId on opportunity
  - Drive scanner dual-scan merges client-level and deal-level docs for checklist filtering
  - extractDealReference pure function for parsing opportunity name format
affects: [11-03, classification-worker, drive-filing]

# Tech tracking
tech-stack:
  added: []
  patterns: [non-fatal CRM persistence in webhook pipeline, dual-folder scan with merged results]

key-files:
  created: []
  modified:
    - src/webhook/worker.ts
    - src/drive/folder-scanner.ts
    - src/drive/index.ts
    - src/drive/__tests__/folder-scanner.test.ts

key-decisions:
  - "Folder ID persistence uses upsertContact (existing function) to store on contact before CRM sync step"
  - "Deal subfolder name derived from opportunity name via extractDealReference (lastIndexOf ' - ' pattern)"
  - "Dual-scan merges client + deal folder docs with spread operator before filtering"
  - "All CRM persistence operations wrapped in non-fatal try/catch (failures must not block pipeline)"

patterns-established:
  - "Non-fatal CRM persistence pattern: try/catch around folder ID storage with error logging"
  - "Dual-folder scan: scan client folder + deal subfolder, merge results before checklist filtering"

requirements-completed: [DRIVE-01, DRIVE-03, DRIVE-06]

# Metrics
duration: 2min
completed: 2026-02-22
---

# Phase 11 Plan 02: Webhook Worker Folder Persistence + Deal Subfolders Summary

**Webhook worker persists Drive folder IDs to CRM, creates deal subfolders per Finmo application, and dual-scans both locations for existing docs**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T00:45:19Z
- **Completed:** 2026-02-22T00:47:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Webhook worker stores clientFolderId on CRM contact custom field immediately after folder creation
- Deal subfolder created per Finmo application using deal reference extracted from opportunity name
- Deal subfolder ID stored on CRM opportunity custom field
- Drive scan step now scans both client folder and deal subfolder, merging results before checklist filtering
- extractDealReference function with 6 unit tests covering standard format, edge cases, and fallbacks
- All 698 tests pass (692 existing + 6 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: Webhook worker -- persist folder IDs and create deal subfolder** - `6373e01` (feat)
2. **Task 2: Tests for extractDealReference and dual-scan verification** - `d0ee658` (test)

## Files Created/Modified
- `src/webhook/worker.ts` - Added folder ID persistence (step 3b), deal subfolder creation (step 3c), and dual-scan logic (step 4)
- `src/drive/folder-scanner.ts` - Added extractDealReference pure function
- `src/drive/index.ts` - Added extractDealReference and ExistingDoc to barrel exports
- `src/drive/__tests__/folder-scanner.test.ts` - Added 6 test cases for extractDealReference

## Decisions Made
- Folder ID persistence uses upsertContact (existing function) with customFields array -- cleanest approach since contact already gets upserted later in pipeline
- Deal subfolder name derived from opportunity name via extractDealReference using lastIndexOf(' - ') to handle names with multiple dashes
- Dual-scan merges arrays with spread operator before filtering -- simple and correct since ExistingDoc already has filename context
- All CRM persistence operations are non-fatal: try/catch with error logging so pipeline continues even if CRM storage fails

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

The custom fields must be provisioned in MyBrokerPro before the folder ID persistence will take effect:
```bash
npx tsx src/crm/setup/create-custom-fields.ts --drive-fields
```
Then copy the printed env vars (GHL_FIELD_DRIVE_FOLDER_ID, GHL_OPP_FIELD_DEAL_SUBFOLDER_ID) into .env.

## Next Phase Readiness
- Webhook worker now creates and persists folder IDs end-to-end
- Ready for 11-03 (worker integration finalization / E2E testing)
- extractDealReference available via barrel export for any other consumers

## Self-Check: PASSED

- All 4 files verified present on disk
- Commit 6373e01 verified in git log
- Commit d0ee658 verified in git log
- Key exports verified: extractDealReference, ExistingDoc barrel export
- 698 tests passing (692 existing + 6 new)

---
*Phase: 11-drive-folder-linking-deal-subfolders*
*Completed: 2026-02-22*
