# Phase 6: Document Intake - Research

**Researched:** 2026-02-13
**Domain:** Gmail API (message reading, attachments, push notifications), Finmo document API, PDF conversion, email monitoring patterns
**Confidence:** MEDIUM

## Summary

Phase 6 introduces two document intake channels: (1) Gmail inbox monitoring for emails forwarded to `docs@venturemortgages.co` by Cat or sent directly by clients, and (2) Finmo portal document upload detection via the "Document request status changed" resthook event. Both channels extract document attachments and convert non-PDF files to PDF for downstream processing (Phase 7: Classification & Filing).

The Gmail channel is the primary intake path. Cat currently receives documents via email and manually downloads/uploads them to Drive. The automation monitors the `docs@` inbox using the Gmail API. Two monitoring approaches are viable: (A) **Gmail Push Notifications** via Google Cloud Pub/Sub, which delivers near-real-time notifications when new emails arrive, or (B) **Polling** via `users.messages.list` on a BullMQ job scheduler (every 2-5 minutes). Push notifications require Google Cloud Pub/Sub infrastructure (free tier is generous at 10 GiB/month) and a publicly accessible webhook endpoint, which the Express server already provides. Polling is simpler but less responsive. **Recommendation: Start with polling** using BullMQ job schedulers (already in the stack), with push notifications as a future optimization. Polling at 2-minute intervals meets the "within 5 minutes" success criterion with lower infrastructure complexity.

The Finmo channel covers documents uploaded by clients directly through the Finmo portal. Finmo's API confirms a "Document request status changed" resthook event, plus `POST /api/v1/document-requests/files` and related endpoints for managing document files. The existing webhook infrastructure (Phase 1) already handles Finmo resthooks, so adding a new event type is straightforward. However, the exact payload format of the "Document request status changed" event is undocumented publicly -- this requires testing with a real Finmo webhook.

**Critical infrastructure change:** The current Gmail OAuth scope is `gmail.compose` only. Phase 6 requires `gmail.readonly` (minimum) to read messages and download attachments. This means re-running the OAuth consent flow to add the broader scope, and updating the service account delegation scopes in Google Workspace admin.

**Primary recommendation:** Build a `src/intake/` module with two sub-modules: `gmail-monitor.ts` (polling-based inbox watcher using BullMQ job scheduler) and `finmo-docs.ts` (resthook handler for document uploads). Use `pdf-lib` for image-to-PDF conversion and `libreoffice-convert` for Word-to-PDF conversion. Extract attachments using the Gmail API's `messages.get` + `messages.attachments.get` methods. Output: an `IntakeDocument` object (buffer, mimeType, originalFilename, sourceType, senderEmail, clientEmail) queued for Phase 7 processing.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `googleapis` | ^171.x | Gmail API for reading messages, listing messages, getting attachments | Already in project; official Google SDK with typed methods for `users.messages.list`, `users.messages.get`, `users.messages.attachments.get` |
| `google-auth-library` | ^10.x | OAuth2/JWT authentication for Gmail readonly access | Already in project; needed for service account delegation with `gmail.readonly` scope |
| `bullmq` | ^5.69.x | Job scheduler for periodic inbox polling; queue for intake processing | Already in project; `upsertJobScheduler` replaces repeatable jobs as of v5.16+ |
| `pdf-lib` | ^1.17.x | Image (PNG/JPEG) to PDF conversion | Pure JS, no native deps, works in any environment, TypeScript-native, actively maintained |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `libreoffice-convert` | ^1.7.x | Word (.doc/.docx) to PDF conversion | When Word documents are received as attachments; requires LibreOffice installed on host |
| `sharp` | ^0.34.x | Image processing (resize/normalize before PDF embedding) | Optional: only if images need preprocessing before PDF conversion (large photos, HEIC format) |
| `vitest` | ^4.0.18 | Test framework | Already in project; test attachment extraction, PDF conversion, monitor logic |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Polling (BullMQ scheduler) | Gmail Push Notifications (Pub/Sub) | Push is near-real-time but requires Google Cloud Pub/Sub setup, a Pub/Sub topic, and renewal every 7 days. Polling every 2 min meets the "5 minutes" SLA with zero additional infrastructure. Upgrade to push later if needed. |
| `pdf-lib` (images to PDF) | `sharp-pdf` or `puppeteer` | `sharp-pdf` is unmaintained (3 years old). Puppeteer is heavy (downloads Chromium). `pdf-lib` is pure JS, actively maintained, and handles PNG/JPEG embedding natively. |
| `libreoffice-convert` (Word to PDF) | Apryse/Nutrient SDK (commercial) | Commercial SDKs are more reliable and don't require LibreOffice installation. But they're expensive and overkill for the low volume (<10 docs/day). LibreOffice is free and handles basic DOCX well. |
| `libreoffice-convert` (Word to PDF) | Mammoth.js (DOCX to HTML) + pdf-lib | Two-step conversion loses formatting fidelity. LibreOffice preserves Word formatting better. Only advantage: no system dependency. |
| Hand-rolled MIME parsing | `gmail-api-parse-message-ts` | The TypeScript package (v2.2.x, maintained) simplifies Gmail message parsing. But for our use case (extract attachments only), hand-rolling is ~30 lines and avoids a dependency on a low-download package. **Recommendation: hand-roll** -- the Gmail API message structure is well-documented and we only need attachment extraction. |

