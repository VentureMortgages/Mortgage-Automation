# Phase 25: Smart Forwarding Notes & Filing Feedback - Research

**Researched:** 2026-03-06
**Domain:** Gmail intake pipeline, Gemini AI structured output, Google Drive folder matching, Gmail API send
**Confidence:** HIGH

## Summary

Phase 25 fixes three cascading failures exposed by Cat's Wong-Ranasinghe forwarded email. The regex-based forwarding note parser in `src/intake/body-extractor.ts` only handles single-client notes ("Name - docType") and cannot parse natural language notes mentioning multiple clients and doc assignments. The auto-create logic in `src/matching/auto-create.ts` calls `findOrCreateFolder()` which does an exact name match in Drive, missing existing folders with different name formats. And there is no feedback mechanism to tell Cat what happened after she forwards docs.

All three components already exist in the codebase and need targeted modifications. The Gemini SDK (`@google/generative-ai`) is already installed and used for both classification (`src/classification/classifier.ts`) and matching (`src/matching/agent.ts`) with structured output. The Gmail API clients for both compose and modify scopes are set up. The Drive API `files.list` with query filtering is used throughout. No new dependencies are needed.

**Primary recommendation:** Replace the regex parser with a Gemini Flash structured output call (same pattern as classifier.ts), add a `searchFoldersFuzzy()` function before `findOrCreateFolder()` in auto-create, and add a `sendFilingConfirmation()` function using `gmail.users.messages.send` (not drafts -- this is machine feedback, not client-facing).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **AI Forwarding Note Parser (replace regex)**
   - Replace `parseForwardingNote()` in `src/intake/body-extractor.ts` with a Gemini Flash call
   - One API call per forwarded message (not per doc) -- ~50 tokens, negligible cost
   - Structured output schema returns: `{ clients, docs[], rawNote }`
   - `ForwardingNotes` interface expands to support multiple clients + per-doc assignments
   - Downstream: each attachment gets its own client assignment from the parsed note
   - Fallback: if Gemini call fails, fall back to regex parser (non-fatal)
   - Model: `gemini-2.0-flash` (same as classification)

2. **Drive Folder Fuzzy Matching Before Auto-Create**
   - Before creating a new folder, search prod root for existing folders whose name fuzzy-matches
   - Match logic: normalize names (case-insensitive, ignore punctuation), check substring
   - If match found, use that folder ID and link to CRM contact
   - If multiple matches, route to Needs Review (ambiguous)
   - Integration point: `autoCreateFromDoc()` in `src/matching/auto-create.ts`

3. **Filing Confirmation Email to Sender**
   - After processing all docs from a forwarded email, send summary reply to sender
   - Reply to original message thread (same Gmail threadId)
   - Content: list of docs processed, where filed, any needing review
   - Uses `gmail.compose` scope from docs@ mailbox
   - Sender detection: read `From` header of the forwarded email

4. **Link Existing Folders to CRM Contacts (Immediate Fix)**
   - Link Wong-Ranasinghe folder (1IESaMxZKcqe1PN63--PhKc39S9HYqVkf) to two contacts
   - One-time data fix that validates the folder-linking flow

### Claude's Discretion
None specified -- all decisions are locked.

### Deferred Ideas (OUT OF SCOPE)
None specified.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FWD-01 | AI forwarding note parsing (replace regex with Gemini) | Gemini structured output already used in classifier.ts; same SDK, same model, same pattern. ForwardingNotes interface needs expansion for multi-client/multi-doc. |
| FWD-02 | Drive folder fuzzy matching before auto-create | Drive API `files.list` with `name contains` query already used in filer.ts. Need new function to list all root folders and fuzzy match against client name. |
| FWD-03 | Filing confirmation email to sender | Gmail `messages.send` API available via service account. MimeMessageInput already supports custom headers. Need threadId + In-Reply-To for in-thread reply. |
| FWD-04 | Link existing folders to CRM contacts | `upsertContact` with `customFields` already proven in auto-create.ts. One-time script using existing pattern. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @google/generative-ai | ^0.24.1 | Gemini Flash structured output for AI parsing | Already installed, used by classifier.ts and matching agent |
| googleapis | ^171.4.0 | Gmail API send, Drive API folder listing | Already installed, all scopes delegated |
| vitest | ^4.0.18 | Unit testing | Already the test framework, 988 tests passing |
| zod | ^4.3.6 | Schema validation for AI response | Already installed, used by ClassificationResultSchema |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bullmq | ^5.69.1 | Job queue for batch confirmation emails | Already used for intake and classification queues |

