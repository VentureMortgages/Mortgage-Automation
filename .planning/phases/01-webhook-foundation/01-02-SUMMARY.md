---
phase: 01-webhook-foundation
plan: 02
subsystem: infra
tags: [express, bullmq, redis, webhook, http, queue, deduplication, retry, health-check]

# Dependency graph
requires:
  - "AppConfig with kill switch, Redis, Finmo config (src/config.ts) from 01-01"
  - "WebhookPayload, JobData types (src/webhook/types.ts) from 01-01"
  - "sanitizeForLog PII redaction function (src/webhook/sanitize.ts) from 01-01"
provides:
  - "Express HTTP server with POST /webhooks/finmo endpoint (src/webhook/server.ts)"
  - "BullMQ queue with dedup, exponential backoff, dead-letter config (src/webhook/queue.ts)"
  - "Health check endpoint GET /health (src/webhook/health.ts)"
  - "extractApplicationId helper for multiple Finmo payload shapes"
  - "createApp factory for Express app instantiation"
  - "getWebhookQueue lazy singleton, createRedisConnection factory, closeQueue shutdown"
affects: [01-03, worker, deployment, monitoring]

# Tech tracking
tech-stack:
  added: [express@5, bullmq, supertest]
  patterns: [redis-url-parsing, lazy-singleton-queue, dedup-via-jobid, extract-with-fallback-shapes, vi-hoisted-mocks]

key-files:
  created:
    - src/webhook/queue.ts
    - src/webhook/server.ts
    - src/webhook/health.ts
    - src/webhook/__tests__/server.test.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Redis URL parsed into host/port/password config instead of creating ioredis instance (avoids ioredis version mismatch between top-level and bullmq-bundled ioredis)"
  - "No top-level ioredis dependency — bullmq bundles its own ioredis internally"
  - "vi.hoisted() for mock variables in Vitest 4 (factory functions are hoisted above variable declarations)"
  - "extractApplicationId exported for direct unit testing of payload shape handling"
  - "createApp factory pattern for test isolation (fresh Express instance per test)"

patterns-established:
  - "Redis URL parsing: new URL(redisUrl) to extract host/port/password (no ioredis dependency needed)"
  - "Lazy singleton queue: getWebhookQueue() creates on first call, closeQueue() resets"
  - "Dedup via BullMQ jobId: finmo-app-{applicationId} prevents duplicate processing"
  - "Multi-shape payload extraction: try direct field, nested data, nested application, UUID-like id"
  - "vi.hoisted() for test mock variables shared between vi.mock factory and test body"

# Metrics
duration: 5min
completed: 2026-02-14
---

# Phase 01 Plan 02: Webhook Receiver and BullMQ Queue Summary

**Express 5 webhook receiver with BullMQ queue dedup (jobId), exponential backoff retry (5 attempts), kill switch at HTTP layer, and 16 tests with mocked queue**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-14T03:19:05Z
- **Completed:** 2026-02-14T03:24:28Z
- **Tasks:** 2
- **Files created:** 4
- **Files modified:** 2 (package.json, package-lock.json)

## Accomplishments
- Express 5 server with POST /webhooks/finmo returning 202 (accepted), 400 (missing ID), or 503 (kill switch)
- BullMQ queue with lazy singleton pattern, exponential backoff (5s/10s/20s/40s/80s), 24h retention, and dead-letter preservation
- Multi-shape applicationId extraction (direct, data.applicationId, application.id, UUID-like id)
- Health check endpoint returning server status, kill switch state, timestamp, and version
- 16 tests covering all HTTP responses, dedup jobId, payload shapes, and edge cases — no Redis required

## Task Commits

Each task was committed atomically:

1. **Task 1: Create BullMQ queue with Redis connection and dedup config** - `6afe6dc` (feat)
2. **Task 2: Create Express server with webhook route, health check, and tests** - `3e3514e` (feat)

## Files Created/Modified
- `src/webhook/queue.ts` - BullMQ queue with lazy singleton, Redis URL parser, exponential backoff config, close/shutdown support
- `src/webhook/server.ts` - Express 5 app factory with POST /webhooks/finmo (kill switch, applicationId extraction, enqueue with dedup), error handler
- `src/webhook/health.ts` - GET /health handler returning status, killSwitch, timestamp, version
- `src/webhook/__tests__/server.test.ts` - 16 tests: 7 webhook endpoint, 2 health check, 7 extractApplicationId
- `package.json` - Added express, bullmq, supertest, @types/express, @types/supertest

## Decisions Made
- Parsed Redis URL into config object instead of creating ioredis instance — avoids version mismatch between top-level ioredis and bullmq's bundled ioredis (different patch versions cause TypeScript type incompatibility)
- No top-level ioredis dependency installed — bullmq handles Redis connections internally with its own bundled ioredis
- Used `vi.hoisted()` for mock variables in Vitest 4 — factory functions are hoisted above `const` declarations, so shared mock variables need explicit hoisting
- Exported `extractApplicationId` from server.ts for direct unit testing of payload shape handling logic
- Used `createApp` factory pattern for test isolation — each test creates a fresh Express app without shared state

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Redis URL parsed instead of ioredis instance construction**
- **Found during:** Task 1 (BullMQ queue creation)
- **Issue:** Plan specified creating `new Redis(url)` ioredis instance for REDIS_URL. Installing ioredis as top-level dependency created TypeScript type incompatibility with bullmq's bundled ioredis (5.9.3 vs 5.9.2 — different AbstractConnector types)
- **Fix:** Removed top-level ioredis dependency. Wrote parseRedisUrl() function using URL API to extract host/port/password from Redis URL, returning a plain config object that BullMQ accepts
- **Files modified:** src/webhook/queue.ts, package.json
- **Verification:** TypeScript compiles clean, BullMQ accepts the config object
- **Committed in:** 6afe6dc (Task 1 commit)

**2. [Rule 3 - Blocking] Used vi.hoisted() for mock variable declarations**
- **Found during:** Task 2 (server tests)
- **Issue:** vi.mock() factory functions are hoisted above const declarations in Vitest 4, causing "Cannot access before initialization" error when factory references mockConfig/mockQueueAdd
- **Fix:** Wrapped shared mock variables in vi.hoisted() callback which runs before mock hoisting
- **Files modified:** src/webhook/__tests__/server.test.ts
- **Verification:** All 16 tests pass
- **Committed in:** 3e3514e (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking issues)
**Impact on plan:** Both fixes necessary for compilation and test execution. No scope creep — same functionality delivered via different mechanism.

## Issues Encountered
- Pre-existing TypeScript errors in src/email/setup/test-draft.ts (8 errors, not related to this plan's files; noted in 01-01-SUMMARY.md)

## User Setup Required

None - no external service configuration required. Redis connection is configured via environment variables (REDIS_URL or REDIS_HOST/PORT/PASSWORD) already defined in src/config.ts from plan 01-01.

## Next Phase Readiness
- Express server ready for 01-03 worker to import queue and process jobs
- getWebhookQueue provides the same queue instance to server (enqueue) and worker (dequeue)
- closeQueue available for graceful shutdown in worker/server lifecycle
- createApp factory ready for integration tests if needed
- 169 total tests passing (16 new + 153 prior)

## Self-Check: PASSED

All 4 files exist on disk. Both commits verified in git log (6afe6dc, 3e3514e).

---
*Phase: 01-webhook-foundation*
*Completed: 2026-02-14*