**Installation:**
```bash
npm install pdf-lib libreoffice-convert
# libreoffice-convert requires LibreOffice installed on the host system
# On Railway/Render: add LibreOffice to the Docker image or use a buildpack
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── checklist/          # Phase 3 (existing)
├── crm/                # Phase 4 (existing)
├── email/              # Phase 5 (existing) - email sending
├── webhook/            # Phase 1 (existing) - Finmo webhook receiver
├── intake/             # Phase 6 (new) - document intake
│   ├── types.ts        # IntakeDocument, GmailMessageMeta, FinmoDocEvent types
│   ├── config.ts       # Intake config: polling interval, doc inbox, supported MIME types
│   ├── gmail-monitor.ts     # BullMQ job scheduler: poll docs@ inbox for new messages
│   ├── gmail-reader.ts      # Gmail API: read messages, extract attachments (internal)
│   ├── attachment-extractor.ts  # Parse MIME parts, download attachment data
│   ├── finmo-docs.ts        # Handle "Document request status changed" resthook
│   ├── pdf-converter.ts     # Convert images/Word to PDF (pure function)
│   ├── intake-worker.ts     # BullMQ worker: process intake jobs (extract -> convert -> queue for Phase 7)
│   ├── index.ts             # Barrel export
│   └── __tests__/
│       ├── gmail-reader.test.ts
│       ├── attachment-extractor.test.ts
│       ├── pdf-converter.test.ts
│       ├── finmo-docs.test.ts
│       └── intake-worker.test.ts
└── config.ts           # Shared config (add intake settings)
```

### Pattern 1: BullMQ Job Scheduler for Inbox Polling
**What:** Use BullMQ's `upsertJobScheduler` to create a repeating job that polls the docs@ Gmail inbox every 2 minutes. Each poll fetches new messages since the last known `historyId` (stored in Redis).
**When to use:** For the Gmail monitoring channel.
**Example:**
```typescript
// Source: BullMQ docs (https://docs.bullmq.io/guide/job-schedulers)
import { Queue } from 'bullmq';

const intakeQueue = new Queue('doc-intake', { connection: redisConfig });

// Create a scheduler that runs every 2 minutes
await intakeQueue.upsertJobScheduler(
  'gmail-poll',
  { every: 120_000 }, // 2 minutes in milliseconds
  {
    name: 'poll-docs-inbox',
    data: { source: 'gmail' },
  },
);
```

### Pattern 2: Gmail History-Based Polling (Efficient Delta Reads)
**What:** Instead of re-reading all messages each poll, use `users.history.list` with a stored `startHistoryId` to only get messages added since the last check. This is extremely efficient for low-volume inboxes.
**When to use:** Every poll cycle.
**Example:**
```typescript
// Source: Gmail API docs (https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)
const gmail = getGmailClient(); // reuse existing client pattern

// First run: get initial historyId from profile
const profile = await gmail.users.getProfile({ userId: 'me' });
let lastHistoryId = profile.data.historyId;

// Subsequent polls: get only new messages
const history = await gmail.users.history.list({
  userId: 'me',
  startHistoryId: lastHistoryId,
  historyTypes: ['messageAdded'],
  labelId: 'INBOX',
});

// Process new message IDs
const newMessageIds = (history.data.history ?? [])
  .flatMap(h => h.messagesAdded ?? [])
  .map(m => m.message?.id)
  .filter(Boolean);

// Update stored historyId for next poll
if (history.data.historyId) {
  lastHistoryId = history.data.historyId;
  // Persist to Redis for crash recovery
}
```