### Alternatives Considered
None -- all required libraries are already installed. No new dependencies needed.

## Architecture Patterns

### Current Pipeline Flow (Before Phase 25)
```
Email arrives at docs@
  -> Gmail poller detects (intake-worker.ts)
  -> Extract forwarding notes (body-extractor.ts) -- REGEX, single client only
  -> Extract attachments
  -> For each attachment: enqueue classification job
    -> Classify doc (classifier.ts) -- Gemini
    -> Match to CRM contact (matching agent) -- Gemini agentic loop
    -> If no match: auto-create contact + folder (auto-create.ts) -- EXACT name match
    -> File to Drive (classification-worker.ts)
    -> NO CONFIRMATION sent back
```

### Modified Pipeline Flow (After Phase 25)
```
Email arrives at docs@
  -> Gmail poller detects (intake-worker.ts)
  -> Extract forwarding notes (body-extractor.ts) -- AI, multi-client support
  -> Extract attachments
  -> For each attachment: enqueue classification job WITH per-doc client assignment
    -> Classify doc (classifier.ts)
    -> Match to CRM contact (matching agent)
    -> If no match: FUZZY search root folders BEFORE auto-create
    -> File to Drive (classification-worker.ts)
  -> After ALL classification jobs complete: send filing confirmation to sender
```

### Key Integration Points

**1. body-extractor.ts (FWD-01)**
- `ForwardingNotes` interface changes from single-client to multi-client
- New `parseForwardingNoteAI()` function alongside existing `parseForwardingNote()` (fallback)
- `extractForwardingNotes()` calls AI parser first, falls back to regex
- Returns expanded interface with per-doc client assignments

**2. intake-worker.ts (FWD-01 downstream)**
- Currently passes single `forwardingNoteClientName` to all classification jobs
- Must use per-doc assignments from AI parser to give each attachment its own client hint
- The AI parser output includes a `docs[]` array mapping each doc type to a client

**3. auto-create.ts (FWD-02)**
- Before `findOrCreateFolder(drive, folderName, rootFolderId)`, call new `searchExistingFolders()`
- `searchExistingFolders()` uses Drive API `files.list` to find folders in root that fuzzy-match
- If found: use existing folder ID, link to CRM contact (upsertContact with customFields)
- If ambiguous (multiple matches): return null, route to Needs Review

**4. New: filing-confirmation.ts (FWD-03)**
- New module that collects classification results per-message and sends confirmation
- Uses `gmail.users.messages.send` (not drafts -- this is automated feedback)
- Sends as reply in original thread (threadId + In-Reply-To header)
- Sender is docs@ (using existing gmail compose scope)

### Recommended Project Structure
```
src/
  intake/
    body-extractor.ts        # MODIFY: add AI parser, expand ForwardingNotes
    intake-worker.ts         # MODIFY: per-doc client assignment from AI notes
    __tests__/
      body-extractor.test.ts # MODIFY: add AI parser tests
  matching/
    auto-create.ts           # MODIFY: add fuzzy folder search before create
    folder-search.ts         # NEW: fuzzy folder matching logic
    __tests__/
      auto-create.test.ts    # MODIFY: add fuzzy match tests
      folder-search.test.ts  # NEW: fuzzy match unit tests
  classification/
    classification-worker.ts # MODIFY: collect results for confirmation email
    filer.ts                 # UNCHANGED (used by folder-search for Drive queries)
  email/
    filing-confirmation.ts   # NEW: send filing summary email to sender
    gmail-client.ts          # MODIFY: add sendGmailMessage() for direct send
    mime.ts                  # MODIFY: add threadId + In-Reply-To support
    __tests__/
      filing-confirmation.test.ts  # NEW
  admin/
    link-wong-ranasinghe.ts  # NEW: one-time data fix script
```

