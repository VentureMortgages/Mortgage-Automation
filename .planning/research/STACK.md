# Technology Stack

**Project:** Mortgage Document Collection Automation
**Researched:** 2026-02-09
**Confidence:** HIGH

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 20.x LTS or 22.x | Runtime environment | Current LTS with native .env support (20.6.0+), experimental TypeScript stripping in v23+. Express v5 requires Node 18+. Stable for production workloads. |
| TypeScript | 5.9.x | Type safety and DX | Industry standard for Node.js projects in 2026. Eliminates runtime type errors, provides excellent IDE support. Tested with TS 5.5+. Native Node.js support improving (v23 with --strip-types). |
| Express.js | 5.2.x | HTTP server framework | Latest stable release (v5.1.0 now default on npm). Mature ecosystem, simple API, perfect for webhook endpoints. Despite Fastify being 2-3x faster, Express is sufficient for this scale and has better GoHighLevel SDK compatibility. |

**Confidence:** HIGH — All versions verified via official npm registry and release notes (February 2026).

### Message Queue & Background Processing

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| BullMQ | 5.67.x | Job queue with Redis | Modern successor to Bull. Provides exactly-once semantics, delayed jobs, retries, dead-letter queues. Essential for decoupling webhook receipt from processing (return 200 immediately, process async). 2-3x faster than alternatives. |
| Redis | 6.x or 7.x | In-memory data store | Required by BullMQ (v4+ minimum). Upstash Redis or Railway Redis addon recommended for managed hosting. Stores job queue state, deduplication tracking (24hr TTL for webhook IDs). |

**Confidence:** HIGH — BullMQ v5.67.3 verified via npm (Feb 2026). Decouple-then-queue pattern is industry standard for webhook processing.

### External API Integrations

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @gohighlevel/api-client | Latest (check npm) | GoHighLevel CRM SDK | Official SDK with OAuth handling, token rotation, typed interfaces. Prefer over manual REST calls. Supports contacts, opportunities, tasks, custom fields. Note: API V1 is EOL, must use V2. |
| googleapis | 171.x | Google APIs (Gmail, Drive) | Google's official Node.js client. Supports OAuth2, service accounts, JWT. Covers Gmail API (send emails, monitor inbox) and Drive API (file upload, folder management). Maintenance mode but stable. |
| nodemailer | 6.x | Email sending | Use with Gmail OAuth2 for sending personalized checklist emails. Integrates with googleapis for token management. Production-tested, secure. |

**Confidence:** HIGH for googleapis (v171.4.0 verified Feb 2026), MEDIUM for @gohighlevel/api-client (npm package exists, version TBD).

### Validation & Type Safety

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zod | 3.x | Runtime schema validation | TypeScript-first validation for webhook payloads, environment variables, API responses. Zero dependencies, 2kb gzipped. Infer static types with z.infer<>. Essential for external data validation. |

**Confidence:** HIGH — Industry standard for TypeScript validation in 2026. Compatible with TS 5.5+.

### Logging & Monitoring

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Pino | 9.x | Structured logging | 5x faster than Winston. JSON-formatted logs for centralized logging (Better Stack, Datadog, etc.). Async logging, low overhead. Recommended for production microservices in 2026. |
| pino-pretty | 11.x | Development log formatting | Human-readable logs during development. Use only in dev mode (NODE_ENV=development). |

**Confidence:** HIGH — Pino is the performance standard for Node.js logging in 2026.

### PDF Processing & Document Classification

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pdf-parse | 1.x | PDF text extraction | Fastest option for plain text extraction. No native binaries, pure JavaScript. Use for initial doc analysis and classification. |
| pdfjs-dist | 4.x | Advanced PDF parsing | Mozilla's PDF.js for Node.js. Provides layout coordinates, font data, image streams. Use if pdf-parse insufficient (rare). Heavier dependency. |
| unpdf | Latest | Serverless PDF extraction | Collection of utilities for serverless environments. Works in Node.js, Deno, Bun, browser. Consider for Railway/Render where cold starts matter. |

**Confidence:** MEDIUM — pdf-parse is standard for simple extraction. Actual classification logic may require OpenAI/Claude API (not included here, depends on existing mortgage.ai code).

### Environment & Configuration

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dotenv | 16.x | Environment variables | Load .env files in development. Node 20.6+ has native .env support via --env-file flag, but dotenv still standard for cross-version compatibility. Never commit .env files. |