### Pattern 3: Gmail Attachment Extraction
**What:** Given a message ID, fetch the full message, parse MIME parts, and download attachment data.
**When to use:** For each new message detected in the docs@ inbox.
**Example:**
```typescript
// Source: Gmail API docs (https://developers.google.com/gmail/api/reference/rest/v1/users.messages.attachments/get)
const message = await gmail.users.messages.get({
  userId: 'me',
  id: messageId,
  format: 'full', // includes payload with parts
});

// Recursively find attachment parts
function findAttachments(parts: gmail_v1.Schema$MessagePart[]): Attachment[] {
  const attachments: Attachment[] = [];
  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        attachmentId: part.body.attachmentId,
        size: part.body.size ?? 0,
      });
    }
    if (part.parts) {
      attachments.push(...findAttachments(part.parts));
    }
  }
  return attachments;
}

// Download attachment data
const attachmentData = await gmail.users.messages.attachments.get({
  userId: 'me',
  messageId,
  id: attachmentId,
});
// attachmentData.data.data is base64url-encoded bytes
const buffer = Buffer.from(attachmentData.data.data!, 'base64url');
```

### Pattern 4: PDF Conversion Pipeline
**What:** Convert non-PDF attachments to PDF based on MIME type.
**When to use:** After extracting an attachment, before passing to Phase 7.
**Example:**
```typescript
// Source: pdf-lib docs (https://pdf-lib.js.org/)
import { PDFDocument } from 'pdf-lib';

async function imageToPdf(imageBuffer: Buffer, mimeType: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  const image = mimeType === 'image/png'
    ? await pdfDoc.embedPng(imageBuffer)
    : await pdfDoc.embedJpg(imageBuffer);

  const { width, height } = image.scale(1);
  const page = pdfDoc.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
```

### Pattern 5: Finmo Document Resthook Handler
**What:** Add a new webhook endpoint for Finmo "Document request status changed" events. Extract the document info and enqueue for processing.
**When to use:** When a client uploads a document through the Finmo portal.
**Example:**
```typescript
// Add to existing Express server (src/webhook/server.ts pattern)
app.post('/webhooks/finmo/documents', async (req, res) => {
  // Verify resthook signature (existing pattern)
  // Extract document event data
  const { applicationId, documentRequestId, status } = req.body;

  // Only process when status indicates new upload
  if (status === 'submitted' || status === 'in_review') {
    await intakeQueue.add('finmo-doc-upload', {
      applicationId,
      documentRequestId,
      source: 'finmo',
      receivedAt: new Date().toISOString(),
    }, {
      jobId: `finmo-doc-${documentRequestId}`, // Dedup
    });
  }

  res.status(202).json({ accepted: true });
});
```