### Anti-Patterns to Avoid
- **Batch AI calls per attachment:** Do NOT call Gemini per attachment. The note is one text blob -- parse it once for the whole email, then distribute assignments downstream.
- **Eager folder listing on every doc:** Do NOT list all root folders on every classification job. Only search for fuzzy match in the `auto_created` outcome path (when no CRM match exists).
- **Draft for machine feedback:** Do NOT create a draft for the filing confirmation. This is automated system feedback, not client-facing communication. Use `messages.send` directly.
- **Blocking on confirmation email:** Do NOT block document filing waiting for the confirmation. File docs first, send confirmation after all are processed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MIME message encoding with threading | Custom MIME builder | Extend existing `encodeMimeMessage()` in `src/email/mime.ts` | Already handles headers, base64url, RFC 2822. Just add threadId + In-Reply-To. |
| Gemini structured output | Custom JSON parsing | `generativeModel.generateContent()` with `responseSchema` | Already proven in classifier.ts with schema enforcement |
| Drive folder search | Custom folder traversal | Drive API `files.list` with query `mimeType = 'application/vnd.google-apps.folder' and '{rootId}' in parents and trashed = false` | API handles pagination, auth, error codes |
| CRM field update | Direct HTTP calls | Existing `upsertContact()` with `customFields` | Already handles auth, rate limiting, field mapping |

**Key insight:** Every component needed already exists in the codebase. Phase 25 is about composing existing patterns in new ways, not building new infrastructure.

## Common Pitfalls

### Pitfall 1: Gmail Thread Reply Requires In-Reply-To Header
**What goes wrong:** Sending a message with `threadId` in the request body but without proper `In-Reply-To` and `References` MIME headers causes Gmail to create a new thread instead of replying in the existing one.
**Why it happens:** Gmail API's `threadId` parameter is necessary but not sufficient. The MIME message must also contain proper RFC 2822 threading headers.
**How to avoid:** When building the MIME message for the confirmation email, include `In-Reply-To: <original-message-id>` and `References: <original-message-id>` headers. The original message ID comes from the Gmail message metadata (not the BullMQ job ID).
**Warning signs:** Confirmation emails appearing as separate conversations in Gmail instead of as replies.

### Pitfall 2: Gmail Message-ID Format
**What goes wrong:** Using raw Gmail message IDs (like `18e1a2b3c4d5e6f7`) in `In-Reply-To` headers instead of proper RFC 2822 Message-ID format.
**Why it happens:** Gmail's internal message IDs are not the same as RFC 2822 Message-IDs. The MIME `In-Reply-To` header requires the format `<unique-id@domain>`.
**How to avoid:** Fetch the original message's `Message-ID` header from the Gmail API response headers, not the `id` field. The `Message-ID` header is in the format `<CAxxxxxxxx@mail.gmail.com>`. Pass this through the classification pipeline so it's available when building the confirmation.
**Warning signs:** Thread matching silently failing, confirmation emails in wrong threads.

### Pitfall 3: Drive Folder Name Normalization
**What goes wrong:** Fuzzy matching fails to find "Wong-Ranasinghe, Carolyn/Srimal" when searching for "RANASINGHE" because the search only does exact substring match without name normalization.
**Why it happens:** Hyphenated names, comma-separated co-borrower names, and case differences create many edge cases.
**How to avoid:** Normalize both search term and folder name: lowercase, strip punctuation (except spaces), then check if any word from the search term appears as a word in the folder name. The Drive API `name contains` query is case-insensitive, which helps, but the programmatic verification after API results must handle the edge cases.
**Warning signs:** Duplicate folders created for hyphenated or compound names.

### Pitfall 4: Race Condition Between Classification Jobs and Confirmation Email
**What goes wrong:** The confirmation email is sent before all classification jobs for a single forwarded email have completed.
**Why it happens:** Intake worker creates N classification jobs (one per attachment) and they run asynchronously via BullMQ. There's no built-in "wait for all jobs from this email" mechanism.
**How to avoid:** Two options: (A) Track per-message classification results in Redis and send confirmation when the last one completes, or (B) Use BullMQ's flow/group features. Option A is simpler and fits the existing architecture -- each classification job writes its result to a Redis hash keyed by gmailMessageId, and the last job to complete sends the confirmation.
**Warning signs:** Partial confirmation emails missing some docs, or no confirmation at all.

### Pitfall 5: Forwarding Notes AI Parser Returns Invalid Client Names
**What goes wrong:** Gemini sometimes hallucinates client names or misinterprets the note, producing names that don't match any CRM contact.
**Why it happens:** Natural language notes can be ambiguous ("Srimal and Carolyn's IDs" vs "Srimal's ID and Carolyn's ID").
**How to avoid:** The AI parser should extract raw names from the note text, not infer names from context. Use a tight structured output schema that constrains the model. Fall back to regex parser if the AI response doesn't validate. The matching agent downstream will still do CRM lookup -- the AI parser just provides better hints than regex.
**Warning signs:** Forwarding note client names not matching any CRM contacts, causing auto-create when a contact exists.

