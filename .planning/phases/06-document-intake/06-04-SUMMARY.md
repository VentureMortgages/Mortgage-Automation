---
phase: 06-document-intake
plan: 04
subsystem: intake
tags: [bullmq, gmail-api, ioredis, document-intake, pdf-conversion, express-webhook]

# Dependency graph
requires:
  - phase: 06-document-intake
    plan: 01
    provides: "IntakeDocument types, IntakeConfig, getGmailReadonlyClient, SUPPORTED_MIME_TYPES"
  - phase: 06-document-intake
    plan: 02
    provides: "convertToPdf, ConversionError for PDF conversion pipeline"
  - phase: 06-document-intake
    plan: 03
    provides: "pollForNewMessages, getMessageDetails, extractAttachments, downloadAttachment"
provides:
  - "BullMQ job scheduler for periodic Gmail inbox polling (startGmailMonitor)"
  - "Redis-persisted historyId for crash recovery (getStoredHistoryId/storeHistoryId)"
  - "Finmo document webhook handler (finmoDocumentHandler) with dedup via jobId"
  - "Intake worker pipeline: download -> extract -> convert -> produce IntakeDocument"
  - "Barrel export for all intake module functionality (src/intake/index.ts)"
affects: [07-classification-filing]

# Tech tracking
tech-stack:
  added: [ioredis]
  patterns:
    - "ioredis for direct Redis key-value access (historyId persistence)"
    - "upsertJobScheduler for BullMQ repeating jobs (not deprecated add with repeat)"
    - "Express handler factory pattern: finmoDocumentHandler(queue) returns handler"
    - "Per-attachment error handling: ConversionError caught inline, job continues"

key-files:
  created:
    - src/intake/gmail-monitor.ts
    - src/intake/finmo-docs.ts
    - src/intake/intake-worker.ts
    - src/intake/index.ts
    - src/intake/__tests__/gmail-monitor.test.ts
    - src/intake/__tests__/finmo-docs.test.ts
    - src/intake/__tests__/intake-worker.test.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "ioredis added as direct dependency for Redis key-value access (historyId persistence)"
  - "Named import { Redis as IORedis } for NodeNext module compat (default export not constructable)"
  - "Finmo handler uses fire-and-forget queue.add with .then/.catch (respond 202 immediately)"
  - "processIntakeJob catches ConversionError per-attachment without failing the whole job"
  - "IntakeDocument objects logged then discarded (Phase 7 will consume them via classification queue)"

patterns-established:
  - "ioredis class mock: vi.mock('ioredis', () => ({ Redis: class MockIORedis { ... } })) for Vitest 4"
  - "Handler factory pattern: exported function returns Express handler with injected queue dependency"

# Metrics
duration: 6min
completed: 2026-02-14
---

# Phase 6 Plan 04: Intake Monitor, Worker & Barrel Summary

**BullMQ Gmail polling scheduler with Redis historyId persistence, Finmo document webhook handler, and intake worker pipeline that downloads, converts, and produces IntakeDocument objects**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-14T06:06:51Z
- **Completed:** 2026-02-14T06:13:02Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- Gmail monitor scheduler uses BullMQ upsertJobScheduler for periodic inbox polling at configurable interval
- historyId persisted in Redis via ioredis for crash recovery (getStoredHistoryId/storeHistoryId)
- Finmo document webhook handler accepts resthook events with payload extraction and dedup via jobId
- Intake worker processes Gmail messages through full pipeline: download -> extract -> convert -> IntakeDocument
- Barrel export provides single-import surface for all Phase 6 functionality
- 18 new tests (5 gmail-monitor + 5 finmo-docs + 8 intake-worker), 241 total pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Gmail monitor scheduler and Finmo document handler** - `b6ababc` (feat)
2. **Task 2: Create intake worker processing pipeline** - `cce0c43` (feat)
3. **Task 3: Create barrel export and verify full test suite** - `3267777` (feat)

