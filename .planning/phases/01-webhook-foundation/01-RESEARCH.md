# Phase 1: Webhook Foundation - Research

**Researched:** 2026-02-13
**Domain:** Express webhook receiver + BullMQ async queue processing + Redis + deployment
**Confidence:** HIGH

## Summary

Phase 1 wires together the existing Phases 3, 4, and 5 modules (checklist generation, CRM sync, email drafting) behind a reliable webhook-based HTTP server. The architecture is straightforward: Express receives the Finmo "application submitted" resthook, immediately returns HTTP 202, enqueues the applicationId to BullMQ backed by Redis, and a worker processes the job by fetching the full application from the Finmo API and running the existing pipeline. BullMQ provides built-in deduplication via custom jobId, exponential backoff retries, and dead-letter queue semantics. PII safety is achieved through a sanitization layer that strips sensitive fields before any logging occurs.

The technology stack is well-understood and widely deployed. Express 5 is now the npm default with full TypeScript support. BullMQ v5 is the standard Node.js job queue built on Redis with native TypeScript types. Railway offers one-click Redis provisioning and seamless Node.js deployment. The existing codebase already uses TypeScript with NodeNext module resolution and Vitest, so all new code follows the same patterns.

**Primary recommendation:** Use Express 5 + BullMQ v5 + ioredis in a single-process server (web + worker in one process for simplicity at this scale), deployed to Railway with their managed Redis add-on.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^5.2.1 | HTTP server for webhook endpoint | Now the npm default; async error handling built-in; mature Express 5 ecosystem |
| bullmq | ^5.69.1 | Job queue with retry, deduplication, dead-letter | Written in TypeScript; built-in dedup modes; exponential backoff with jitter; the standard Node.js queue library |
| ioredis | ^5.8.2 | Redis client (required by BullMQ) | BullMQ's required Redis driver; built-in TypeScript types; cluster/sentinel support |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/express | ^5.0.6 | TypeScript types for Express 5 | Always — Express 5 needs these for full TS support |
| dotenv | ^17.3.1 | Environment variable loading | Already in project — reuse for new env vars |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Express 5 | Fastify | Fastify is faster but Express is already the industry standard; Railway has Express+BullMQ templates; team familiarity |
| BullMQ | Agenda / custom Redis queue | BullMQ has built-in dedup, backoff, TypeScript types, dead-letter — no reason to hand-roll |
| Railway | Render | Both work; Railway has one-click Redis template and simpler BullMQ deployment; Render requires separate Background Worker service for queue processing |
| Single-process | Separate web + worker processes | At this scale (< 10 webhooks/day), single process is simpler; split later if needed |

**Installation:**
```bash
npm install express bullmq ioredis
npm install -D @types/express
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── checklist/       # [existing] Checklist generation engine
├── crm/             # [existing] CRM integration (syncChecklistToCrm)
├── email/           # [existing] Email drafting (createEmailDraft)
├── webhook/         # [NEW] Webhook infrastructure
│   ├── server.ts        # Express app setup + webhook route
│   ├── queue.ts         # BullMQ queue + connection config
│   ├── worker.ts        # Job processor (orchestrates existing modules)
│   ├── sanitize.ts      # PII sanitization for logging
│   ├── finmo-client.ts  # Finmo API fetch (GET /applications/:id)
│   ├── types.ts         # Webhook payload types, job data types
│   ├── health.ts        # Health check endpoint
│   └── __tests__/       # Tests for webhook layer
├── config.ts        # [NEW or extend] Shared config (kill switch, Redis URL)
└── index.ts         # [NEW] Application entry point (starts server + worker)
```