### Pitfall 6: Confirmation Email Sent From Wrong Mailbox
**What goes wrong:** Confirmation email is sent from admin@ (the compose client default) instead of docs@ (the inbox that received the forwarded email).
**Why it happens:** The existing `getGmailClient()` returns a client impersonating `emailConfig.senderAddress` which is admin@ in production.
**How to avoid:** Create or use a Gmail compose client that impersonates the docs inbox (`intakeConfig.docsInbox`). The service account has domain-wide delegation for gmail.compose scope across all addresses.
**Warning signs:** Cat sees confirmation emails from admin@ instead of docs@, breaking the thread in her Gmail view.

## Code Examples

### Pattern 1: Gemini Structured Output (from classifier.ts)
```typescript
// Source: src/classification/classifier.ts (existing pattern)
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';

const responseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    clients: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Client names mentioned in the note',
    },
    docs: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          client: { type: SchemaType.STRING },
          type: { type: SchemaType.STRING },
        },
        required: ['client', 'type'],
      },
    },
    rawNote: { type: SchemaType.STRING },
  },
  required: ['clients', 'docs', 'rawNote'],
};

const model = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema,
  },
});

const result = await model.generateContent([
  { text: `Parse this forwarding note...\n\n"${noteText}"` },
]);
```

### Pattern 2: Drive API Folder Search (from filer.ts)
```typescript
// Source: src/classification/filer.ts (existing pattern)
const query =
  `name contains '${escapeDriveQuery(searchTerm)}' ` +
  `and '${rootFolderId}' in parents ` +
  `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

const response = await drive.files.list({
  q: query,
  fields: 'files(id, name)',
  pageSize: 100, // Get all matching folders for fuzzy comparison
});
```

### Pattern 3: Gmail messages.send with Threading (from e2e tests)
```typescript
// Source: src/e2e/battle-test-e2e.ts (existing pattern)
// To reply in an existing thread, include In-Reply-To + References headers
// AND pass threadId in the request body
const mimeHeaders = [
  `From: docs@venturemortgages.co`,
  `To: ${senderEmail}`,
  `Subject: Re: ${originalSubject}`,
  `In-Reply-To: ${originalMessageRfc822Id}`,
  `References: ${originalMessageRfc822Id}`,
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
];

const raw = Buffer.from(mimeHeaders.join('\r\n') + '\r\n\r\n' + bodyText)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

