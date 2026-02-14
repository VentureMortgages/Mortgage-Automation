---
phase: 01-webhook-foundation
plan: 03
subsystem: webhook
tags: [bullmq-worker, finmo-api, pipeline-orchestration, graceful-shutdown, express]

# Dependency graph
requires:
  - phase: 01-01
    provides: "AppConfig, webhook types (JobData, ProcessingResult), PII sanitizer"
  - phase: 01-02
    provides: "Express webhook server (createApp), BullMQ queue (createRedisConnection, QUEUE_NAME, closeQueue)"
  - phase: 03-checklist-generation
    provides: "generateChecklist function that takes FinmoApplicationResponse"
  - phase: 04-crm-integration
    provides: "syncChecklistToCrm orchestrator with SyncChecklistInput/Result"
  - phase: 05-email-drafting
    provides: "createEmailDraft with CreateEmailDraftInput/Result"
provides:
  - "fetchFinmoApplication — Finmo API client to fetch full application by ID (src/webhook/finmo-client.ts)"
  - "processJob — pipeline orchestrator: fetch -> checklist -> CRM -> email (src/webhook/worker.ts)"
  - "createWorker/closeWorker — BullMQ worker lifecycle (src/webhook/worker.ts)"
  - "Application entry point starting server + worker in single process (src/index.ts)"
  - "Graceful shutdown on SIGTERM/SIGINT (src/index.ts)"
  - "package.json start and dev scripts"
affects: [deployment, railway-setup, end-to-end-testing]

# Tech tracking
tech-stack:
  added: []
  patterns: [pipeline-orchestration, single-process-server-worker, graceful-shutdown, exported-processJob-for-testing]

key-files:
  created:
    - src/webhook/finmo-client.ts
    - src/webhook/worker.ts
    - src/webhook/__tests__/worker.test.ts
    - src/index.ts
  modified:
    - package.json

key-decisions:
  - "processJob exported directly for unit testing without BullMQ Worker infrastructure"
  - "Single process for server + worker (appropriate for <10 webhooks/day scale)"
  - "Shutdown order: HTTP server -> worker -> queue (prevents orphan connections)"
  - "Worker concurrency 1 (sequential processing, sufficient for current volume)"
  - "Kill switch checked at both webhook layer and worker layer (belt-and-suspenders)"

patterns-established:
  - "Pipeline orchestration: sequential step execution with natural error propagation for BullMQ retry"
  - "Graceful shutdown: SIGTERM/SIGINT handlers closing resources in reverse-creation order"
  - "Finmo API client: bearer auth, PII-safe logging (metadata only), typed response"

# Metrics
duration: 4min
completed: 2026-02-13
---

# Phase 01 Plan 03: Worker Pipeline Orchestrator and Entry Point Summary

**BullMQ worker orchestrating fetch-checklist-CRM-email pipeline with Finmo API client, graceful shutdown entry point, and 14 orchestration tests**

## Performance

- **Duration:** 4 min
- **Tasks:** 2
- **Files created:** 4
- **Files modified:** 1

## Accomplishments
- Finmo API client fetching full application by ID with bearer token auth and PII-safe metadata logging
- BullMQ worker orchestrating the complete pipeline: Finmo fetch -> checklist generation -> CRM sync -> email draft creation
- Application entry point running Express server and BullMQ worker in a single process with graceful shutdown
- 14 comprehensive tests covering happy path, failure propagation, pipeline ordering, kill switch, and edge cases
- 183 total tests passing (14 new + 169 existing, zero regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Finmo API client, worker orchestrator, and tests** - `9d4322d` (feat)
2. **Task 2: Application entry point with graceful shutdown** - `cbfb90b` (feat)

## Files Created/Modified
- `src/webhook/finmo-client.ts` - Finmo API client with bearer auth, PII-safe logging, typed FinmoApplicationResponse return
- `src/webhook/worker.ts` - BullMQ worker with processJob pipeline (fetch -> checklist -> CRM -> email), createWorker/closeWorker lifecycle
- `src/webhook/__tests__/worker.test.ts` - 14 tests: happy path, failure modes, ordering, kill switch, null phone, multi-borrower, CRM errors
- `src/index.ts` - Entry point starting server + worker, graceful shutdown on SIGTERM/SIGINT
- `package.json` - Added "start" (node dist/index.js) and "dev" (tsx src/index.ts) scripts

## Decisions Made
- processJob exported directly (not via `_processJob`) for clean unit testing without BullMQ infrastructure
- Single process for server + worker (appropriate for <10 webhooks/day; can split later if needed)
- Shutdown order: HTTP server -> worker -> queue (prevents accepting requests after worker stops)
- Worker concurrency set to 1 (sequential processing, avoids race conditions at current scale)
- Kill switch checked at worker level in addition to webhook layer (belt-and-suspenders defense)
- BullMQ module fully mocked in tests (no real Redis connections needed for unit tests)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript errors in src/email/setup/test-draft.ts (verified identical before and after changes; setup script, not runtime code)

## User Setup Required

**External services require manual configuration.** Per plan frontmatter user_setup:
- Install npm packages (express, bullmq, ioredis are already installed)
- Add Redis service to Railway project
- Configure environment variables: REDIS_URL, AUTOMATION_KILL_SWITCH, FINMO_API_KEY, FINMO_RESTHOOK_PUBLIC_KEY
- Configure Finmo resthook URL to point to Railway deployment

## Next Phase Readiness
- Phase 1 (Webhook Foundation) is now COMPLETE: all 3 plans executed
- End-to-end pipeline: webhook POST -> BullMQ queue -> worker -> Finmo API -> checklist -> CRM -> email draft
- Ready for deployment setup (Railway), external service configuration, and end-to-end testing
- 183 total tests passing across all modules

## Self-Check: PASSED

All 4 created files exist on disk. Both task commits (9d4322d, cbfb90b) verified in git log.

---
*Phase: 01-webhook-foundation*
*Completed: 2026-02-13*