### Pattern 1: Immediate ACK + Async Processing
**What:** Webhook endpoint immediately returns HTTP 202 and enqueues job; worker processes asynchronously.
**When to use:** Always for webhook receivers — prevents timeout, enables retry.
**Example:**
```typescript
// Source: Express + BullMQ standard pattern
import express from 'express';
import { Queue } from 'bullmq';

const app = express();
const queue = new Queue('finmo-webhooks', { connection: redisConnection });

app.post('/webhooks/finmo', async (req, res) => {
  // Kill switch check
  if (process.env.AUTOMATION_KILL_SWITCH === 'true') {
    return res.status(503).json({ message: 'Automation disabled' });
  }

  const { applicationId } = req.body;

  await queue.add('process-application', { applicationId }, {
    jobId: `finmo-app-${applicationId}`, // Deduplication by applicationId
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  });

  res.status(202).json({ accepted: true, applicationId });
});
```

### Pattern 2: BullMQ Deduplication via jobId
**What:** Using the applicationId as the BullMQ jobId prevents duplicate processing when Finmo retries webhook delivery.
**When to use:** Every webhook enqueue — Finmo retries up to 300 times on failure.
**Example:**
```typescript
// Source: https://docs.bullmq.io/guide/jobs/job-ids
// If a job with this ID already exists in the queue, the add is silently ignored.
await queue.add('process-application', { applicationId }, {
  jobId: `finmo-app-${applicationId}`,
  // removeOnComplete is important: once removed, the same jobId CAN be re-added.
  // For webhooks, we want completed jobs to stay (preventing re-processing).
  removeOnComplete: false,
  removeOnFail: false,
});
```

**Key insight:** BullMQ's jobId dedup prevents duplicate processing even under Finmo's aggressive 300-retry delivery. Jobs that remain in the queue (completed or failed) with the same ID cause new `add()` calls to be silently ignored. This is the simplest and most reliable dedup strategy.

**Alternative (if needed):** BullMQ also has a dedicated `deduplication` option with `id` and optional `ttl` for more sophisticated dedup windows, but the jobId approach is sufficient for webhook idempotency.

### Pattern 3: Worker Orchestration of Existing Modules
**What:** The BullMQ worker calls the existing pipeline: fetch Finmo app -> generateChecklist -> syncChecklistToCrm -> createEmailDraft.
**When to use:** The worker processor function — this is the core orchestration.
**Example:**
```typescript
// Source: Project architecture — wiring existing modules
import { Worker, Job } from 'bullmq';
import { generateChecklist } from '../checklist/engine/index.js';
import { syncChecklistToCrm } from '../crm/index.js';
import { createEmailDraft } from '../email/index.js';

const worker = new Worker('finmo-webhooks', async (job: Job) => {
  const { applicationId } = job.data;

  // 1. Fetch full application from Finmo API
  const finmoApp = await fetchFinmoApplication(applicationId);

  // 2. Generate checklist (pure function)
  const checklist = generateChecklist(finmoApp);

  // 3. Sync to CRM (upsert contact, create task, move pipeline)
  const mainBorrower = finmoApp.borrowers.find(b => b.isMainBorrower)!;
  const crmResult = await syncChecklistToCrm({
    checklist,
    borrowerEmail: mainBorrower.email,
    borrowerFirstName: mainBorrower.firstName,
    borrowerLastName: mainBorrower.lastName,
    borrowerPhone: mainBorrower.phone ?? undefined,
    finmoDealId: applicationId,
  });

  // 4. Create email draft for Cat to review
  const emailResult = await createEmailDraft({
    checklist,
    recipientEmail: mainBorrower.email,
    borrowerFirstNames: finmoApp.borrowers.map(b => b.firstName),
    contactId: crmResult.contactId,
  });

  return {
    applicationId,
    contactId: crmResult.contactId,
    draftId: emailResult.draftId,
    warnings: checklist.warnings,
  };
}, { connection: redisConnection, concurrency: 1 });
```