await gmail.users.messages.send({
  userId: 'me',
  requestBody: { raw, threadId: originalThreadId },
});
```

### Pattern 4: Extend MimeMessageInput for Threading
```typescript
// Extension of src/email/types.ts MimeMessageInput
export interface MimeMessageInput {
  to: string;
  from: string;
  subject: string;
  body: string;
  bcc?: string;
  customHeaders?: Record<string, string>;
  // New fields for thread replies:
  threadId?: string;        // Gmail thread ID
  inReplyTo?: string;       // RFC 2822 Message-ID of original message
  references?: string;      // RFC 2822 References header
  contentType?: 'text/html' | 'text/plain';  // Override content type
}
```

### Pattern 5: Confirmation Email Content Template
```typescript
// Filing confirmation content (plain text, not HTML)
function buildConfirmationBody(results: FilingResult[]): string {
  const filed = results.filter(r => r.filed);
  const needsReview = results.filter(r => r.manualReview);

  let body = `Filed ${filed.length} document${filed.length !== 1 ? 's' : ''} from your forwarded email:\n\n`;

  for (const r of filed) {
    body += `  OK  ${r.borrowerName} - ${r.docTypeLabel} -> ${r.folderPath}\n`;
  }

  for (const r of needsReview) {
    body += `  !!  ${r.borrowerName} - ${r.docTypeLabel} -> Needs Review (${r.reason})\n`;
  }

  body += '\n-- Venture Mortgages Doc System';
  return body;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex forwarding note parser | AI structured output parser (Gemini Flash) | Phase 25 | Handles multi-client, natural language notes |
| Exact Drive folder name match | Fuzzy name matching with normalization | Phase 25 | Prevents duplicate folders for compound/hyphenated names |
| No filing feedback | Automated confirmation email in-thread | Phase 25 | Cat knows what happened without checking Drive manually |

**Existing capabilities being leveraged:**
- Gemini 2.0 Flash with structured output: proven in classifier.ts (353 production docs, 94.1% accuracy)
- Gmail API compose + send: proven in e2e tests and draft creation
- Drive API folder search: proven in filer.ts
- Service account domain-wide delegation: all scopes already granted

## Open Questions

1. **Confirmation email timing for multi-attachment messages**
   - What we know: BullMQ classification jobs are async, one per attachment. No built-in "batch complete" event.
   - What's unclear: Best mechanism to detect when all jobs for a single Gmail message are done.
   - Recommendation: Use Redis hash per gmailMessageId tracking expected vs completed count. The last classification job to complete triggers the confirmation send. Store results as they complete.

2. **Drive API `name contains` case sensitivity**
   - What we know: The Drive API `name contains` query is documented as case-insensitive for `name` field queries.
   - What's unclear: Whether partial word matches work (e.g., "RANASINGHE" matching "Wong-Ranasinghe").
   - Recommendation: Use `name contains` for initial candidate retrieval, then apply programmatic fuzzy matching on the results. This is a two-step approach: API narrows candidates, code does precise matching.

3. **Gmail Message-ID retrieval for In-Reply-To header**
   - What we know: The intake worker already fetches full message via `messages.get` with `format: 'full'`. The Message-ID header is available in `payload.headers`.
   - What's unclear: Whether the Message-ID is always present on forwarded messages.
   - Recommendation: Extract `Message-ID` from headers in `getMessageDetails()` or during full message fetch. If not available, fall back to not threading (send standalone confirmation).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest implied from package.json |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FWD-01 | AI parser extracts multi-client notes | unit | `npx vitest run src/intake/__tests__/body-extractor.test.ts -x` | Partial (regex tests exist, AI tests needed) |
| FWD-01 | AI parser falls back to regex on failure | unit | `npx vitest run src/intake/__tests__/body-extractor.test.ts -x` | No -- Wave 0 |
| FWD-02 | Fuzzy folder search finds existing folders | unit | `npx vitest run src/matching/__tests__/folder-search.test.ts -x` | No -- Wave 0 |
| FWD-02 | Multiple fuzzy matches route to Needs Review | unit | `npx vitest run src/matching/__tests__/folder-search.test.ts -x` | No -- Wave 0 |
| FWD-02 | Auto-create uses fuzzy match before creating | unit | `npx vitest run src/matching/__tests__/auto-create.test.ts -x` | Partial (auto-create tests exist, fuzzy integration needed) |
| FWD-03 | Confirmation email sent to sender | unit | `npx vitest run src/email/__tests__/filing-confirmation.test.ts -x` | No -- Wave 0 |
| FWD-03 | Confirmation includes In-Reply-To for threading | unit | `npx vitest run src/email/__tests__/filing-confirmation.test.ts -x` | No -- Wave 0 |
| FWD-04 | Wong-Ranasinghe folders linked to contacts | manual-only | One-time script run | No -- script only |

### Sampling Rate
- **Per task commit:** `npx vitest run -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/matching/__tests__/folder-search.test.ts` -- covers FWD-02 fuzzy matching
- [ ] `src/email/__tests__/filing-confirmation.test.ts` -- covers FWD-03 confirmation email
- [ ] AI parser tests in `src/intake/__tests__/body-extractor.test.ts` -- covers FWD-01

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/classification/classifier.ts` -- Gemini structured output pattern
- Existing codebase: `src/classification/filer.ts` -- Drive API folder search pattern
- Existing codebase: `src/email/gmail-client.ts` -- Gmail API client with compose scope
- Existing codebase: `src/email/mime.ts` -- MIME message encoding
- Existing codebase: `src/matching/auto-create.ts` -- auto-create flow to modify
- Existing codebase: `src/intake/body-extractor.ts` -- regex parser to replace
- Existing codebase: `src/e2e/battle-test-e2e.ts` -- Gmail messages.send with threading pattern

### Secondary (MEDIUM confidence)
- Gmail API docs: `messages.send` with `threadId` in request body for reply threading
- Drive API docs: `files.list` with `name contains` query filter (case-insensitive)

### Tertiary (LOW confidence)
- None -- all patterns are already proven in the codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and proven in this codebase
- Architecture: HIGH -- all integration points are well-understood from code review
- Pitfalls: HIGH -- based on direct codebase analysis and Gmail API behavior observed in e2e tests

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable patterns, no dependency changes expected)
