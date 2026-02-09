# Pitfalls Research

**Domain:** Webhook-driven mortgage document collection automation
**Researched:** 2026-02-09
**Confidence:** MEDIUM

## Critical Pitfalls

### Pitfall 1: Webhook Duplicate Processing Without Idempotency

**What goes wrong:**
Webhooks arrive multiple times for the same event (Finmo submission), causing duplicate doc request emails, duplicate client folders in Drive, or duplicate CRM records. Most webhook providers operate on "at least once" delivery, meaning the same webhook will eventually arrive multiple times.

**Why it happens:**
Network timeouts, provider retries, and endpoint failures all trigger redelivery. If your endpoint takes >30 seconds to respond (e.g., generating checklist, uploading to Drive, sending email), the provider times out and retries even though your first attempt succeeded. GoHighLevel retries up to 3 times with exponential backoff, but only for 429 status codes—not 5xx errors.

**How to avoid:**
- Implement idempotency keys: Store Finmo's event_id or application_id in database with unique constraint
- Return HTTP 200 immediately, process asynchronously in background queue
- Use database unique constraints to prevent duplicate inserts (e.g., client folder creation)
- Never assume "received once = processed once"

**Warning signs:**
- Cat reports receiving duplicate doc request emails for same client
- Multiple Drive folders for same client with same timestamp
- CRM shows duplicate contacts/opportunities
- Logs show same webhook payload arriving 2-3 times within minutes

**Phase to address:**
Phase 1 (Foundation/MVP) — must be built into webhook receiver from day one, impossible to retrofit cleanly later.

---

### Pitfall 2: Webhook Event Ordering Assumption

**What goes wrong:**
You assume webhooks arrive in order (e.g., "application submitted" before "documents uploaded"), but they don't. Network conditions and processing speed cause later events to complete before earlier ones. State transitions fail (e.g., trying to mark docs "received" before application exists), data becomes inconsistent, or the system rejects valid events.

**Why it happens:**
Finmo doesn't guarantee delivery order. Even if sent in order, network latency and parallel processing can cause out-of-order arrival. Your async queue might process event #2 before event #1 finishes. This is industry-standard webhook behavior.

