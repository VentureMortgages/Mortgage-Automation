# Architecture Research: Webhook-Driven Document Automation

**Domain:** Webhook-driven automation service with multiple API integrations
**Researched:** 2026-02-09
**Confidence:** HIGH

## Recommended Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Ingestion Layer                               │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐             │
│  │   Webhook    │   │    Gmail     │   │   Scheduled  │             │
│  │   Receiver   │   │   Monitor    │   │    Cron      │             │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘             │
│         │ (202 ack)        │ (poll)            │ (trigger)           │
├─────────┴──────────────────┴───────────────────┴──────────────────────┤
│                         Queue Layer (Redis + BullMQ)                  │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐             │
│  │  Checklist   │   │   Document   │   │   Reminder   │             │
│  │    Queue     │   │    Queue     │   │    Queue     │             │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘             │
│         │                   │                   │                     │
│         └───────────────────┴───────────────────┘                     │
│                             │                                         │
│  ┌──────────────────────────┴──────────────────────────────┐         │
│  │              Dead Letter Queue (DLQ)                     │         │
│  └──────────────────────────────────────────────────────────┘         │
├──────────────────────────────────────────────────────────────────────┤
│                        Processing Layer                               │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐             │
│  │  Checklist   │   │   Document   │   │   Reminder   │             │
│  │   Worker     │   │  Classifier  │   │   Worker     │             │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘             │
│         │                   │                   │                     │
├─────────┴───────────────────┴───────────────────┴──────────────────────┤
│                      Integration Layer                                │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐             │
│  │    Finmo     │   │ GoHighLevel  │   │    Gmail     │             │
│  │   Client     │   │  CRM Client  │   │     API      │             │
│  └──────────────┘   └──────────────┘   └──────────────┘             │
│                                                                       │
│  ┌──────────────┐                                                     │
│  │  Google      │                                                     │
│  │  Drive API   │                                                     │
│  └──────────────┘                                                     │
├──────────────────────────────────────────────────────────────────────┤
│                         Data Layer                                    │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐             │
│  │  PostgreSQL  │   │    Redis     │   │   S3/Blob    │             │
│  │  (metadata)  │   │   (cache)    │   │  (optional)  │             │
│  └──────────────┘   └──────────────┘   └──────────────┘             │
└──────────────────────────────────────────────────────────────────────┘

Human-in-the-Loop: Draft Review Queue
┌──────────────────────────────────────┐
│   Draft emails stored in DB          │
│   Cat reviews via CRM or email       │
│   Approval triggers send             │
└──────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Webhook Receiver** | Accept Finmo webhooks, validate signature, return 202 immediately, enqueue payload | Express.js endpoint with signature validation middleware |
| **Gmail Monitor** | Poll Gmail API for new docs, detect attachments, extract metadata | Scheduled BullMQ job every 5-10 min |
| **Scheduled Cron** | Trigger reminder jobs, periodic cleanup tasks | BullMQ repeatable jobs with cron expressions |
| **Queue Layer** | Reliable message queue with retry, idempotency, DLQ | BullMQ backed by Redis |
| **Checklist Worker** | Parse application data, apply DOC_CHECKLIST_RULES_V2, generate personalized checklist, create draft email | Node.js worker consuming from BullMQ |
| **Document Classifier** | Classify PDFs by content, rename files, file to correct Drive folder, update tracking | Worker with PDF parsing + AI classification |
| **Reminder Worker** | Check missing docs, generate follow-up drafts, update CRM tasks | Scheduled worker with conditional logic |
| **API Clients** | Encapsulate external API calls with retry, rate limiting, error handling | Axios-based clients with interceptors |
| **PostgreSQL** | Store application metadata, checklist status, email drafts, idempotency keys | Relational DB with migrations |
| **Redis** | BullMQ queue storage, session cache, rate limiting, idempotency deduplication | Redis 6+ with persistence |

## Recommended Project Structure