**Confidence:** HIGH — Standard practice. For production, use Railway/Render's built-in env var management + secrets manager for sensitive keys (AWS Secrets Manager, Vault).

## Infrastructure & Hosting

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Railway or Render | N/A | VPS hosting platform | Railway: Developer-centric, fast deploys, GitHub integration, excellent DX. Render: More production-focused, predictable pricing, better scaling guarantees. Both support Node.js, Redis addons, environment variables, auto-scaling. Choose Railway for MVP/speed, Render for production stability. |
| PostgreSQL (optional) | 15.x or 16.x | Relational database | If state tracking beyond CRM is needed (e.g., audit logs, webhook deduplication history). Railway/Render have managed Postgres addons. Consider for Phase 2 if CRM custom fields insufficient. |

**Confidence:** HIGH for Railway/Render comparison (2026 sources). Database is OPTIONAL — CRM may be sufficient for MVP.

## Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| axios | 1.x | HTTP client | If manual API calls needed (prefer SDK when available). Better error handling than fetch. Widely used, stable. |
| date-fns | 3.x | Date manipulation | Lightweight alternative to Moment.js. Immutable, tree-shakeable. For follow-up scheduling, timestamp formatting. |
| helmet | 7.x | Express security headers | Adds security headers to Express responses. Standard practice for production Express apps. |
| cors | 2.x | CORS middleware | If frontend or external services call your webhook endpoints. Configure allowed origins carefully. |

**Confidence:** HIGH — All are industry-standard supporting libraries.

## Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| tsx | Run TypeScript files directly | Modern alternative to ts-node. Faster, supports latest TS features. Use for development: `tsx watch src/index.ts` |
| nodemon | Auto-restart on file changes | Alternative to tsx watch. Works with compiled JS or tsx. Popular, well-maintained. |
| eslint | Linting | Configure with @typescript-eslint/parser. Enforce code quality, catch errors. |
| prettier | Code formatting | Auto-format on save. Use with eslint-config-prettier to avoid conflicts. |
| vitest or jest | Testing framework | Vitest is faster, modern. Jest is more mature, larger ecosystem. Choose based on team preference. |

**Confidence:** HIGH — Standard TypeScript/Node.js development tooling in 2026.

## Installation

