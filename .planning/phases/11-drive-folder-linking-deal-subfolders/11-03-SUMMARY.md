---
phase: 11-drive-folder-linking-deal-subfolders
plan: 03
subsystem: classification
tags: [google-drive, crm, classification-worker, folder-resolution, deal-subfolders]

# Dependency graph
requires:
  - phase: 11-drive-folder-linking-deal-subfolders
    provides: CrmConfig.driveFolderIdFieldId, CrmConfig.oppDealSubfolderIdFieldId, getContactDriveFolderId, findOpportunityByFinmoId
provides:
  - Classification worker reads clientFolderId from CRM contact instead of using global root
  - Property-specific docs route to deal subfolder when available
  - Reusable docs always route to client folder
  - Fallback chain CRM contact field -> DRIVE_ROOT_FOLDER_ID -> manual review
  - Pre-fetched contact shared between folder resolution and tracking-sync (one fewer API call per job)
affects: [classification-worker, tracking-sync, drive-filing]

# Tech tracking
tech-stack:
  added: []
  patterns: [CRM-based folder resolution with fallback chain, pre-fetched contact sharing across pipeline stages]

key-files:
  created: []
  modified:
    - src/classification/classification-worker.ts
    - src/crm/tracking-sync.ts
    - src/classification/__tests__/classification-worker.test.ts

key-decisions:
  - "Contact fetched once via getContact and shared with tracking-sync via prefetchedContact parameter (saves one CRM API call per classification job)"
  - "Property-specific vs reusable routing uses PROPERTY_SPECIFIC_TYPES from drive/doc-expiry.ts (single source of truth)"
  - "getContact failure is non-fatal: caught in try/catch, falls back to DRIVE_ROOT_FOLDER_ID"
  - "Deal subfolder resolution only attempted when applicationId is present (property-specific + has Finmo app context)"

patterns-established:
  - "Pre-fetched CRM record sharing across pipeline stages to reduce API calls"
  - "Fallback chain pattern: CRM field -> env var config -> manual review"

requirements-completed: [DRIVE-02, DRIVE-04, DRIVE-05, DRIVE-07]

# Metrics
duration: 3min
completed: 2026-02-22
---

# Phase 11 Plan 03: Classification Worker CRM-Based Folder Resolution Summary

**Classification worker reads Drive folder IDs from CRM contact/opportunity, routes property-specific docs to deal subfolders, with full fallback chain to root folder**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-22T00:50:06Z
- **Completed:** 2026-02-22T00:54:03Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Classification worker reads clientFolderId from CRM contact via getContactDriveFolderId instead of always using DRIVE_ROOT_FOLDER_ID
- Property-specific docs (purchase_agreement, MLS, etc.) route to deal subfolder when available via opportunity custom field
- Reusable docs (T4, pay_stub, etc.) always route to client folder regardless of deal subfolder
- Graceful fallback chain: CRM contact field -> DRIVE_ROOT_FOLDER_ID -> manual review
- Contact fetched once and shared with tracking-sync via prefetchedContact (saves one API call per job)
- 7 new test cases covering all folder resolution paths
- All 705 tests pass (698 existing + 7 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor classification worker for CRM-based folder resolution** - `2ba1e8a` (feat)
2. **Task 2: Tests for classification worker folder resolution** - `3858412` (test)

## Files Created/Modified
- `src/classification/classification-worker.ts` - Added CRM-based folder resolution with fallback chain, property-specific vs reusable routing, deal subfolder resolution, pre-fetched contact sharing
- `src/crm/tracking-sync.ts` - Added prefetchedContact optional parameter to TrackingUpdateInput, used to skip redundant getContact call
- `src/classification/__tests__/classification-worker.test.ts` - Added 7 test cases for folder resolution (CRM folder ID, root fallback, deal subfolder routing, reusable doc routing, getContact failure, pre-fetched contact)

## Decisions Made
- Contact is fetched once via getContact and shared with tracking-sync via prefetchedContact parameter -- saves one CRM API call per classification job without changing the tracking-sync API contract
- Property-specific vs reusable routing reuses PROPERTY_SPECIFIC_TYPES from drive/doc-expiry.ts (single source of truth, same set used by tracking-sync)
- getContact failure is non-fatal and caught in try/catch, falling back to DRIVE_ROOT_FOLDER_ID -- consistent with project's "non-fatal CRM" pattern
- Deal subfolder resolution only attempted when both contactId and applicationId are present and doc is property-specific
- Existing tracking sync test updated from exact match to objectContaining for backward compatibility with new prefetchedContact field

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

The custom fields must be provisioned in MyBrokerPro before the folder resolution will read real values:
```bash
npx tsx src/crm/setup/create-custom-fields.ts --drive-fields
```
Then copy the printed env vars (GHL_FIELD_DRIVE_FOLDER_ID, GHL_OPP_FIELD_DEAL_SUBFOLDER_ID) into .env.

## Next Phase Readiness
- Phase 11 is complete: all 3 plans executed (CRM config, webhook worker, classification worker)
- Full Drive folder linking pipeline wired end-to-end
- Setup script --drive-fields must be run against live CRM to get field IDs before production use

## Self-Check: PASSED

- All 3 modified files verified present on disk
- Commit 2ba1e8a verified in git log
- Commit 3858412 verified in git log
- Key patterns verified: getContactDriveFolderId, PROPERTY_SPECIFIC_TYPES, findOpportunityByFinmoId, prefetchedContact, oppDealSubfolderIdFieldId
- 705 tests passing (698 existing + 7 new)

---
*Phase: 11-drive-folder-linking-deal-subfolders*
*Completed: 2026-02-22*