```
src/
├── api/                    # External API integrations
│   ├── finmo/              # Finmo API client
│   │   ├── client.ts       # Base client with auth
│   │   ├── webhooks.ts     # Webhook signature validation
│   │   └── types.ts        # TypeScript types
│   ├── gohighlevel/        # GoHighLevel CRM client
│   │   ├── client.ts
│   │   ├── contacts.ts
│   │   ├── tasks.ts
│   │   └── types.ts
│   ├── gmail/              # Gmail API client
│   │   ├── client.ts
│   │   ├── monitor.ts      # Polling logic
│   │   └── sender.ts       # Send emails
│   └── drive/              # Google Drive API client
│       ├── client.ts
│       └── uploader.ts
├── ingestion/              # Webhook receivers + cron triggers
│   ├── routes/             # Express routes
│   │   └── webhooks.ts     # POST /webhooks/finmo
│   ├── middleware/         # Validation, auth
│   │   ├── signature.ts
│   │   └── error.ts
│   └── server.ts           # Express app
├── queues/                 # BullMQ queue definitions
│   ├── checklist.queue.ts
│   ├── document.queue.ts
│   ├── reminder.queue.ts
│   └── dlq.queue.ts
├── workers/                # Queue workers
│   ├── checklist.worker.ts # Processes new applications
│   ├── document.worker.ts  # Classifies + files docs
│   ├── reminder.worker.ts  # Sends reminders
│   └── worker.ts           # Worker bootstrap
├── services/               # Business logic
│   ├── checklist/          # Checklist generation
│   │   ├── generator.ts    # Apply DOC_CHECKLIST_RULES_V2
│   │   ├── rules.ts        # Rule definitions
│   │   └── templates.ts    # Email templates
│   ├── document/           # Document processing
│   │   ├── classifier.ts   # PDF classification logic
│   │   ├── parser.ts       # Extract text from PDFs
│   │   └── filer.ts        # File to Drive
│   ├── tracking/           # Checklist status tracking
│   │   └── tracker.ts
│   └── drafts/             # Human-in-the-loop drafts
│       └── review.ts
├── db/                     # Database
│   ├── migrations/         # SQL migrations
│   ├── schema.ts           # TypeScript schema (Drizzle/Prisma)
│   └── client.ts           # DB connection pool
├── utils/                  # Shared utilities
│   ├── logger.ts           # Structured logging (no PII)
│   ├── retry.ts            # Exponential backoff
│   ├── idempotency.ts      # Idempotency key checking
│   └── validation.ts       # Input validation
├── config/                 # Configuration
│   ├── env.ts              # Environment variables
│   └── constants.ts        # App constants
└── index.ts                # Entry point
```

### Structure Rationale