## Files Created/Modified
- `src/intake/gmail-monitor.ts` - BullMQ job scheduler, historyId Redis persistence, intake queue singleton
- `src/intake/finmo-docs.ts` - Express handler factory for Finmo document resthook events
- `src/intake/intake-worker.ts` - processIntakeJob pipeline (Gmail + Finmo stub), worker singleton
- `src/intake/index.ts` - Barrel export for all intake module functionality
- `src/intake/__tests__/gmail-monitor.test.ts` - 5 tests: historyId get/set, scheduler config, disabled skip
- `src/intake/__tests__/finmo-docs.test.ts` - 5 tests: payload extraction, rejection, nested fields, dedup
- `src/intake/__tests__/intake-worker.test.ts` - 8 tests: PDF passthrough, image conversion, Word rejection, size skip, empty, missing ID, Finmo stub
- `package.json` - Added ioredis dependency
- `package-lock.json` - Lock file update

## Decisions Made
- **ioredis as direct dependency:** The project previously avoided top-level ioredis (BullMQ bundles its own). However, historyId persistence requires direct Redis key-value access that BullMQ's Queue API doesn't expose. Added ioredis as an explicit dependency.
- **Named import for ioredis:** `import { Redis as IORedis } from 'ioredis'` instead of default import. With NodeNext module resolution, the default export is not constructable. The named `Redis` export works correctly.
- **Fire-and-forget enqueue in Finmo handler:** The handler responds 202 immediately and enqueues asynchronously with .then/.catch. This ensures webhook responses are never delayed by Redis connection issues.
- **Per-attachment error handling:** ConversionError is caught per-attachment within processIntakeJob. One failed attachment (e.g., Word doc) does not prevent other valid attachments in the same message from being processed.
- **IntakeDocuments not stored yet:** processIntakeJob produces IntakeDocument objects and logs metadata but does not persist them. Phase 7 will consume them via a classification queue (TODO comment added).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed ioredis as direct dependency**
- **Found during:** Task 1 (Gmail monitor historyId persistence)
- **Issue:** Plan specified using `createRedisConnection()` from webhook/queue.ts for ioredis, but ioredis is not available as a top-level module (only bundled inside BullMQ's node_modules). The dynamic import `await import('ioredis')` failed.
- **Fix:** Installed ioredis as a project dependency (`npm install ioredis`). Changed from dynamic import to static `import { Redis as IORedis } from 'ioredis'`.
- **Files modified:** package.json, package-lock.json, src/intake/gmail-monitor.ts
- **Verification:** All 5 gmail-monitor tests pass with mocked ioredis
- **Committed in:** b6ababc (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix necessary for Redis access. No scope creep.

## Issues Encountered
- Vitest 4 mock for ioredis constructor: `vi.fn(() => ...)` returns a function that cannot be used with `new`. Fixed by using a class-based mock: `class MockIORedis { get = mockFn; set = mockFn; quit = mockFn; }`.

## User Setup Required
Gmail readonly scope and docs@ mailbox delegation are needed when live testing begins:
- Add `gmail.readonly` scope to service account domain-wide delegation
- Set `DOC_INBOX` env var to the monitored inbox address
- Re-run OAuth consent flow if using OAuth2 dev mode to include readonly scope

## Next Phase Readiness
- Full document intake pipeline operational: Gmail polling -> message processing -> IntakeDocument production
- Finmo document intake enqueued but awaiting API documentation for file download implementation
- Phase 7 (Classification & Filing) can consume IntakeDocument objects from the intake pipeline
- Barrel export at `src/intake/index.ts` provides clean import surface for integration
- 241 total tests pass with zero regressions

## Self-Check: PASSED

- [x] src/intake/gmail-monitor.ts exists
- [x] src/intake/finmo-docs.ts exists
- [x] src/intake/intake-worker.ts exists
- [x] src/intake/index.ts exists
- [x] src/intake/__tests__/gmail-monitor.test.ts exists
- [x] src/intake/__tests__/finmo-docs.test.ts exists
- [x] src/intake/__tests__/intake-worker.test.ts exists
- [x] Commit b6ababc (Task 1) found
- [x] Commit cce0c43 (Task 2) found
- [x] Commit 3267777 (Task 3) found
- [x] 241/241 tests passing
- [x] No new TypeScript errors

---
*Phase: 06-document-intake*
*Completed: 2026-02-14*
