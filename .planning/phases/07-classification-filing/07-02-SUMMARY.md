---
phase: 07-classification-filing
plan: 02
subsystem: intake
tags: [finmo, api, redis, dedup, document-download, pdf-conversion]

# Dependency graph
requires:
  - phase: 06-document-intake
    provides: "IntakeDocument types, intake-worker stub, pdf-converter, intake config"
  - phase: 01-webhook-foundation
    provides: "appConfig with finmo.apiKey and finmo.apiBase, Redis connection config"
provides:
  - "finmo-downloader.ts: Finmo document download via confirmed API endpoints"
  - "Redis-based dedup for processed Finmo document requests"
  - "Real processFinmoSource implementation in intake-worker"
  - "Barrel exports for finmo-downloader functions"
affects: [07-classification-filing, intake-worker consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-file error handling in download orchestrator (same as per-attachment in Gmail source)"
    - "Redis set-based dedup with graceful fallback on unavailability"
    - "Defensive API response parsing (multiple URL field names, non-array guard)"

key-files:
  created:
    - src/intake/finmo-downloader.ts
    - src/intake/__tests__/finmo-downloader.test.ts
  modified:
    - src/intake/intake-worker.ts
    - src/intake/index.ts
    - src/intake/__tests__/intake-worker.test.ts

key-decisions:
  - "Redis set (SISMEMBER/SADD) for dedup instead of key-value (simpler, atomic membership check)"
  - "Defensive signed URL extraction checks url, signedUrl, downloadUrl fields (Finmo response shape undocumented)"
  - "Per-file error catching in downloadFinmoDocument — one bad file does not abort the batch"
  - "Mark doc request processed even with partial errors (prevent infinite re-processing loops)"

patterns-established:
  - "Finmo API fetch pattern: Bearer token from appConfig.finmo.apiKey, same as finmo-client.ts"
  - "Redis set dedup with try/catch fallback: treat as not-processed if Redis unavailable"

# Metrics
duration: 4min
completed: 2026-02-16
---

# Phase 7 Plan 02: Finmo Document Download Summary

**Finmo document download pipeline using confirmed API endpoints (list, detail, signed URL) with Redis set dedup and per-file error handling**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-16T01:41:32Z
- **Completed:** 2026-02-16T01:45:49Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Implemented full Finmo document download pipeline: listDocRequests, getDocRequestDetail, getSignedDownloadUrl, downloadFinmoFile, downloadFinmoDocument orchestrator
- Redis-based dedup (isDocRequestProcessed / markDocRequestProcessed) with graceful fallback when Redis is unavailable
- Replaced processFinmoSource stub with real implementation: dedup check -> download -> convert -> produce IntakeDocument
- 29 net new tests (23 finmo-downloader + 6 Finmo intake-worker), 270 total tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Create finmo-downloader module with download and dedup logic** - `6315810` (feat)
2. **Task 2: Implement processFinmoSource in intake-worker and update barrel** - `04af28d` (feat)

## Files Created/Modified
- `src/intake/finmo-downloader.ts` - Finmo API download functions and Redis dedup helpers
- `src/intake/__tests__/finmo-downloader.test.ts` - 23 tests for download, API, signed URL, dedup
- `src/intake/intake-worker.ts` - Real processFinmoSource replacing stub
- `src/intake/index.ts` - Barrel updated with finmo-downloader exports
- `src/intake/__tests__/intake-worker.test.ts` - 7 Finmo source tests replacing 1 stub test

## Decisions Made
- Used Redis set (SISMEMBER/SADD) for dedup instead of key-value. Simpler atomic membership check; no expiry needed since doc requests are immutable.
- Defensive signed URL extraction checks three field names (url, signedUrl, downloadUrl) since Finmo response shape is not fully documented.
- Per-file error catching in downloadFinmoDocument: one failed file download does not abort remaining files in the same doc request.
- Mark doc request as processed even when there are partial errors, to prevent infinite re-processing loops. The errors are captured in IntakeResult for observability.
- Graceful Redis fallback: if Redis is unavailable, isDocRequestProcessed returns false (process the doc) rather than throwing.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Uses existing FINMO_API_KEY and Redis from prior phases.

## Next Phase Readiness
- Finmo document intake pipeline complete: webhook -> queue -> download -> convert -> IntakeDocument
- processFinmoSource produces IntakeDocuments identical in shape to processGmailSource
- Ready for Phase 7 Plan 03 (classifier module) to consume IntakeDocuments from both sources
- 270 total tests pass, no type errors

## Self-Check: PASSED

- All 5 files verified present on disk
- Commit `6315810` (Task 1) verified in git log
- Commit `04af28d` (Task 2) verified in git log
- 270 tests pass, 0 type errors (excluding pre-existing test-draft.ts)

---
*Phase: 07-classification-filing*
*Completed: 2026-02-16*