- **api/**: External integrations isolated by service. Each client handles auth, retries, rate limiting independently.
- **ingestion/**: Single responsibility for receiving events. Always returns 202 immediately, never blocks.
- **queues/**: Queue definitions separate from workers for clarity. Enables distributed workers.
- **workers/**: Processing logic in separate processes/containers. Can scale independently.
- **services/**: Domain logic decoupled from infrastructure. Testable without external dependencies.
- **db/**: Schema-first approach. Migrations version-controlled. Client handles pooling + reconnection.
- **utils/**: Cross-cutting concerns. Idempotency and retry logic centralized to ensure consistency.

## Architectural Patterns

### Pattern 1: Immediate Acknowledgment + Async Processing

**What:** Webhook receiver returns HTTP 202 within milliseconds, payload queued for background processing.

**When to use:** All webhook endpoints. Required for reliability and to prevent timeouts from webhook providers.

**Trade-offs:**
- **Pro:** Prevents webhook retries due to timeouts. Decouples ingestion from processing time.
- **Pro:** Allows processing to retry independently without re-triggering webhook.
- **Con:** Must handle duplicate webhooks (idempotency required).

**Example:**
```typescript
// ingestion/routes/webhooks.ts
router.post('/webhooks/finmo/application-submitted', async (req, res) => {
  try {
    // 1. Validate signature (fast)
    validateFinmoSignature(req.headers, req.body);

    // 2. Return 202 immediately
    res.status(202).json({ received: true });

    // 3. Enqueue for processing (async, non-blocking)
    await checklistQueue.add('generate-checklist', {
      webhookId: req.headers['x-finmo-webhook-id'],
      applicationId: req.body.application_id,
      payload: req.body,
    }, {
      jobId: req.headers['x-finmo-webhook-id'], // Idempotency
      removeOnComplete: 1000, // Keep for debugging
      removeOnFail: false, // Keep failures
    });
  } catch (err) {
    // Still return 202 to prevent retries for validation errors
    logger.error('Webhook validation failed', { err, body: req.body });
    res.status(202).json({ received: true });
  }
});
```

### Pattern 2: Idempotency via Unique Job IDs

**What:** Use webhook ID as BullMQ job ID. Duplicate webhooks with same ID are automatically deduplicated.

**When to use:** All webhook processing. Critical for "at-least-once" delivery semantics.

**Trade-offs:**
- **Pro:** Prevents duplicate processing without manual tracking.
- **Pro:** BullMQ handles deduplication natively.
- **Con:** Requires webhook provider to send stable unique IDs.

**Example:**
```typescript
// workers/checklist.worker.ts
checklistQueue.process('generate-checklist', async (job) => {
  const { webhookId, applicationId, payload } = job.data;

  // Check idempotency in DB (belt + suspenders approach)
  const existing = await db.processedWebhooks.findUnique({
    where: { webhookId }
  });

  if (existing) {
    logger.info('Webhook already processed', { webhookId });
    return { status: 'duplicate', resultId: existing.resultId };
  }

  // Process application...
  const checklist = await checklistService.generate(payload);

  // Store result with idempotency key
  const result = await db.transaction(async (tx) => {
    const draft = await tx.emailDrafts.create({ data: checklist });
    await tx.processedWebhooks.create({
      data: { webhookId, resultId: draft.id, processedAt: new Date() }
    });
    return draft;
  });

  return { status: 'processed', resultId: result.id };
});
```

### Pattern 3: Exponential Backoff with Dead Letter Queue

**What:** Failed jobs retry with increasing delays (1s, 2s, 4s, 8s, 16s, max 1h). After 5-10 attempts, move to DLQ for manual review.

**When to use:** All workers. Essential for handling transient failures (network issues, rate limits, temporary API outages).

**Trade-offs:**
- **Pro:** Handles 95% of transient failures automatically.
- **Pro:** Prevents thundering herd on external APIs.
- **Con:** Increases processing latency for failed jobs.
- **Con:** Requires monitoring + manual DLQ intervention.

**Example:**
```typescript
// queues/checklist.queue.ts
import { Queue } from 'bullmq';

export const checklistQueue = new Queue('checklist', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 7,
    backoff: {
      type: 'exponential',
      delay: 1000, // Start at 1s
    },
    removeOnComplete: 1000,
    removeOnFail: false, // Keep for DLQ
  },
});

// Monitor failed jobs
checklistQueue.on('failed', async (job, err) => {
  logger.error('Job failed', {
    jobId: job.id,
    attemptsMade: job.attemptsMade,
    error: err.message,
  });

  // Move to DLQ after final attempt
  if (job.attemptsMade >= job.opts.attempts) {
    await dlqQueue.add('checklist-failed', {
      originalJob: job.data,
      error: err.message,
      attempts: job.attemptsMade,
    });
  }
});
```

### Pattern 4: Human-in-the-Loop Draft Review

**What:** Generated emails are saved as drafts in DB. Cat reviews via CRM or admin UI. Approval triggers send.

**When to use:** All automated emails (checklist requests, reminders) until system trust is established. Per CLAUDE.md: "Draft-first approach for client communications."

**Trade-offs:**
- **Pro:** Prevents embarrassing mistakes, allows tone adjustment, builds trust.
- **Pro:** Cat can add personal touches, catch edge cases rules miss.
- **Con:** Adds manual step, reduces time savings initially.
- **Con:** Requires review queue UI or CRM integration.

**Example:**
```typescript
// services/drafts/review.ts
export async function createDraftForReview(params: {
  clientId: string;
  type: 'checklist' | 'reminder';
  subject: string;
  body: string;
  metadata: Record<string, any>;
}) {
  const draft = await db.emailDrafts.create({
    data: {
      ...params,
      status: 'pending_review',
      createdAt: new Date(),
    },
  });

  // Create CRM task for Cat to review
  await gohighlevelClient.tasks.create({
    contactId: params.clientId,
    title: `Review ${params.type} email`,
    description: `Draft ID: ${draft.id}\nView: ${process.env.ADMIN_URL}/drafts/${draft.id}`,
    dueDate: addHours(new Date(), 24),
  });

  return draft;
}

export async function approveDraft(draftId: string, reviewedBy: string) {
  const draft = await db.emailDrafts.update({
    where: { id: draftId },
    data: {
      status: 'approved',
      reviewedBy,
      reviewedAt: new Date(),
    },
  });

  // Enqueue send
  await emailQueue.add('send-approved-draft', { draftId });

  return draft;
}
```

### Pattern 5: Scheduled Jobs with Cron Expressions

**What:** BullMQ repeatable jobs for periodic tasks (reminder checks, Gmail polling, cleanup).

**When to use:** Any task that runs on a schedule. Better than separate cron daemon because it's part of queue infrastructure (monitoring, retries, DLQ).

**Trade-offs:**
- **Pro:** Unified queue system for all async work.
- **Pro:** Built-in retry/monitoring/DLQ for scheduled tasks.
- **Con:** Requires Redis persistence (scheduled jobs lost if Redis restarts without persistence).

**Example:**
```typescript
// workers/reminder.worker.ts
import { Queue } from 'bullmq';

const reminderQueue = new Queue('reminder', { connection: redisConnection });

// Schedule daily reminder check at 9am
await reminderQueue.add(
  'daily-reminder-check',
  {},
  {
    repeat: {
      pattern: '0 9 * * *', // Cron: 9am daily
      tz: 'America/Toronto', // Cat's timezone
    },
  }
);

// Worker processes scheduled job
reminderQueue.process('daily-reminder-check', async (job) => {
  const clients = await db.clients.findMany({
    where: {
      status: 'awaiting_docs',
      lastReminderSent: { lt: subDays(new Date(), 3) }, // 3+ days ago
    },
  });

  for (const client of clients) {
    const missing = await trackingService.getMissingDocs(client.id);

    if (missing.length > 0) {
      await createDraftForReview({
        clientId: client.id,
        type: 'reminder',
        subject: `Reminder: Documents needed for your mortgage application`,
        body: reminderTemplate.render({ client, missing }),
        metadata: { missingDocs: missing },
      });
    }
  }

  return { clientsProcessed: clients.length };
});
```

## Data Flow

### Flow 1: Application Submitted → Checklist Email Draft

```
1. Finmo → POST /webhooks/finmo/application-submitted
   ↓ (validate signature, return 202)
2. Enqueue → checklistQueue.add('generate-checklist', payload)
   ↓
3. Worker → checklistWorker.process()
   ↓
4. Service → checklistGenerator.generate(application)
   ├─ Parse employment type, property type, residency, down payment
   ├─ Apply DOC_CHECKLIST_RULES_V2.md logic
   └─ Generate personalized checklist
   ↓
5. Service → emailTemplate.render(checklist)
   ↓
6. Service → createDraftForReview({ subject, body, client })
   ├─ Save to DB (status: 'pending_review')
   └─ Create CRM task for Cat
   ↓
7. Cat reviews in CRM or admin UI
   ↓
8. Cat approves → approveDraft(draftId)
   ↓
9. Enqueue → emailQueue.add('send-approved-draft')
   ↓
10. Worker → gmailClient.send()
    ├─ Send via Gmail API
    ├─ Update CRM contact
    └─ Mark draft as 'sent'
```

### Flow 2: Document Received via Email → Classify and File

```
1. Cron → Gmail monitor runs every 5 min
   ↓
2. Service → gmailClient.getNewMessages(since: lastPoll)
   ↓
3. For each message with PDF attachment:
   ├─ Extract attachment
   ├─ Identify sender (client email)
   └─ Enqueue → documentQueue.add('classify-document', { pdf, clientId })
   ↓
4. Worker → documentWorker.process()
   ↓
5. Service → pdfParser.extractText(pdf)
   ↓
6. Service → classifier.classify(text, filename)
   ├─ Match against known doc types (T4, paystub, bank statement, etc.)
   ├─ Confidence score
   └─ Suggested name
   ↓
7. Service → driveClient.upload({
     folder: `/Mortgage Clients/${clientName}/${docType}/`,
     filename: suggestedName,
     file: pdf,
   })
   ↓
8. Service → trackingService.markReceived(clientId, docType)
   ├─ Update checklist status in DB
   └─ Update CRM custom field
   ↓
9. If all PRE docs received:
   └─ Notify Taylor via CRM task: "Client X is pre-approval ready"
```

### Flow 3: Reminder Workflow (Disabled Initially)

```
1. Cron → Reminder worker runs daily at 9am
   ↓
2. Service → Find clients with missing docs (last reminder >3 days ago)
   ↓
3. For each client:
   ├─ Service → trackingService.getMissingDocs(clientId)
   ├─ Prioritize PRE docs
   ├─ Service → reminderTemplate.render({ missing })
   └─ Service → createDraftForReview({ type: 'reminder' })
   ↓
4. Cat reviews reminder drafts in batch
   ↓
5. Cat approves → send via Flow 1 steps 8-10
```

## Key Data Flows

1. **Webhook Ingestion:** Always return 202 → enqueue → process async → store result with idempotency key.
2. **Email Draft Review:** Generate → save as draft → create CRM task → Cat reviews → approve → send.
3. **Document Classification:** Poll Gmail → extract PDF → classify → file to Drive → update tracking → notify if complete.
4. **Reminder Generation:** Daily cron → find clients with missing docs → generate draft → Cat reviews → send.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| **0-50 clients/month** | Single VPS (Railway/Render), single worker process, Redis + PostgreSQL on same host. Simple monolith sufficient. |
| **50-200 clients/month** | Separate worker processes (multiple BullMQ workers), Redis persistence enabled, consider managed Redis (Upstash). |
| **200-1000 clients/month** | Separate DB (managed PostgreSQL), separate Redis cluster, horizontal worker scaling (multiple containers), add caching layer for checklist rules, consider separate service for document processing (CPU-intensive). |
| **1000+ clients/month** | Microservices (ingestion, workers, API separate), Kubernetes for orchestration, separate queues per concern, CDN for static assets, advanced monitoring (OpenTelemetry). |

### Scaling Priorities

1. **First bottleneck:** Document classification (CPU-intensive PDF parsing). **Fix:** Separate worker pool with more CPU, consider pre-processing with streaming.
2. **Second bottleneck:** Database queries (tracking status for all clients). **Fix:** Add caching layer (Redis), denormalize checklist status into CRM custom fields, index frequently-queried columns.
3. **Third bottleneck:** Gmail API rate limits (quota: 1B requests/day, realistically 250/user/second). **Fix:** Batch operations, poll less frequently, use push notifications (Gmail Pub/Sub) instead of polling.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Processing Webhooks Synchronously

**What people do:** Receive webhook → process immediately → return 200 after completion.

**Why it's wrong:**
- Processing takes 500ms-5s (API calls, DB writes, classification). Webhook provider times out at 5-10s.
- Transient failures (API down) cause webhook retries, creating duplicate work.
- Blocks webhook receiver, preventing new webhooks during processing.

**Do this instead:** Return 202 immediately → enqueue payload → process in background worker. Store idempotency key to handle duplicate webhooks.

### Anti-Pattern 2: Storing PII in Logs

**What people do:** Log full request bodies, application data, client names for debugging.

**Why it's wrong:**
- CLAUDE.md rule: "Never store client PII in automation logs."
- Violates PIPEDA (Canadian privacy law). Mortgage docs contain SIN, income, addresses.
- Logs often stored indefinitely, backed up, accessible to many.

**Do this instead:** Log only metadata (IDs, doc types, timestamps, success/failure). Redact PII before logging. Example:
```typescript
// BAD
logger.info('Processing application', { application: req.body });

// GOOD
logger.info('Processing application', {
  applicationId: req.body.id,
  clientId: hashClientId(req.body.borrower_email), // One-way hash
  docTypes: req.body.documents.map(d => d.type),
  timestamp: new Date(),
});
```

### Anti-Pattern 3: No Dead Letter Queue

**What people do:** Retry failed jobs indefinitely OR discard after X attempts.

**Why it's wrong:**
- Infinite retries waste resources, can cause cascading failures.
- Discarding loses data, no visibility into why it failed, can't recover.
- No way to diagnose systemic issues (e.g., API auth broken).

**Do this instead:** Retry with exponential backoff (max 5-10 attempts) → move to DLQ → alert on DLQ growth → manual review/redrive. DLQ jobs contain full context for debugging.

### Anti-Pattern 4: Tight Coupling Between Components

**What people do:** Webhook handler directly calls Gmail API, Drive API, CRM API in sequence.

**Why it's wrong:**
- If any API is down, entire flow fails. No partial success.
- Hard to test (mock 4 APIs).
- Can't scale components independently.
- No visibility into which step failed.

**Do this instead:** Queue-based architecture. Each worker handles one concern. Failures isolated. Example:
```
Webhook → checklistQueue → checklistWorker (only CRM)
        → emailQueue → emailWorker (only Gmail)
        → documentQueue → documentWorker (only Drive + classification)
```

### Anti-Pattern 5: Ignoring Idempotency

**What people do:** Process webhook without checking if already processed. "Webhooks are only sent once."

**Why it's wrong:**
- "At-least-once" delivery is standard. Finmo will retry on timeout, network error, 5xx response.
- Manual re-triggers (support, debugging) create duplicates.
- Results in duplicate emails, duplicate tasks, duplicate files.

**Do this instead:** Use webhook ID as job ID (BullMQ deduplication) + store processed webhook IDs in DB with TTL. Check both before processing.

### Anti-Pattern 6: Hardcoding Business Logic

**What people do:** Embed DOC_CHECKLIST_RULES_V2 logic directly in code: `if (employmentType === 'salary') { ... }`.

**Why it's wrong:**
- Rules change frequently (Cat already made 20+ changes between V1 and V2).
- Requires code deploy for rule changes.
- Hard to audit what rules were used for past checklists.

**Do this instead:** Store rules as data (JSON, YAML, or database). Version rules. Log rule version used for each checklist. Consider rules engine (json-rules-engine) for complex logic.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Finmo** | Webhook receiver + REST API | Webhook: validate signature with HMAC. API: Bearer token auth. Need to handle pagination for bulk operations. |
| **GoHighLevel (MyBrokerPro)** | REST API V2 | Bearer token (sub-account or private integration). V1 is EOL. Custom fields for checklist tracking. Webhooks available but not needed initially. |
| **Gmail API** | OAuth2 + REST API | Service account OR user OAuth. Polling for new messages (later: Pub/Sub push). Rate limits: 250 req/user/sec. Send via API (not SMTP) for tracking. |
| **Google Drive API** | OAuth2 + REST API | Service account with domain-wide delegation. Upload to `/Mortgage Clients/{client}/{docType}/`. Check folder permissions. Rate limits: 1000 req/100sec/user. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| **Ingestion ↔ Queues** | BullMQ `add()` | Fire-and-forget. Ingestion never waits for processing. |
| **Queues ↔ Workers** | BullMQ `process()` | Workers poll queues. Concurrency configurable per queue. |
| **Workers ↔ Services** | Direct function calls | Workers orchestrate, services contain domain logic (pure functions where possible). |
| **Services ↔ API Clients** | Direct function calls with retry | API clients handle auth, retries, rate limiting. Services treat them as simple async functions. |
| **Services ↔ Database** | Drizzle/Prisma ORM | Transactions for multi-step operations. Connection pooling to prevent exhaustion. |

## Reliability Patterns

### Idempotency Implementation

```typescript
// utils/idempotency.ts
export class IdempotencyGuard {
  constructor(private redis: Redis, private ttlDays = 30) {}

  async check(key: string): Promise<{ processed: boolean; result?: any }> {
    const cached = await this.redis.get(`idempotency:${key}`);
    if (cached) {
      return { processed: true, result: JSON.parse(cached) };
    }
    return { processed: false };
  }

  async store(key: string, result: any): Promise<void> {
    await this.redis.setex(
      `idempotency:${key}`,
      this.ttlDays * 24 * 60 * 60,
      JSON.stringify(result)
    );
  }
}

// Usage in worker
const guard = new IdempotencyGuard(redis);
const check = await guard.check(webhookId);
if (check.processed) {
  return check.result; // Early return with cached result
}

const result = await processWebhook(payload);
await guard.store(webhookId, result);
return result;
```

### Retry with Exponential Backoff

```typescript
// utils/retry.ts
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitter?: boolean;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 5,
    initialDelayMs = 1000,
    maxDelayMs = 60000,
    jitter = true,
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts - 1) {
        throw err; // Final attempt failed
      }

      // Calculate delay: 2^attempt * initialDelay
      let delay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);

      // Add jitter (0-1s) to prevent thundering herd
      if (jitter) {
        delay += Math.random() * 1000;
      }

      logger.warn('Retrying after error', {
        attempt: attempt + 1,
        maxAttempts,
        delayMs: delay,
        error: err.message,
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

### Circuit Breaker for External APIs

```typescript
// utils/circuit-breaker.ts
export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private lastFailureTime: number = 0;

  constructor(
    private threshold: number = 5, // Open after 5 failures
    private timeout: number = 60000 // Try again after 60s
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'open';
      logger.error('Circuit breaker opened', { failures: this.failures });
    }
  }
}
```

## Monitoring and Observability

### Key Metrics to Track

| Metric | Why Important | Alert Threshold |
|--------|---------------|-----------------|
| **Webhook processing time** | Detect slow workers, bottlenecks | >5s p95 |
| **Queue depth** | Detect backlogs, worker issues | >100 jobs pending >10 min |
| **DLQ size** | Detect systemic failures | >5 jobs in DLQ |
| **Email draft approval time** | Cat's workload, SLA tracking | >24h p95 |
| **Document classification accuracy** | AI quality, need retraining | <90% confidence |
| **API error rates** | External service health | >5% error rate |
| **Idempotency cache hit rate** | Duplicate webhook frequency | Informational |

### Structured Logging (No PII)

```typescript
// utils/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'mortgage-automation' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
  ],
});

// Redact PII before logging
export function sanitizeForLogging(obj: any): any {
  const redacted = { ...obj };
  const piiFields = ['email', 'phone', 'sin', 'name', 'address', 'income'];

  for (const field of piiFields) {
    if (field in redacted) {
      redacted[field] = '[REDACTED]';
    }
  }

  return redacted;
}
```

## Build Order and Dependencies

### Phase 1: Foundation (Week 1-2)

**Goal:** Core infrastructure + webhook receiver

**Components to build:**
1. Project setup (TypeScript, linting, env config)
2. Database schema + migrations (applications, checklists, email_drafts, processed_webhooks)
3. Redis connection + BullMQ queue setup
4. Express server + webhook receiver endpoint
5. Signature validation middleware
6. Basic worker skeleton (log payload, acknowledge job)

**Validation:** Can receive Finmo webhook, enqueue, process in worker, log safely.

**Dependencies:** None. Greenfield.

### Phase 2: Checklist Generation (Week 2-3)

**Goal:** Generate personalized checklists from application data

**Components to build:**
1. Checklist rule engine (parse DOC_CHECKLIST_RULES_V2.md logic)
2. Application data parser (extract employment, property, residency)
3. Checklist generator service (apply rules, output doc list)
4. Email template (Handlebars/Mustache with personalization)
5. Draft creation service (save to DB, status 'pending_review')

**Validation:** Webhook → worker → checklist → draft in DB.

**Dependencies:** Phase 1 (queue, worker, DB).

### Phase 3: CRM Integration (Week 3-4)

**Goal:** Create tasks in MyBrokerPro for Cat's review

**Components to build:**
1. GoHighLevel API client (auth, contacts, tasks)
2. Task creation on draft generation
3. Contact update (store application ID, checklist status)
4. Custom fields setup in CRM (checklist_generated, docs_received)

**Validation:** Draft created → CRM task appears for Cat.

**Dependencies:** Phase 2 (draft creation). Requires MyBrokerPro access.

### Phase 4: Email Sending (Week 4-5)

**Goal:** Cat approves draft → email sent via Gmail API

**Components to build:**
1. Gmail API client (OAuth, send endpoint)
2. Email queue + worker
3. Draft approval API/UI (simple admin endpoint or CRM webhook)
4. Send logic (Gmail API, update draft status, update CRM)

**Validation:** Cat approves draft → email sent to client → visible in Sent folder.

**Dependencies:** Phase 3 (CRM integration). Requires Gmail API access.

### Phase 5: Document Classification (Week 5-7)

**Goal:** Classify incoming PDFs, file to Drive, update tracking

**Components to build:**
1. Gmail monitor (polling, extract attachments)
2. PDF parser (extract text for classification)
3. Document classifier (rule-based OR AI-based, confidence scoring)
4. Google Drive client (upload, folder structure)
5. Tracking service (mark docs received, update checklist status)
6. Notification (PRE docs complete → task for Taylor)

**Validation:** Email with PDF → classified → filed to Drive → status updated → Taylor notified.

**Dependencies:** Phase 3 (CRM integration, tracking). Requires Gmail + Drive API access.

### Phase 6: Reminders (Week 7-8, OPTIONAL for MVP)

**Goal:** Automated reminder drafts for missing docs

**Components to build:**
1. Reminder scheduler (BullMQ repeatable job, daily at 9am)
2. Missing docs query (filter clients, PRE vs FULL priority)
3. Reminder template (personalized, friendly tone)
4. Draft creation (same as Phase 2)

**Validation:** Daily job runs → missing docs detected → reminder drafts created → Cat reviews.

**Dependencies:** Phase 5 (tracking status). Disabled initially per CLAUDE.md ("built but disabled initially").

### Dependency Graph

```
Phase 1 (Foundation)
    ↓
Phase 2 (Checklist) ────┐
    ↓                    ↓
Phase 3 (CRM) ──────────┤
    ↓                    ↓
Phase 4 (Email) ────────┤
    ↓                    ↓
Phase 5 (Docs) ─────────┘
    ↓
Phase 6 (Reminders, optional)
```

**Critical path:** 1 → 2 → 3 → 4 → 5. Phase 6 is independent enhancement.

## Technology Recommendations

**Language:** Node.js with TypeScript (HIGH confidence)
- GoHighLevel has Node SDK, Gmail/Drive have official Node clients
- BullMQ is Node-native, excellent DX
- Cat's team may expand to light dev work (TypeScript more accessible than Python for async/API work)

**Queue:** BullMQ with Redis (HIGH confidence)
- Industry standard for Node.js job queues
- Built-in retry, scheduling, DLQ, monitoring
- Redis persistence ensures scheduled jobs survive restarts

**Database:** PostgreSQL (MEDIUM confidence)
- Relational data (applications, checklists, drafts, tracking)
- Strong JSONB support for flexible metadata
- Managed options cheap (Supabase, Railway, Render)

**ORM:** Drizzle or Prisma (MEDIUM confidence)
- Drizzle: Lightweight, TypeScript-first, good migrations
- Prisma: Richer ecosystem, excellent DX, heavier

**Hosting:** Railway or Render (MEDIUM confidence)
- Simple VPS with managed Redis + PostgreSQL
- Easy deploy from GitHub
- Cost: ~$20-50/month for MVP scale

## Sources

Architecture patterns and best practices sourced from:

- [Webhook Explained: The Backbone of Real-Time Automation (Medium, Jan 2026)](https://medium.com/@venkatvk46/466-webhook-explained-the-backbone-of-real-time-automation-d1f002bd387e)
- [Designing a webhook service: A practical guide (DEV Community)](https://dev.to/vikthurrdev/designing-a-webhook-service-a-practical-guide-to-event-driven-architecture-3lep)
- [Webhook Architecture - Design Pattern (Beeceptor)](https://beeceptor.com/docs/webhook-feature-design/)
- [Building Scalable Microservices with Node.js and Event-Driven Architecture (DEV Community)](https://dev.to/dhrumitdk/building-scalable-microservices-with-nodejs-and-event-driven-architecture-4ckc)
- [Event-Driven Architecture (EDA) with Node.js (Medium)](https://medium.com/@erickzanetti/event-driven-architecture-eda-with-node-js-a-modern-approach-and-challenges-82e7d9932b34)
- [Webhooks at Scale: Designing an Idempotent, Replay-Safe System (DEV Community)](https://dev.to/art_light/webhooks-at-scale-designing-an-idempotent-replay-safe-and-observable-webhook-system-7lk)
- [How to Implement Webhook Retry Logic (Latenode)](https://latenode.com/blog/integration-api-management/webhook-setup-configuration/how-to-implement-webhook-retry-logic)
- [BullMQ - Background Jobs and Message Queue (BullMQ.io)](https://bullmq.io/)
- [Job Scheduling in Node.js with BullMQ (Better Stack)](https://betterstack.com/community/guides/scaling-nodejs/bullmq-scheduled-tasks/)
- [How to Build a Task Scheduler with BullMQ (OneUptime, Jan 2026)](https://oneuptime.com/blog/post/2026-01-26-task-scheduler-bullmq-nodejs/view)
- [Human-in-the-Loop AI Review Queues (All Days Tech, 2025)](https://alldaystech.com/guides/artificial-intelligence/human-in-the-loop-ai-review-queue-workflows)
- [Human-in-the-Loop in Agentic Workflows (Orkes.io)](https://orkes.io/blog/human-in-the-loop/)
- [Human-in-the-Loop implementation checklist (Moxo, 2026)](https://www.moxo.com/blog/hitl-implementation-checklist)

---

*Architecture research for: Taylor Atkinson Mortgage Document Automation*
*Researched: 2026-02-09*
*Confidence: HIGH (verified with current 2026 sources, matches project constraints)*