**How to avoid:**
- Design state machine with valid transitions: only allow transitions that make sense (e.g., can't go from "no application" to "docs received")
- Reject invalid transitions gracefully: log for manual review, don't crash
- Use "fetch before process" pattern: when webhook arrives, fetch current state from source API (Finmo, MyBrokerPro) before processing
- Include timestamps/version counters: discard events older than current stored state
- Never rely on webhook arrival order for business logic

**Warning signs:**
- Errors like "cannot find application for document upload event"
- State inconsistencies where CRM shows different status than Finmo
- Events being rejected as "invalid" during normal operation
- Manual intervention needed to "fix" state after webhook processing

**Phase to address:**
Phase 1 (Foundation/MVP) — state machine design must handle out-of-order from start. Retrofitting after production is high-risk.

---

### Pitfall 3: API Rate Limit Cascading Failures

**What goes wrong:**
Single Finmo webhook triggers 10+ API calls (Gmail, Drive, MyBrokerPro), hitting rate limits. System crashes or stops processing webhooks entirely. Cat's manual work piles up because automation is down. No visibility into which API failed or why.

**Why it happens:**
- GoHighLevel: 100 requests per 10 seconds per resource, 200k daily
- Gmail API: quota units vary by method, per-user and per-project limits
- Google Drive API: 403 "user rate limit exceeded" or 429 "too many requests"
- Finmo: rate limits not publicly documented, likely has burst limits

Each webhook might: create Drive folder, upload docs, send email, create CRM contact, update custom fields, log activity. 10 clients submit apps in 5 minutes = 100+ API calls. Rate limit hit, webhooks fail, retries amplify problem.

**How to avoid:**
- Implement exponential backoff with jitter for retries (not immediate retry)
- Use circuit breaker pattern: if API fails 3+ times, pause calls for 5 minutes
- Queue webhook processing with rate-limited workers (e.g., max 5 Gmail calls/minute)
- Monitor rate limit headers: track X-RateLimit-Remaining, alert before hitting zero
- Batch operations where possible (e.g., upload multiple docs in one Drive API call)
- Implement dead letter queue for permanently failed webhooks (manual review)

**Warning signs:**
- 429 or 403 errors in logs during normal operation
- Webhook processing stops entirely during busy periods
- Exponentially increasing retry attempts
- API quota usage dashboard shows spikes near limits
- Cat reports "automation stopped working" during application season

**Phase to address:**
Phase 1 (Foundation) for basic rate limiting and retries. Phase 2 for circuit breaker and dead letter queue (more sophisticated).

---

### Pitfall 4: PII Exposure in Logs and Error Messages

**What goes wrong:**
Webhook payloads, API responses, and error logs contain SIN numbers, income amounts, addresses, and other sensitive financial data. Logs stored in plain text on server, cloud logging service, or error tracking tool (Sentry, etc.). Violates PIPEDA, exposes client data to unauthorized access, creates liability.

**Why it happens:**
Default logging libraries log full request/response bodies. Developers debug issues by logging webhook payloads. Error messages include "failed to process application for [client name] with SIN [number]". Cloud logging services index all fields, making PII searchable. Not malicious—just lack of awareness.

**How to avoid:**
- Redact PII before logging: replace SIN, income, addresses with [REDACTED]
- Log metadata only: "processed application_id ABC123" not full payload
- Use structured logging with explicit allow-list: only log known-safe fields
- Separate PII-free identifiers: create internal UUID for tracking, never log Finmo's sensitive fields
- Encrypt logs at rest if they must contain sensitive data
- Implement log retention policy: delete logs older than 90 days
- Test logging with real-like data, audit for leaks before production

**Warning signs:**
- Searching logs reveals client names, SIN numbers, income amounts
- Error tracking dashboard shows full webhook payloads in error context
- Logs don't have redaction patterns for known PII fields
- Team members without client access can see PII in logs
- No log retention policy or encryption

**Phase to address:**
Phase 1 (Foundation) — PIPEDA compliance required from day one. Cannot retrofit after production without destroying logs and starting over.

---

### Pitfall 5: OAuth Token Refresh Failure Without User Re-Auth Flow

**What goes wrong:**
Gmail/Drive access tokens expire after 1 hour, refresh tokens fail silently, automation stops working. Cat doesn't receive doc request emails, Drive uploads fail, no alerts. Discover days later when Cat asks "why isn't automation running?"

**Why it happens:**
- Refresh tokens revoked if password changes (Gmail scope requirement)
- Refresh tokens expire after 6 months of no use
- Token limit: 100 tokens per OAuth client per user, oldest silently invalidated
- invalid_grant error from Google, no automatic recovery
- No monitoring for token health, only discover on next API call failure

**How to avoid:**
- Proactive token refresh: refresh every 50 minutes (before 60-min expiration)
- Touch tokens regularly: make harmless API call every few days to prevent 6-month expiration
- Store new refresh tokens: some APIs rotate them silently on refresh
- Catch invalid_grant: retry once, then mark account "re-auth required" and alert user
- Monitor token health: daily check that refresh succeeds, alert if fails
- Implement user re-auth flow: email Cat with link to re-authorize if token invalid
- Never assume refresh tokens last forever

**Warning signs:**
- Sporadic API failures with "invalid_grant" or "token expired" errors
- Automation works for weeks then suddenly stops
- No alerts when token refresh fails
- Manual re-authorization required every few months without explanation
- Emails not sending but no error notifications

**Phase to address:**
Phase 1 (Foundation) for basic refresh logic. Phase 2 for monitoring and user re-auth flow.

---

### Pitfall 6: Document Classification Based on Filename Alone

**What goes wrong:**
Client uploads "scan.pdf" containing 5 different documents, system misclassifies or only processes first page. Client renames "2024_taxes.pdf" to "income.pdf", system files under wrong category. Cat discovers errors during manual review, spends hours re-filing and re-requesting.

**Why it happens:**
Filenames are unreliable: clients use arbitrary names, combine multiple docs in one PDF, use generic scanner names (scan001.pdf, IMG_2024.jpg). Filename-only classification assumes too much about client behavior. PDFs vary wildly: scans, photos, multi-page, mixed documents in one file.

**How to avoid:**
- Require human-in-the-loop for classification: Cat reviews and confirms doc type before filing
- Use draft/staging folder: automated upload goes to "Needs Review" folder, Cat moves to correct location
- OCR + keyword detection for hints: scan for "T4" "employment income" but don't auto-classify
- Multi-page detection: alert if PDF has 10+ pages, likely multiple docs bundled
- Metadata tagging: store "client says this is: Pay Stub" + "auto-detected: unknown" for Cat review
- Never auto-file critical docs (income, property, ID) without human verification

**Warning signs:**
- Drive folders have docs in wrong categories
- Cat spends time moving files between folders
- Duplicate doc requests because original was misfiled
- Client confusion when asked for "already sent" docs
- Multi-page PDFs treated as single document

**Phase to address:**
Phase 1: Simple upload to staging area, Cat manually files. Phase 3: AI-assisted classification with confidence scores, still requires Cat review for low-confidence.

---

### Pitfall 7: Email Attachment Parsing Assumes PDF Format and Standard MIME Types

**What goes wrong:**
Clients send .heic images (iPhone default), .pages files (Mac), password-protected PDFs, or corrupted files. System silently fails to extract attachments or crashes during parsing. Cat discovers missing docs days later when checking Drive.

**Why it happens:**
Assumption that clients send PDFs. Reality: clients use phones (HEIC, JPEG), Macs (Pages, Numbers), scanners (TIFF), or forward from advisors (password-protected). Email parsers expect standard MIME types, fail on edge cases. No error handling for unsupported formats, just silent failure.

**How to avoid:**
- Explicitly list supported formats: PDF, JPEG, PNG, only
- Reject unsupported formats gracefully: reply to client "Please resend as PDF"
- Detect password-protected PDFs: catch encryption error, alert Cat
- Convert common formats: HEIC → JPEG, Pages → PDF (but adds complexity)
- Validate file integrity: check if PDF is readable before claiming "received"
- Alert on parsing failures: don't silently skip attachments
- Test with real-world samples: borrow Cat's inbox for test cases

**Warning signs:**
- "Missing attachment" errors in logs but client swears they sent it
- Drive uploads show 0 bytes or corrupted files
- Cat manually downloading attachments system should have handled
- No error notifications for parsing failures
- Only PDFs show up in Drive, other formats silently ignored

**Phase to address:**
Phase 1: Basic PDF support with error alerts. Phase 2: Broader format support and conversion.

---

### Pitfall 8: Synchronous Webhook Processing Causing Timeouts

**What goes wrong:**
Webhook endpoint receives Finmo event, processes synchronously: generate checklist (2s), create Drive folder (3s), upload docs (5s), send email (2s), update CRM (3s) = 15 seconds total. Provider timeout is 10s, retries webhook, causes duplicate processing. Endpoint appears "slow" or "down" during peak times.

**Why it happens:**
Natural instinct to process webhook in request handler. But external API calls are slow (network latency, rate limits), unpredictable (retries, failures), and serial processing blocks the HTTP response. GoHighLevel timeout is ~30s, but Gmail/Drive can be slower during rate limiting.

**How to avoid:**
- Always process webhooks asynchronously: return 200 OK immediately, queue work for background
- Use message queue (Redis, SQS, database queue): webhook writes to queue, workers process
- Implement webhook endpoint as thin receiver: validate, store payload, respond, done
- Background workers handle slow operations: can retry, rate limit, monitor without blocking webhook
- Set realistic worker timeout: 2-3 minutes for full processing, not 10 seconds
- Monitor queue depth: alert if queue grows (workers falling behind)

**Warning signs:**
- Webhook provider shows "timeout" errors for your endpoint
- Duplicate processing during busy periods
- HTTP request logs show 10-15 second response times
- Endpoint availability drops below 99% during application season
- Cat reports inconsistent automation (sometimes works, sometimes doesn't)

**Phase to address:**
Phase 1 (Foundation) — async processing required from start. Cannot retrofit easily after building synchronous flow.

---

### Pitfall 9: Missing Manual Override / Kill Switch

**What goes wrong:**
Automation goes haywire (e.g., sending 100 duplicate emails due to bug), no way to stop it. Cat tries to disable but doesn't have access to server. Taylor has to call you, you're unavailable, damage continues. Clients receive spam, Drive fills with duplicates, CRM corrupted.

**Why it happens:**
Automation deployed without operational controls. Assumption that "it will just work". No consideration for emergency scenarios. Access control gives only developers ability to stop services, not end users who observe problems first.

**How to avoid:**
- Implement feature flags: environment variable or database toggle to disable automation
- Provide Cat with admin panel: simple UI with "Pause Automation" button
- Circuit breaker on external actions: if sending >10 emails in 5 minutes, auto-pause and alert
- Rate limit outbound actions: max 1 email per client per day regardless of webhooks
- Implement dry-run mode: automation logs what it would do without doing it
- Document kill switch procedure: "Set AUTOMATION_ENABLED=false, restart service"
- Monitor for anomalies: if processing 10x normal webhook volume, alert before acting

**Warning signs:**
- No way for Cat to pause automation without developer intervention
- Production issues require code deployment to fix
- No automated safeguards against runaway loops
- Cat reports "I think something is wrong but I can't stop it"
- Monitoring alerts but no ability to pause automatically

**Phase to address:**
Phase 1: Basic manual kill switch (environment variable + restart). Phase 2: Admin UI and automated circuit breakers.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip idempotency, assume webhooks arrive once | Faster development (2-3 days saved) | Duplicate processing in production, impossible to retrofit cleanly | Never acceptable for production |
| Log full webhook payloads for debugging | Easier troubleshooting during development | PIPEDA violation, PII exposure, security audit failure | Only in local dev with synthetic data |
| Synchronous webhook processing | Simpler code, fewer components | Timeout errors, duplicate processing, poor scalability | Never acceptable for multi-API workflows |
| Filename-based doc classification | Avoid AI/OCR complexity in MVP | Misclassified docs, Cat spends hours re-filing | Acceptable for MVP if Cat reviews everything |
| Hard-code checklist rules in code | Faster than building admin UI | Every rule change requires deployment, Cat can't self-serve | Acceptable for Phase 1 if rules stable |
| Store OAuth tokens in environment variables | Quick setup without database | Tokens lost on server restart, no rotation tracking | Never acceptable for production |
| Skip rate limit monitoring | Fewer components to build | Silent failures during peak times, hard to debug | Acceptable if traffic is very low (<10 webhooks/day) |
| Single-threaded webhook processing | Simpler architecture | Can't handle concurrent submissions, becomes bottleneck | Acceptable for MVP with <5 apps/day |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Finmo webhooks | Assume webhook includes full application data | Fetch from Finmo API after receiving webhook (fetch-before-process pattern) |
| GoHighLevel API | Ignore rate limit headers, retry immediately on 429 | Check X-RateLimit-Remaining, implement exponential backoff with jitter |
| Gmail API | Use personal account OAuth tokens | Use service account or organization OAuth with delegated access |
| Google Drive API | Create folder on every webhook without checking if exists | Check for existing folder by name before creating (or use idempotency key) |
| MyBrokerPro custom fields | Assume field exists, write directly | Validate field exists in schema, gracefully handle missing fields |
| Email parsing | Assume single attachment per email | Handle multiple attachments, filter by file type, validate each |
| OAuth refresh | Refresh token on 401 error | Proactively refresh before expiration (50 min for 60 min token) |
| Webhook signatures | Skip verification in development | Always verify signatures, use same code in dev and prod |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous API calls in webhook handler | Slow response times, timeouts | Use background queue, async processing | >5 webhooks/minute |
| No connection pooling for API clients | 429 rate limit errors, slow API calls | Reuse HTTP connections, connection pool | >50 API calls/hour |
| Fetching full client list from CRM on every webhook | Slow CRM API calls, memory usage | Query by specific client ID, use pagination | >100 clients in CRM |
| Re-uploading same document multiple times | Drive quota exhaustion, slow uploads | Check if file exists by hash before uploading | >50 docs/day |
| Linear search through webhooks to check for duplicates | Slow duplicate detection, timeouts | Use database index on event_id, O(1) lookup | >1000 webhooks stored |
| No caching of frequently accessed data (e.g., doc checklist rules) | Repeated database queries, slow response | Cache static data in memory with TTL | >100 requests/hour |
| Processing all webhook types even if irrelevant | Wasted CPU, slow queue processing | Filter webhook types early, only queue relevant events | >500 webhooks/day |
| Storing full webhook payloads in database indefinitely | Database bloat, slow queries | Store metadata only, archive old payloads, retention policy | >10k webhooks |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing SIN numbers in plain text in database | PIPEDA violation, data breach liability | Encrypt PII at rest using application-level encryption, store decryption keys separately |
| Logging client names and financial data in error messages | PII exposure in logs, unauthorized access | Redact PII before logging, use client_id instead of name, audit logs for leaks |
| Using shared Google account for Drive/Gmail | No audit trail, can't revoke individual access | Use service account with domain-wide delegation or OAuth per user |
| No webhook signature verification | Attackers can forge webhooks, trigger malicious actions | Always verify HMAC signature from Finmo, reject unsigned requests |
| Storing OAuth refresh tokens in environment variables | Token leak if env vars logged or exposed | Store tokens encrypted in database, use secrets manager |
| Granting Drive/Gmail full access scope | Over-privileged access, larger attack surface | Request minimal scopes needed (e.g., gmail.send not gmail.readonly) |
| No input validation on webhook payloads | Injection attacks, malformed data crashes system | Validate webhook schema, sanitize inputs, reject invalid payloads |
| Sharing API keys across environments (dev/prod) | Production data exposed in dev, accidental prod actions | Separate API keys per environment, never use prod keys in dev |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent automation failures | Cat thinks automation sent email, it didn't, client gets nothing | Always notify Cat of failures, provide retry button in UI |
| No visibility into automation status | Cat doesn't know if doc request was sent or pending | Show automation log in UI: "Email sent to client at 2pm" |
| Auto-sending emails without draft review | Emails have wrong content, typos, missing attachments | Generate draft in Gmail/CRM, Cat reviews before sending |
| No way to manually trigger automation | Automation missed a webhook, Cat can't manually start it | Provide "Send Doc Request Now" button in admin panel |
| Checklist always same regardless of client type | Irrelevant docs requested (e.g., rental income for W2 employee) | Use conditional logic based on application data (employment type, property type) |
| Error messages only in server logs | Cat has to ask developer "did it work?", long feedback loop | Show user-friendly error in UI, email Cat on failures |
| No undo for automated actions | Cat accidentally triggers automation, can't cancel | Implement dry-run preview or 30-second cancel window |
| Overwhelming Cat with notifications | Every webhook triggers email to Cat, notification fatigue | Only notify on failures or items needing review, not successes |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Webhook receiver:** Often missing signature verification — verify HMAC from Finmo before processing
- [ ] **Idempotency:** Often missing database constraint — verify unique index on event_id prevents duplicates
- [ ] **OAuth tokens:** Often missing refresh logic — verify tokens refresh proactively, not on 401 error
- [ ] **Email sending:** Often missing error handling — verify Gmail API failures alert Cat, don't silently fail
- [ ] **Drive uploads:** Often missing duplicate check — verify file hash checked before uploading same doc twice
- [ ] **Rate limiting:** Often missing circuit breaker — verify system pauses on repeated failures, not infinite retry
- [ ] **PII logging:** Often missing redaction — verify logs contain no SIN numbers, income amounts, addresses
- [ ] **Error notifications:** Often missing user-facing alerts — verify Cat receives email on automation failures
- [ ] **Kill switch:** Often missing manual override — verify Cat can pause automation without developer
- [ ] **Async processing:** Often missing queue depth monitoring — verify alerts if queue grows beyond threshold
- [ ] **Doc classification:** Often missing multi-page detection — verify system alerts if PDF has 10+ pages
- [ ] **Webhook retries:** Often missing idempotent actions — verify re-running same webhook doesn't cause duplicates
- [ ] **API client initialization:** Often missing connection pooling — verify HTTP clients reused, not recreated per request
- [ ] **State transitions:** Often missing validation — verify invalid state changes rejected, not applied blindly
- [ ] **Token expiration:** Often missing proactive monitoring — verify daily health check for OAuth token validity

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Duplicate emails sent to clients | LOW | Apologize to affected clients, fix idempotency, verify no duplicates in past 7 days |
| Duplicate Drive folders created | MEDIUM | Manually merge folders, update CRM references, add unique constraint to prevent future |
| PII exposed in logs | HIGH | Delete logs immediately, rotate affected credentials, notify clients per PIPEDA breach protocol, audit all logs for PII |
| OAuth tokens expired | LOW | Re-run OAuth flow for dev@venturemortgages.com, update stored refresh token, verify automation resumes |
| Rate limit exceeded | MEDIUM | Wait for quota reset (24hr for daily limits), implement rate limiting, replay failed webhooks from DLQ |
| Webhook processing backed up | MEDIUM | Scale workers horizontally, process queue in batches, alert Cat of delays |
| Document misfiled in Drive | LOW | Move to correct folder, update metadata, verify client not affected |
| Email parsing failed | LOW | Download attachment manually, upload to Drive, update doc checklist, fix parser for next time |
| State inconsistency (CRM vs Finmo) | MEDIUM | Fetch authoritative state from Finmo API, update CRM to match, reconcile differences |
| Webhook missed (Finmo didn't send) | MEDIUM | Implement daily reconciliation job to fetch new apps from Finmo API, manual catchup for missed |
| Kill switch activated | LOW | Identify root cause, deploy fix, re-enable automation, process queued webhooks |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Webhook duplicate processing | Phase 1 (Foundation) | Test by manually sending duplicate webhook, verify only one email sent |
| Webhook event ordering | Phase 1 (Foundation) | Test by sending webhooks out of order, verify state machine rejects invalid transitions |
| API rate limit failures | Phase 1 (Foundation — basic), Phase 2 (circuit breaker) | Load test with 50 concurrent webhooks, verify exponential backoff and no crashes |
| PII exposure in logs | Phase 1 (Foundation) | Audit logs after test run, verify no SIN numbers or income amounts present |
| OAuth token refresh | Phase 1 (Foundation — basic), Phase 2 (monitoring) | Wait 61 minutes, verify token refreshed automatically and API calls continue |
| Document classification errors | Phase 1 (Foundation — staging area), Phase 3 (AI classification) | Upload ambiguous filename, verify Cat review required before filing |
| Email parsing failures | Phase 1 (Foundation) | Send .heic and .pages files, verify graceful error and Cat notification |
| Synchronous processing timeouts | Phase 1 (Foundation) | Send webhook with slow API responses, verify 200 OK returned within 5s |
| Missing kill switch | Phase 1 (Foundation — env var), Phase 2 (admin UI) | Set kill switch, send webhook, verify no actions taken |
| No error notifications | Phase 2 (Monitoring & Alerts) | Trigger API failure, verify Cat receives email within 5 minutes |
| Multi-page PDF handling | Phase 3 (Advanced Classification) | Upload 15-page PDF, verify system alerts Cat for review |
| Dead letter queue | Phase 2 (Reliability) | Cause webhook to fail 3 times, verify moves to DLQ for manual review |

## Sources

### Webhook Reliability & Idempotency
- [Top 7 Webhook Reliability Tricks for Idempotency | Medium](https://medium.com/@kaushalsinh73/top-7-webhook-reliability-tricks-for-idempotency-a098f3ef5809)
- [Webhooks at Scale: Designing an Idempotent, Replay-Safe, and Observable Webhook System](https://dev.to/art_light/webhooks-at-scale-designing-an-idempotent-replay-safe-and-observable-webhook-system-7lk)
- [How to Implement Webhook Idempotency | Hookdeck](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency)
- [Webhook Best Practices: Production-Ready Implementation Guide](https://inventivehq.com/blog/webhook-best-practices-guide)

### Webhook Event Ordering
- [Why You Can't Guarantee Webhook Ordering | Svix Blog](https://www.svix.com/blog/guaranteeing-webhook-ordering/)
- [Idempotency and Ordering in Webhook Handlers | bugfree.ai](https://bugfree.ai/knowledge-hub/idempotency-ordering-webhook-handlers)
- [Webhooks Fetch Before Process: Patterns and Event Types | Hookdeck](https://hookdeck.com/webhooks/guides/webhooks-fetch-before-process-pattern)

### Mortgage Document Automation
- [Mortgage Document Processing: A Simple Guide for Lenders](https://addy.so/blog/mortgage-document-processing)
- [Mortgage Data Extraction for Lenders | 2026 Guide](https://www.infrrd.ai/blog/mortgage-data-extraction-guide)
- [Mortgage Document Automation: Complete Guide for Lenders in 2025](https://www.infrrd.ai/blog/mortgage-document-automation-guide)
- [Mortgage Process Automation: The Key to Success in 2026](https://www.abbyy.com/blog/ai-mortgage-process-automation/)

### API Rate Limits
- [How to Handle API Rate Limits Gracefully (2026 Guide)](https://apistatuscheck.com/blog/how-to-handle-api-rate-limits)
- [API Rate Limiting 2026 | How It Works & Why It Matters](https://www.levo.ai/resources/blogs/api-rate-limiting-guide-2026)
- [GoHighLevel API Documentation](https://marketplace.gohighlevel.com/docs/oauth/Faqs/index.html)
- [Webhook Integration Guide | HighLevel API](https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/index.html)

### Document Classification & OCR
- [A Guide to Document Classification: Using Machine Learning, Deep Learning & OCR](https://nanonets.com/blog/document-classification/)
- [The 6 Biggest OCR Problems and How to Overcome Them](https://conexiom.com/blog/the-6-biggest-ocr-problems-and-how-to-overcome-them)
- [Best OCR Models Comparison Guide in 2026](https://www.f22labs.com/blogs/ocr-models-comparison/)
- [Best Practices - Optical Character Recognition (OCR) @ Pitt](https://pitt.libguides.com/ocr/bestpractices)

### OAuth Token Management
- [Google OAuth invalid grant: Token has been expired or revoked](https://www.nango.dev/blog/google-oauth-invalid-grant-token-has-been-expired-or-revoked)
- [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2)
- [Gmail OAuth 2.0 Authentication Changes 2026](https://www.getmailbird.com/gmail-oauth-authentication-changes-user-guide/)

### Dead Letter Queue Pattern
- [Building a Webhook Systems with NestJS: Handling Retry, Security, Dead-letter Queues](https://dev.to/juan_castillo/building-a-webhook-systems-with-nestjs-handling-retry-security-dead-letter-queues-and-rate-4nm7)
- [Dead Letter Queues and Retry Queues: The Safety Net for Distributed Systems](https://medium.com/@vinay.georgiatech/dead-letter-queues-and-retry-queues-the-safety-net-for-distributed-systems-b961c718e6a0)
- [Handle Webhook Retries & Failures: A Developer's Guide](https://mphase-studio.com/best-ways-to-handle-webhook-retries-and-failures-a-comprehensive-guide-for-developers/)

### Canadian Privacy Compliance
- [PIPEDA requirements in brief - Office of the Privacy Commissioner of Canada](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/)
- [PIPEDA Compliance: 2026 Guide for Canadian Privacy Law & Consent](https://geotargetly.com/blog/pipeda-compliance-guide-to-canada-privacy-law)
- [Canada's 2026 privacy priorities: data sovereignty, open banking and AI](https://www.osler.com/en/insights/reports/2025-legal-outlook/canadas-2026-privacy-priorities-data-sovereignty-open-banking-and-ai/)

### Google API Quotas
- [Usage limits | Gmail | Google for Developers](https://developers.google.com/workspace/gmail/api/reference/quota)
- [Usage limits | Google Drive | Google for Developers](https://developers.google.com/workspace/drive/api/guides/limits)
- [Google Workspace Rate Limiting: Proactive Prevention & Handling](https://support.cloudm.io/hc/en-us/articles/9235927751836-Google-Workspace-Rate-Limiting-Proactive-Prevention-Handling)

### Email Attachment Parsing
- [Best API For PDF Data Extraction (2026) | Parseur](https://parseur.com/blog/best-api-data-extraction)
- [How to Parse PDFs Effectively: Tools, Methods & Use Cases [Updated for 2026]](https://parabola.io/blog/best-methods-pdf-parsing)
- [PDF Parsing Methods Compared: Rule-Based, Zonal OCR, AI, and LLM Approaches](https://parsio.io/blog/pdf-parsing-methods-compared-rule-based-zonal-ocr-ai-and-llm-approaches/)

---
*Pitfalls research for: Webhook-driven mortgage document collection automation*
*Researched: 2026-02-09*
*Confidence: MEDIUM — based on industry best practices, official API documentation, and 2026 sources. Finmo-specific behavior requires validation during implementation.*