### Pattern 4: PII Sanitization Layer
**What:** A sanitize function strips sensitive fields from any object before logging.
**When to use:** Before ANY console.log/console.error that might contain Finmo API data.
**Example:**
```typescript
// Custom sanitizer — no library needed for known field list
const PII_FIELDS = new Set([
  'sinNumber', 'email', 'phone', 'workPhone', 'phoneNumber',
  'birthDate', 'income', 'incomePeriodAmount', 'balance',
  'creditLimit', 'monthlyPayment', 'creditScore',
  'line1', 'line2', 'streetNumber', 'streetName', 'postCode',
  'ipAddress', 'location',
]);

function sanitizeForLog(obj: unknown, depth = 0): unknown {
  if (depth > 10 || obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return `[Array(${obj.length})]`;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (PII_FIELDS.has(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLog(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
```

### Pattern 5: Kill Switch
**What:** Environment variable check at webhook entry point and worker startup.
**When to use:** Must be checked before enqueuing any job.
**Example:**
```typescript
// Check at startup
if (process.env.AUTOMATION_KILL_SWITCH === 'true') {
  console.log('[KILL SWITCH] Automation disabled — server will accept webhooks but not process');
}

// Check at webhook endpoint
app.post('/webhooks/finmo', (req, res) => {
  if (process.env.AUTOMATION_KILL_SWITCH === 'true') {
    return res.status(503).json({ message: 'Automation disabled' });
  }
  // ... enqueue job
});

// Also check in worker (belt and suspenders)
const worker = new Worker('finmo-webhooks', async (job) => {
  if (process.env.AUTOMATION_KILL_SWITCH === 'true') {
    throw new Error('Automation disabled by kill switch');
  }
  // ... process job
});
```

### Anti-Patterns to Avoid
- **Processing in the webhook handler:** Never run the full pipeline synchronously in the POST handler. Finmo will timeout and retry, causing duplicate processing. Always enqueue and return 202.
- **Logging raw webhook payloads:** The Finmo API response contains SIN numbers, income amounts, addresses. Never `console.log(req.body)` or `console.log(finmoApp)`. Always sanitize first.
- **Using `removeOnComplete: true` with dedup:** If completed jobs are removed, the same jobId can be re-added, defeating deduplication. Keep completed jobs (or use a TTL-based auto-removal that's longer than Finmo's retry window).
- **Sharing ioredis connections between Queue and Worker:** BullMQ docs state Queue and Worker should use separate connections. The connection option creates a new connection per instance, which is correct.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Job queue with retries | Custom Redis pub/sub queue | BullMQ | Handles retry, backoff, dedup, dead-letter, concurrency — hundreds of edge cases |
| Webhook deduplication | Custom "processed IDs" database table | BullMQ jobId | BullMQ natively ignores duplicate jobIds; no extra storage needed |
| Exponential backoff | setTimeout chains | BullMQ backoff option | Built-in with jitter support; handles process restarts |
| Dead-letter queue | Custom failed-jobs table | BullMQ failed jobs + events | BullMQ tracks failed jobs with full error history; query via API |
| HTTP server | Raw Node http module | Express 5 | Middleware, routing, error handling, body parsing — solved problems |
| Webhook signature verification | Custom RSA-SHA256 implementation | Node.js crypto module | Standard library; Finmo provides the exact code pattern |

**Key insight:** This phase is infrastructure glue. Every problem here (queue, dedup, retry, HTTP handling) has mature library solutions. The only custom code should be the orchestration logic connecting existing modules and the PII sanitization list.

## Common Pitfalls

### Pitfall 1: Finmo Webhook Payload is NOT the Full Application
**What goes wrong:** Assuming the webhook POST body contains the full application data (borrowers, incomes, etc.). The resthook likely only contains an applicationId and event metadata.
**Why it happens:** Webhook payloads are typically lightweight notifications, not full data dumps.
**How to avoid:** Always fetch the full application from `GET /api/v1/applications/{applicationId}` using the Finmo API key after receiving the webhook. The webhook payload is just a trigger.
**Warning signs:** If you're trying to extract borrower data from `req.body`, you're doing it wrong.