```bash
# Core dependencies
npm install express @gohighlevel/api-client googleapis nodemailer bullmq ioredis zod pino dotenv

# PDF processing (choose based on needs)
npm install pdf-parse
# OR for advanced needs:
# npm install pdfjs-dist unpdf

# Supporting libraries
npm install axios date-fns helmet cors

# Development dependencies
npm install -D typescript @types/node @types/express tsx nodemon eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-config-prettier pino-pretty

# Testing (choose one)
npm install -D vitest @vitest/ui
# OR
# npm install -D jest ts-jest @types/jest
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Alternative |
|----------|-------------|-------------|---------------------|
| Web Framework | Express 5.x | Fastify 4.x | Fastify is 2-3x faster, but Express has better ecosystem compatibility (GoHighLevel SDK examples use Express), simpler API, and sufficient performance for this scale (~10-50 webhooks/day). Fastify's schema-based approach is overkill. |
| Queue | BullMQ | AWS SQS | SQS requires AWS account, more complex setup, vendor lock-in. BullMQ with Redis is simpler, cheaper for MVP, and Railway/Render have Redis addons. SQS is better for extreme durability needs (not required here). |
| Queue | BullMQ | Kafka | Kafka is overkill for this scale. Requires ZooKeeper, complex ops, designed for high-throughput streaming (millions of events). This system processes ~10-50 webhooks/day. |
| ORM | None (use SDK + native drivers) | Prisma 7.x | Prisma adds TypeScript type-safety for database queries but introduces complexity (migrations, schema files) when CRM is primary data store. Only add if Phase 2 requires local PostgreSQL for audit logs. |
| Logging | Pino | Winston | Winston is more popular (12M weekly downloads) but Pino is 5x faster with lower overhead. For microservices in 2026, Pino's JSON-structured logs are standard for centralized logging. Winston's multi-transport flexibility isn't needed here. |
| Runtime | Node.js | Deno, Bun | Deno and Bun have better TS support (native execution), but ecosystem maturity lags. Google APIs, GoHighLevel SDK are Node-first. Stick with Node LTS for stability and compatibility. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| API V1 for GoHighLevel | End-of-life, no support, no new features | @gohighlevel/api-client (V2 SDK) |
| Moment.js | Deprecated, large bundle size, mutable API | date-fns 3.x (lightweight, immutable) |
| Body-parser middleware | Included in Express 5.x by default | Built-in express.json() and express.urlencoded() |
| ts-node | Slower than tsx, compatibility issues with ESM | tsx (modern, faster, better ESM support) |
| Plain .env files in production | Security risk, no audit trail, hard to rotate | Railway/Render env vars + AWS Secrets Manager for sensitive keys |
| Synchronous PDF processing in webhook handler | Blocks response, causes timeouts, triggers retries | BullMQ job queue (return 200, process async) |
| Service accounts for Gmail user actions | Cannot impersonate user Gmail accounts | OAuth2 with user consent (for sending emails from admin@venturemortgages.com) |

## Stack Patterns by Variant

**If webhook volume exceeds 1000/day:**
- Add rate limiting (express-rate-limit)
- Scale workers horizontally (multiple BullMQ consumers)
- Consider Redis Cluster for queue durability
- Add APM monitoring (Datadog, New Relic)

**If CRM custom fields prove insufficient:**
- Add PostgreSQL for audit logs, webhook history, document metadata
- Use Prisma ORM for type-safe queries
- Implement event sourcing pattern for state reconstruction

**If PDF classification requires AI:**
- Integrate OpenAI API (GPT-4o) or Claude API (existing mortgage.ai code)
- Add classification confidence scores to metadata
- Implement human-review queue for low-confidence classifications

**If production requires high availability:**
- Deploy to multiple Railway/Render regions
- Add health check endpoint (GET /health)
- Implement circuit breakers (opossum library)
- Add Redis Sentinel for queue failover

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Express 5.2.x | Node.js 18+ | Dropped support for Node <18. Works with Node 20 LTS and 22 LTS. |
| TypeScript 5.9.x | Node.js 18+ | Officially tested with TS 5.5+. Works with older Node but type definitions may differ. |
| BullMQ 5.67.x | Redis 6.x or 7.x | Requires Redis 4+ minimum. Use ioredis for connection (peer dependency). |
| googleapis 171.x | Node.js 18+ (LTS) | Maintenance mode but stable. Supports OAuth2, service accounts. |
| Zod 3.x | TypeScript 5.5+ | Zero dependencies. Works with any TS 5.x version. |
| Pino 9.x | Node.js 18+ | ESM and CJS compatible. Use pino-pretty 11.x for dev logs. |

## Sources

### High Confidence (Official/Verified)
- [googleapis npm package v171.4.0](https://www.npmjs.com/package/googleapis) — Feb 2026
- [BullMQ npm package v5.67.3](https://www.npmjs.com/package/bullmq) — Feb 2026
- [Express.js v5.2.1 release](https://www.npmjs.com/package/express) — Official npm
- [TypeScript 5.9.x release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html) — Microsoft
- [Zod official docs](https://zod.dev/) — Official documentation
- [BullMQ official docs](https://docs.bullmq.io) — Official documentation
- [Node.js webhook best practices 2026](https://about.twimbit.com/about/blogs/building-robust-webhook-services-in-node-js-best-practices-and-techniques)
- [Webhook queue architecture guide](https://inventivehq.com/blog/webhook-scaling-performance-guide)

### Medium Confidence (Community/Comparisons)
- [Railway vs Render comparison 2026](https://northflank.com/blog/railway-vs-render) — Third-party analysis
- [Pino vs Winston performance comparison](https://betterstack.com/community/comparisons/pino-vs-winston/) — Better Stack
- [Express vs Fastify benchmark 2026](https://betterstack.com/community/guides/scaling-nodejs/fastify-express/) — Better Stack
- [PDF parsing libraries comparison 2025](https://strapi.io/blog/7-best-javascript-pdf-parsing-libraries-nodejs-2025) — Strapi blog
- [GoHighLevel Node.js SDK docs](https://marketplace.gohighlevel.com/docs/sdk/node/index.html) — Official marketplace

### Context Notes
- GoHighLevel API V1 is EOL (confirmed via [API documentation](https://help.gohighlevel.com/support/solutions/articles/48001060529-highlevel-api))
- Gmail API with service accounts cannot impersonate users (confirmed via [Google docs](https://www.labnol.org/google-api-service-account-220405))
- Railway/Render are PaaS (not true VPS) but provide VPS-level control per [Railway docs](https://docs.railway.com/maturity/compare-to-vps)

---

*Stack research for: Mortgage Document Collection Automation*
*Researched: 2026-02-09*
*Confidence: HIGH for core stack, MEDIUM for hosting/PDF libs*