### Anti-Patterns to Avoid
- **Polling entire inbox:** Never use `messages.list` without a `historyId` checkpoint. With history-based polling, each cycle only processes delta changes. Without it, you'd re-process all messages on every poll.
- **Storing attachment data in Redis/queue:** Attachment buffers can be 10+ MB. Never put raw file data in BullMQ job data. Instead, store a reference (messageId + attachmentId) and fetch on demand, or write to a temp file and pass the path.
- **Processing attachments synchronously in the poll job:** The polling job should only detect new messages and enqueue intake jobs. Actual attachment download and processing happens in the intake worker. This keeps the poll fast and idempotent.
- **Ignoring message deduplication:** The same message can appear in multiple `history.list` responses if the watch/poll overlaps. Use messageId-based dedup (BullMQ jobId pattern from Phase 1).
- **Hardcoding MIME type checks:** Use a lookup map/set for supported types, not if/else chains. New types can be added without code changes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Image (PNG/JPEG) to PDF | Custom canvas rendering or ImageMagick CLI wrapper | `pdf-lib` embedPng/embedJpg | Pure JS, handles image dimensions, no native deps, correct PDF page sizing |
| Word (DOCX) to PDF | Mammoth + HTML to PDF pipeline | `libreoffice-convert` | Preserves Word formatting (fonts, tables, margins). Two-step pipelines lose fidelity. |
| MIME message parsing | Full RFC 2822 parser | Recursive walk of `payload.parts` from Gmail API | Gmail API already parses MIME into structured parts. We only need to walk the tree and extract attachments. No raw MIME parsing needed. |
| Gmail authentication | Custom OAuth token management | `google-auth-library` + existing `getGmailClient()` | Already built in Phase 5. Extend with `gmail.readonly` scope. |
| Periodic job scheduling | Custom setInterval or cron library | BullMQ `upsertJobScheduler` | Already in the stack. Handles crashes, persistence, and distributed scheduling via Redis. |
| History ID persistence | File-based or database storage | Redis key (alongside BullMQ) | Redis is already the infrastructure backbone. A single key like `intake:gmail:lastHistoryId` is crash-safe and atomic. |

**Key insight:** The Gmail API does the heavy lifting of MIME parsing. We are not building an email parser -- we're walking a structured JSON response from Google and downloading binary attachment data. The real complexity is in the conversion pipeline (especially Word docs) and in the operational concerns (crash recovery, dedup, scope management).

## Common Pitfalls

### Pitfall 1: Gmail OAuth Scope Insufficient
**What goes wrong:** The current OAuth refresh token and service account delegation are configured with `gmail.compose` only. Attempting to call `users.messages.list` or `users.messages.get` fails with 403 "Insufficient Permission".
**Why it happens:** Phase 5 only needed compose access. Phase 6 needs read access.
**How to avoid:** Re-run the OAuth consent flow (`src/email/setup/get-refresh-token.ts`) with expanded scopes: `['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.readonly']`. For service account: update the domain-wide delegation in Google Workspace admin console to include `gmail.readonly`.
**Warning signs:** 403 errors from Gmail API when testing message reading.

### Pitfall 2: Different Gmail Account for docs@ vs admin@
**What goes wrong:** The current Gmail client authenticates as `admin@venturemortgages.com` (or `dev@` in dev mode). The docs inbox is `docs@venturemortgages.co`. These are different mailboxes requiring different authentication contexts.
**Why it happens:** Service account with domain-wide delegation can impersonate any user in the Google Workspace domain, but you must explicitly specify which user to impersonate. The current `getGmailClient()` hardcodes `emailConfig.senderAddress` as the impersonation subject.
**How to avoid:** Create a separate Gmail client instance for the docs@ inbox, or make `getGmailClient()` accept an optional `impersonateAs` parameter. For OAuth2 refresh tokens, you need a separate token for each mailbox.
**Warning signs:** Reading messages from the wrong inbox, or getting "Delegation denied" errors.

### Pitfall 3: History ID Becomes Invalid
**What goes wrong:** If too much time passes between polls (or after a crash), the stored `historyId` may no longer be valid. The Gmail API returns a 404 error.
**Why it happens:** Gmail only keeps history records for a limited period. Stale history IDs are rejected.
**How to avoid:** When `history.list` returns 404, fall back to a full message list (get recent messages from the last 24 hours using `after:` query) and reset the history ID from the latest message.
**Warning signs:** 404 errors from `history.list` after server downtime or deployment gaps.