### Pitfall 2: PII Leaking into Logs
**What goes wrong:** A `console.log(job.data)` or error stack trace includes SIN numbers, income amounts, or addresses from the Finmo API response.
**Why it happens:** The Finmo application response contains `sinNumber` directly on borrower objects. Any unguarded log statement will expose PII.
**How to avoid:** Never log raw Finmo API responses. Use the sanitization function on any data before logging. Only log metadata: applicationId, borrower count, checklist item count, job status.
**Warning signs:** grep the codebase for `console.log` statements that log `finmoApp`, `response`, `job.data`, or `borrower` objects.

### Pitfall 3: Redis Connection Not Using maxRetriesPerRequest: null
**What goes wrong:** BullMQ throws `MaxRetriesPerRequestError` at startup or during operation.
**Why it happens:** ioredis defaults to retrying failed commands 20 times then throwing. BullMQ's blocking commands (BRPOPLPUSH) need unlimited retries.
**How to avoid:** Always set `maxRetriesPerRequest: null` in the ioredis connection config for BullMQ.
**Warning signs:** Errors mentioning "maxRetriesPerRequest" in the console.

### Pitfall 4: Completed Job Removal Defeating Deduplication
**What goes wrong:** Setting `removeOnComplete: true` causes a Finmo retry (which can happen up to 300 times) to re-add and re-process the same application.
**Why it happens:** BullMQ only deduplicates against jobs that still exist in the queue. Removed jobs don't count as duplicates.
**How to avoid:** Use `removeOnComplete: { age: 86400 }` (24 hours) or `removeOnComplete: false`. Finmo retries with exponential backoff up to ~24 hours, so keeping jobs for at least 24 hours prevents re-processing.
**Warning signs:** Seeing the same applicationId processed multiple times in logs.

### Pitfall 5: Single Worker Blocking on Slow Jobs
**What goes wrong:** A slow Finmo API call or CRM call blocks all subsequent webhook processing.
**Why it happens:** Default concurrency is 1 — one slow job blocks the entire queue.
**How to avoid:** Set `concurrency: 1` intentionally for now (simplicity, avoids race conditions on CRM upsert). If latency becomes an issue, increase to 2-3. At current volume (< 10 apps/day), this is fine.
**Warning signs:** Jobs stuck in "waiting" state for extended periods.

### Pitfall 6: Finmo Resthook Signature Verification Complexity
**What goes wrong:** Implementing RSA-SHA256 with PSS padding incorrectly, or skipping verification entirely.
**Why it happens:** The signature verification uses RSA_PKCS1_PSS_PADDING which is less common than PKCS1v15.
**How to avoid:** Use the exact Node.js code pattern from Finmo's help docs. Store the public key in an environment variable. Make verification optional initially (log warnings for invalid signatures) to avoid blocking the pipeline during development.
**Warning signs:** All webhooks failing signature verification when enabled.

### Pitfall 7: Express 5 Async Error Handling
**What goes wrong:** Unhandled promise rejections in route handlers crash the process.
**Why it happens:** Express 4 didn't handle async errors automatically. Express 5 does, but only if the route handler returns a promise.
**How to avoid:** Express 5 natively catches rejected promises from async route handlers and forwards them to error middleware. Ensure all route handlers are `async` functions. Add a global error handler middleware.
**Warning signs:** Unhandled promise rejection warnings in the console.

## Code Examples

Verified patterns from official sources:

### BullMQ Queue + Worker Setup with Exponential Backoff
```typescript
// Source: https://docs.bullmq.io/readme-1 + https://docs.bullmq.io/guide/retrying-failing-jobs
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

// Shared connection config — BullMQ creates its own connections from this
const redisConnection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Required by BullMQ
};

// Queue with default job options
const queue = new Queue('finmo-webhooks', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s, 40s, 80s
    },
    removeOnComplete: { age: 86400 }, // Keep for 24h (dedup window)
    removeOnFail: false, // Keep failed jobs for manual review (dead-letter)
  },
});

// Worker
const worker = new Worker('finmo-webhooks', async (job) => {
  // Process job...
}, {
  connection: redisConnection,
  concurrency: 1,
});

worker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed: ${err.message}`);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    console.error(`[worker] Job ${job.id} exhausted all retries — in dead-letter`);
  }
});
```

### Finmo Resthook Signature Verification
```typescript
// Source: https://help.finmo.ca/en/articles/7792773-how-to-verify-finmo-resthook-signatures-beta
import crypto from 'node:crypto';

function verifyFinmoSignature(
  publicKey: string,
  signature: string,
  rawBody: string
): boolean {
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(rawBody);
  return verifier.verify(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING },
    signature,
    'base64'
  );
}

// In Express middleware:
app.post('/webhooks/finmo', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['finmo-resthook-signature'] as string;
  const rawBody = req.body.toString();
  const payload = JSON.parse(rawBody);

  if (process.env.FINMO_RESTHOOK_PUBLIC_KEY) {
    const valid = verifyFinmoSignature(
      process.env.FINMO_RESTHOOK_PUBLIC_KEY,
      signature,
      rawBody,
    );
    if (!valid) {
      console.warn('[webhook] Invalid Finmo signature — rejecting');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // ... enqueue job
});
```

### Railway Redis Connection via REDIS_URL
```typescript
// Source: https://docs.railway.com/guides/redis
// Railway provides REDIS_URL env var when Redis service is added
import { Redis } from 'ioredis';

function createRedisConnection() {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    // Railway provides full connection string
    return new Redis(redisUrl, { maxRetriesPerRequest: null });
  }
  // Local development fallback
  return new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
  });
}
```

### Express 5 Health Check + Error Handler
```typescript
// Source: Express 5 docs
import express from 'express';

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    killSwitch: process.env.AUTOMATION_KILL_SWITCH === 'true',
  });
});

// Global error handler (Express 5 — catches async errors automatically)
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bull (npm package) | BullMQ | 2021+ | BullMQ is the successor; Bull is maintenance-only. Use BullMQ. |
| Express 4 | Express 5 | Oct 2024 (v5.0), Mar 2025 (default on npm) | Express 5 handles async errors natively; no need for express-async-handler wrapper |
| @types/ioredis separate package | ioredis ships own types | ioredis v5 | No need to install @types/ioredis — types are bundled |
| Custom retry logic | BullMQ built-in backoff | Always in BullMQ | exponential + jitter built-in; custom strategies via backoffStrategy option |
| Custom dedup table | BullMQ jobId / deduplication option | BullMQ v4+ dedup, v5 enhanced | BullMQ added dedicated deduplication feature with TTL support |

**Deprecated/outdated:**
- **Bull:** Use BullMQ instead. Bull is the predecessor and is no longer actively developed.
- **Express 4:** Express 5 is now the npm default. Express 4 receives only security patches.
- **@types/ioredis:** Not needed. ioredis v5+ ships its own TypeScript declarations.
- **express-async-handler:** Not needed with Express 5 which catches async errors automatically.

## Open Questions

1. **Finmo Resthook Payload Format**
   - What we know: The resthook fires on "Application submitted by borrower". Signature uses RSA-SHA256 with PSS padding in `finmo-resthook-signature` header. Public key is in Team Settings > Integrations.
   - What's unclear: The exact JSON payload structure of the "application submitted" resthook. Does it contain just the `applicationId`? Does it include applicant name? Is it wrapped in an event envelope?
   - Recommendation: Set up a temporary webhook receiver (e.g., webhook.site or a simple Express endpoint that logs the sanitized payload) to capture a real resthook payload. Alternatively, design the handler to extract `applicationId` from several possible payload shapes and fetch the full application regardless. The key fields we need are only the `applicationId` (to fetch full data) and optionally event metadata for logging.

2. **Finmo Resthook Public Key Format**
   - What we know: Public key is on Team Settings > Integrations page under "Resthooks" section.
   - What's unclear: Is it PEM format? Base64-encoded? How long is it?
   - Recommendation: Retrieve the public key from the Finmo dashboard and store as `FINMO_RESTHOOK_PUBLIC_KEY` env var. Make signature verification optional (warn-only) during initial development.

3. **Railway vs Render Final Decision**
   - What we know: Both support Node.js + Redis. Railway has a BullMQ+Redis one-click template. Render requires separate web service and background worker processes.
   - What's unclear: Pricing at low volume, whether Railway's free tier is sufficient for Redis persistence.
   - Recommendation: Use Railway. One-click Redis template, single-service deployment (web + worker in one process), simpler configuration. The BullMQ template confirms official Railway support.

4. **Redis Persistence and Data Loss**
   - What we know: Railway Redis is a managed service. BullMQ stores all job state in Redis.
   - What's unclear: Whether Railway Redis has persistence (RDB/AOF) enabled by default.
   - Recommendation: Acceptable risk for now. If Redis restarts and loses state, worst case is re-processing a webhook (which is idempotent). The Finmo API fetch + checklist generation is deterministic.

## Sources

### Primary (HIGH confidence)
- [BullMQ Quick Start](https://docs.bullmq.io/readme-1) — Installation, queue/worker setup, event listening
- [BullMQ Job IDs](https://docs.bullmq.io/guide/jobs/job-ids) — Custom jobId for deduplication, naming constraints
- [BullMQ Deduplication](https://docs.bullmq.io/guide/jobs/deduplication) — Simple/throttle/debounce modes, deduplication events
- [BullMQ Retrying Failing Jobs](https://docs.bullmq.io/guide/retrying-failing-jobs) — Exponential backoff, jitter, custom strategies, default job options
- [BullMQ Concurrency](https://docs.bullmq.io/guide/workers/concurrency) — Worker concurrency settings, async requirement
- [Finmo Resthook Signature Verification](https://help.finmo.ca/en/articles/7792773-how-to-verify-finmo-resthook-signatures-beta) — RSA-SHA256 with PSS padding, Node.js code example
- [Finmo REST API](https://help.finmo.ca/en/articles/6381437-finmo-rest-api) — Bearer token auth, endpoints, token generation
- [Express 5.1.0 Release](https://expressjs.com/2025/03/31/v5-1-latest-release.html) — Express 5 is now npm default

### Secondary (MEDIUM confidence)
- [Railway Redis Guide](https://docs.railway.com/guides/redis) — Redis add-on, REDIS_URL env var, private networking
- [Railway BullMQ Template](https://railway.com/deploy/odzp-I) — One-click BullMQ + BullBoard deployment template
- [ioredis npm](https://www.npmjs.com/package/ioredis) — v5.8.2, built-in TypeScript types
- [Finmo API Reference (project)](C:/Users/lucac/projects/taylor_atkinson/.planning/FINMO_API_REFERENCE.md) — Confirmed endpoints, webhook events, sample data

### Tertiary (LOW confidence)
- Finmo resthook payload format — No official documentation found for the exact JSON structure of the "application submitted" event. Need to capture a real payload.
- Railway Redis persistence defaults — Not confirmed whether RDB/AOF is enabled by default on Railway managed Redis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Express, BullMQ, ioredis are well-documented with verified current versions
- Architecture: HIGH — Webhook-to-queue pattern is standard; existing modules have clean interfaces
- Pitfalls: HIGH — Documented from official BullMQ docs and known webhook processing patterns
- Finmo webhook payload: LOW — Exact payload format unknown; need to capture a real event

**Research date:** 2026-02-13
**Valid until:** 2026-03-13 (stable libraries, 30-day window)