### Pitfall 4: Large Attachments Causing Memory Pressure
**What goes wrong:** A client sends a 50 MB attachment (high-res property photos, multi-page scans). Downloading and converting in-memory causes OOM or slow processing.
**Why it happens:** `messages.attachments.get` returns the entire attachment as a base64-encoded string, which is ~33% larger than the raw bytes. Plus PDF conversion holds the image in memory.
**How to avoid:** Set a max attachment size limit (e.g., 25 MB, matching Gmail's own limit). For images going to PDF, use `sharp` to resize before embedding in `pdf-lib` if dimensions exceed a threshold (e.g., 4000px). Stream large files to temp disk if needed.
**Warning signs:** Worker process memory spikes, slow processing, OOM crashes.

### Pitfall 5: Forwarded Email Chain Treated as Attachment
**What goes wrong:** When Cat forwards an email from a client, the original email may be attached as an `.eml` file (MIME type `message/rfc822`), not as a standalone message with inline attachments.
**Why it happens:** Gmail's "Forward" behavior varies: inline forward preserves attachments in the new message's MIME parts; "Forward as attachment" wraps the entire original as an `.eml` attachment.
**How to avoid:** Detect `.eml` attachments and either: (a) extract the nested message's attachments recursively, or (b) flag for manual review. The simpler approach for Phase 6 is to handle inline-forwarded attachments (the common case) and flag `.eml` attachments for Cat's review.
**Warning signs:** Intake system misses attachments from forwarded emails.

### Pitfall 6: Finmo Resthook Payload Shape Unknown
**What goes wrong:** We build a handler based on assumed payload structure, but the actual "Document request status changed" event has different field names or nesting.
**Why it happens:** The Finmo API reference page doesn't publicly document resthook payloads in detail. The existing "Application submitted" handler already handles multiple payload shapes (see `extractApplicationId` in `server.ts`).
**How to avoid:** Set up the resthook in Finmo's dashboard, trigger a test event, and log the raw payload (PII-sanitized). Build the handler after confirming the actual shape. Include multiple fallback extraction patterns (same pattern as Phase 1).
**Warning signs:** 400 errors from the webhook endpoint when Finmo fires document events.

### Pitfall 7: LibreOffice Not Available in Production
**What goes wrong:** `libreoffice-convert` works perfectly in local dev but fails in production because LibreOffice is not installed on the Railway/Render server.
**Why it happens:** `libreoffice-convert` shells out to the `soffice` binary. Cloud platforms don't include LibreOffice by default.
**How to avoid:** Use a Docker image with LibreOffice pre-installed (e.g., `node:20-bookworm` + `apt-get install libreoffice-nogui`). Or use a Dockerfile with a multi-stage build. Alternative: if Word docs are rare (<5% of intake), convert them manually and skip `libreoffice-convert` initially.
**Warning signs:** ENOENT errors for `soffice` in production logs.

## Code Examples

### Gmail Inbox Monitor (BullMQ Job Scheduler)
```typescript
// Source: BullMQ docs + Gmail API docs
import { Queue, Worker } from 'bullmq';

const INTAKE_QUEUE = 'doc-intake';
const POLL_INTERVAL_MS = 120_000; // 2 minutes

// Scheduler setup (called once at startup)
export async function startGmailMonitor(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    'gmail-poll-docs',
    { every: POLL_INTERVAL_MS },
    {
      name: 'poll-docs-inbox',
      data: { source: 'gmail', inbox: 'docs@venturemortgages.co' },
    },
  );
}
```

### Attachment MIME Type Mapping
```typescript
// Supported intake MIME types and their conversion strategies
const SUPPORTED_MIME_TYPES = new Map<string, 'pdf' | 'image-to-pdf' | 'word-to-pdf' | 'unsupported'>([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'image-to-pdf'],
  ['image/png', 'image-to-pdf'],
  ['image/tiff', 'image-to-pdf'],
  ['image/webp', 'image-to-pdf'],
  ['image/heic', 'image-to-pdf'],  // May need sharp preprocessing
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'word-to-pdf'], // .docx
  ['application/msword', 'word-to-pdf'], // .doc
]);

export function getConversionStrategy(mimeType: string): string {
  return SUPPORTED_MIME_TYPES.get(mimeType) ?? 'unsupported';
}
```

### Word to PDF Conversion
```typescript
// Source: libreoffice-convert npm docs
import { promisify } from 'node:util';
import * as libre from 'libreoffice-convert';
const convertAsync = promisify(libre.convert);

async function wordToPdf(docBuffer: Buffer): Promise<Buffer> {
  const pdfBuffer = await convertAsync(docBuffer, '.pdf', undefined);
  return Buffer.from(pdfBuffer);
}
```

### Image to PDF (pdf-lib)
```typescript
// Source: pdf-lib docs (https://pdf-lib.js.org/)
import { PDFDocument } from 'pdf-lib';

async function imageToPdf(imageBuffer: Buffer, mimeType: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  let image;
  if (mimeType === 'image/png') {
    image = await pdfDoc.embedPng(imageBuffer);
  } else {
    // JPEG, TIFF converted to JPEG by sharp, etc.
    image = await pdfDoc.embedJpg(imageBuffer);
  }

  // Create page matching image dimensions
  const { width, height } = image.scale(1);
  const page = pdfDoc.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
```

### IntakeDocument Type
```typescript
/** Represents a document extracted from an intake source, ready for Phase 7 classification */
export interface IntakeDocument {
  /** Unique ID for deduplication */
  id: string;
  /** Raw PDF bytes (already converted if needed) */
  pdfBuffer: Buffer;
  /** Original filename from email attachment or Finmo */
  originalFilename: string;
  /** Original MIME type before conversion */
  originalMimeType: string;
  /** Where the document came from */
  source: 'gmail' | 'finmo';
  /** Email address of the sender (for client matching in Phase 7) */
  senderEmail: string | null;
  /** Associated Finmo application ID (if from Finmo portal) */
  applicationId: string | null;
  /** Gmail message ID (for dedup and audit trail) */
  gmailMessageId: string | null;
  /** Timestamp of intake */
  receivedAt: string;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| BullMQ repeatable jobs | BullMQ Job Schedulers (`upsertJobScheduler`) | v5.16.0 (2024) | Job schedulers are more robust, upsert-friendly, and don't create duplicate schedulers on restart. Must use `upsertJobScheduler` not `add` with `repeat`. |
| Gmail API polling (full message list) | Gmail History API (`history.list`) with `startHistoryId` | Long-standing, but polling apps typically miss this | 100x more efficient for low-volume inboxes. Only fetches delta changes. |
| `gmail.compose` scope for all Gmail ops | Separate scopes per use case | Always best practice | `gmail.compose` cannot read messages. Phase 6 needs `gmail.readonly` added to the token/delegation. |
| Raw base64 attachment handling | Gmail API structured payload + `messages.attachments.get` | Gmail API v1 | No need to parse raw MIME. The API structures MIME parts as JSON. Attachments >5MB use separate `attachments.get` endpoint. |

**Deprecated/outdated:**
- `gmail-api-parse-message` (original JS version): Last published 6 years ago. TypeScript fork exists (`gmail-api-parse-message-ts`, v2.2.x) but low adoption. For our simple use case, hand-rolling is preferred.
- BullMQ `add()` with `repeat` option: Deprecated in favor of `upsertJobScheduler` as of v5.16.0. The old API still works but creates duplicate schedulers on process restart.

## Open Questions

1. **How does Cat currently forward docs?**
   - What we know: Cat receives doc emails from clients and processes them. The doc request email tells clients to send to `docs@venturemortgages.co`.
   - What's unclear: Does Cat forward the email (preserving attachments inline)? Does she forward as attachment (creating .eml)? Or does she download and re-send? Does the client sometimes email docs@ directly?
   - Recommendation: Ask Cat directly. If clients email docs@ directly (after receiving the checklist email from Phase 5), then intake is simpler -- we just monitor docs@ for new messages. If Cat forwards, we need to handle forwarded message patterns. **The Phase 5 email already tells clients to send docs to docs@, so direct client emails to docs@ should be the primary path.**

2. **Finmo "Document request status changed" resthook payload format**
   - What we know: The event exists in Finmo's resthook catalog. The API has `/api/v1/document-requests/files` endpoints.
   - What's unclear: Exact payload fields (applicationId? documentRequestId? fileUrl? status string values?). How to download the actual file from Finmo after receiving the event.
   - Recommendation: Set up the resthook in Finmo dashboard pointing to a test endpoint. Trigger a real document upload. Log the payload. Build handler from actual data. This is a "test first, build second" task.

3. **Is docs@venturemortgages.co on the same Google Workspace domain?**
   - What we know: `dev@venturemortgages.com` and `admin@venturemortgages.com` are on the domain. The doc request email references `docs@venturemortgages.co` (note: `.co` not `.com`).
   - What's unclear: Is `.co` a typo, or is it a separate domain? If separate, service account domain-wide delegation may not cover it.
   - Recommendation: Confirm the exact domain. If it's the same Google Workspace org with a domain alias, delegation works. If it's a different account entirely, we need a separate OAuth token.

4. **LibreOffice availability in production**
   - What we know: Railway and Render support Docker. LibreOffice can be installed in a Docker image.
   - What's unclear: Current deployment setup. Is the project already using Docker? What's the base image?
   - Recommendation: If Word doc conversion is rare, defer `libreoffice-convert` and initially flag Word docs for Cat's manual conversion. Add LibreOffice when the Docker setup is confirmed. This keeps Phase 6 simpler.

5. **Multiple images as one document**
   - What we know: From meeting notes, "Multiple images of same doc (NOA page 1, 2, 3)" is a known edge case. Cat merges them into a single PDF.
   - What's unclear: How to detect that multiple images belong to the same document. Are they sent in the same email? Sequentially in separate emails?
   - Recommendation: For Phase 6, convert each image to its own PDF. Phase 7 (Classification) handles multi-page merging if needed (it has the AI context to detect "this is page 2 of the NOA"). Phase 6's job is just extraction and conversion.

## Sources

### Primary (HIGH confidence)
- [Gmail API Push Notifications Guide](https://developers.google.com/workspace/gmail/api/guides/push) - Full setup process, Pub/Sub requirements, watch expiration, rate limits
- [Gmail API users.watch Reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch) - Request/response format, required scopes
- [Gmail API users.history.list Reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list) - History-based polling, startHistoryId, historyTypes
- [Gmail API Scopes Reference](https://developers.google.com/workspace/gmail/api/auth/scopes) - All 13 scopes, sensitivity levels, required for each operation
- [Gmail API messages.attachments.get Reference](https://developers.google.com/gmail/api/reference/rest/v1/users.messages.attachments/get) - Attachment download endpoint
- [BullMQ Job Schedulers Documentation](https://docs.bullmq.io/guide/job-schedulers) - upsertJobScheduler API, cron/every patterns, job templates
- [pdf-lib Documentation](https://pdf-lib.js.org/) - embedPng/embedJpg, PDFDocument creation, page sizing
- [Finmo API Reference](https://finmo.readme.io/reference) - Document Requests, Document Request Files, Resthook events including "Document request status changed"
- [Finmo Help: How borrowers upload documents](https://help.finmo.ca/en/articles/3196338-how-to-upload-documents-as-a-borrower) - Upload flow, broker notification, status tracking
- [Finmo Help: REST API](https://help.finmo.ca/en/articles/6381437-finmo-rest-api) - Auth (bearer token), endpoints, token generation

### Secondary (MEDIUM confidence)
- [Google Cloud Pub/Sub Pricing](https://cloud.google.com/pubsub/pricing) - Free tier: 10 GiB/month, $40/TiB after
- [libreoffice-convert npm](https://www.npmjs.com/package/libreoffice-convert) - v1.7.0, published 2 months ago, requires LibreOffice binary
- [Finmo Help: Resthook Signature Verification](https://help.finmo.ca/en/articles/7792773-how-to-verify-finmo-resthook-signatures-beta) - RSA-SHA256, `finmo-resthook-signature` header, crypto verification code
- [gmail-api-parse-message-ts npm](https://www.npmjs.com/package/gmail-api-parse-message-ts) - v2.2.33, TypeScript, IAttachment interface

### Tertiary (LOW confidence)
- Finmo "Document request status changed" resthook payload format: NOT publicly documented. Must test with real webhook to determine field names. The event exists in the catalog but payload shape is unknown.
- Word document volume: Assumed to be <5% of intake based on meeting notes (most docs arrive as PDF or images). Needs validation with Cat.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - googleapis, pdf-lib, BullMQ all verified with official docs; libreoffice-convert verified on npm
- Architecture: MEDIUM - Gmail polling pattern is well-established, but specific integration with existing codebase requires decisions on Gmail client refactoring and scope management
- Pitfalls: MEDIUM-HIGH - Most pitfalls are verified from official docs (scope requirements, history ID behavior, attachment handling)
- Finmo integration: LOW - Resthook payload format is undocumented; requires live testing

**Research date:** 2026-02-13
**Valid until:** 2026-03-13 (30 days; stable domain, Gmail API is mature, Finmo API may change)
