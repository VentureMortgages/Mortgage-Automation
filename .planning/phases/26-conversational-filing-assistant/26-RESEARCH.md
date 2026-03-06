# Phase 26: Conversational Filing Assistant - Research

**Researched:** 2026-03-06
**Domain:** Gmail reply detection, AI natural language parsing, Redis state management, Drive file operations
**Confidence:** HIGH

## Summary

Phase 26 extends the existing filing confirmation system (Phase 25) to support two-way conversation. Currently, when multiple folder matches are found, the system silently routes documents to Needs Review. Phase 26 makes this interactive: the confirmation email presents options to Cat, Cat replies in natural language, the system parses her reply with Gemini Flash, and executes the deferred filing.

This phase touches four existing modules -- `folder-search.ts` (return multiple matches instead of null), `auto-create.ts` / `classification-worker.ts` (pass match options into filing results), `intake-worker.ts` (detect reply messages before normal processing), and `filing-confirmation.ts` (build question emails and handle follow-up confirmations). A new module handles AI reply parsing, and Redis stores pending choice state.

**Primary recommendation:** Follow the existing project patterns exactly. Use the same Gemini 2.0 Flash structured output pattern from `body-extractor.ts` and `classifier.ts`. Use the same Redis lazy singleton pattern from `filing-confirmation.ts`. Use the same MIME threading pattern from `filing-confirmation.ts`. The codebase already has all the building blocks; Phase 26 is assembly, not invention.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
1. **Multiple Match Options in Confirmation Email (CONV-01):** When `searchExistingFolders()` finds 2+ fuzzy matches, pass all matches through to the confirmation email. Change `folder-search.ts` to return the full match list. Change `auto-create.ts` to pass match options into the filing result. Confirmation email presents options naturally with conversational tone. Same pattern for ambiguous contact matches.
2. **Detect Replies to Confirmation Threads (CONV-02):** Use existing docs@ inbox polling (every 120s). Detect replies by matching threadId or subject pattern. Store pending choices in Redis with gmailMessageId as key. TTL: 24 hours. In intake worker: before normal processing, check if incoming message is a reply to a pending choice thread.
3. **AI-Parse Cat's Natural Language Reply (CONV-03):** Use Gemini Flash structured output (same pattern as classifier and forwarding note parser). Input: Cat's reply text + the list of options. Output: `{ selectedIndex, confidence }` or `{ selectedIndex: null, needsClarification: true }`. If confidence < 0.7 or can't determine, ask again. Model: gemini-2.0-flash.
4. **Execute Deferred Filing + Follow-up Confirmation (CONV-04):** After parsing Cat's choice, execute the filing (move doc from Needs Review to chosen folder). Link folder to CRM contact if not already linked. Send follow-up confirmation in same thread. Handle "create new folder" and "skip" commands.

### Claude's Discretion
- Redis key structure and TTL for pending choices
- Exact Gemini prompt wording for reply parsing
- How to handle replies that arrive after TTL expiry
- Rate limiting / dedup for reply processing

### Deferred Ideas (OUT OF SCOPE)
None specified.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONV-01 | Pass multiple match options through to confirmation email | `folder-search.ts` returns `null` for 2+ matches; change return type to include match list. `classification-worker.ts` needs_review/conflict path already has `matchDecision.candidates` available. Confirmation email builder in `filing-confirmation.ts` needs new question-format body builder. |
| CONV-02 | Detect replies to confirmation threads in docs@ inbox | `intake-worker.ts` processes Gmail messages from `@venturemortgages.com` senders. Reply detection via threadId lookup in Redis (O(1)). Gmail already provides threadId in `getMessageDetails()`. Reply intercept goes before attachment extraction in `processGmailSource()`. |
| CONV-03 | AI-parse Cat's natural language reply to select correct option | Gemini 2.0 Flash with `responseSchema` enforcement, same pattern as `parseForwardingNoteAI()` in `body-extractor.ts`. Structured output guarantees valid JSON. Zod validation as belt-and-suspenders. |
| CONV-04 | Execute deferred filing and send follow-up confirmation | Drive file move via `files.update` with `addParents`/`removeParents` params. Filing confirmation reply uses same MIME threading pattern from `filing-confirmation.ts`. CRM contact linking uses existing `upsertContact()` with `driveFolderIdFieldId`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @google/generative-ai | (existing) | Gemini 2.0 Flash structured output for reply parsing | Same library used in classifier.ts and body-extractor.ts |
| ioredis | (existing) | Pending choice state storage with TTL | Same library used in filing-confirmation.ts |
| googleapis | (existing) | Gmail API (read replies, send follow-ups) + Drive API (move files) | Already used throughout the project |
| bullmq | (existing) | Queue integration (intake worker processes replies) | Existing queue infrastructure |
| zod | (existing) | Validate Gemini structured output | Belt-and-suspenders pattern from classifier.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.0.18 | Testing | All unit tests, mocking Redis/Gmail/Gemini |

### Alternatives Considered
None -- Phase 26 uses 100% existing stack. No new dependencies required.

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  email/
    filing-confirmation.ts     # MODIFY: add question builder + follow-up sender
    __tests__/
      filing-confirmation.test.ts  # MODIFY: add tests for question emails + follow-ups
  intake/
    intake-worker.ts           # MODIFY: add reply detection before normal processing
    reply-parser.ts            # NEW: Gemini-powered reply parser
    __tests__/
      reply-parser.test.ts     # NEW: unit tests for reply parsing
      intake-worker.test.ts    # MODIFY: add reply detection tests
  matching/
    folder-search.ts           # MODIFY: return match list for multiple matches
    auto-create.ts             # MODIFY: pass match options through filing result
    __tests__/
      folder-search.test.ts    # MODIFY: test new return type
  classification/
    classification-worker.ts   # MODIFY: pass match candidates to filing confirmation
    filer.ts                   # MODIFY: add moveFile function
    __tests__/
      filer.test.ts            # MODIFY: test moveFile
```

### Pattern 1: Pending Choice State in Redis
**What:** Store the deferred filing context (match options, document info, message threading context) in Redis with 24h TTL when the confirmation email asks Cat a question.
**When to use:** Every time the system sends a multi-option confirmation email.
**Example:**
```typescript
// Key structure: same prefix pattern as filing-confirmation.ts
const PENDING_CHOICE_PREFIX = 'pending-choice:';
const PENDING_CHOICE_TTL = 86400; // 24 hours

interface PendingChoice {
  options: Array<{ folderId: string; folderName: string }>;
  documentInfo: {
    intakeDocumentId: string;
    originalFilename: string;
    docTypeLabel: string;
    driveFileId: string;        // File ID in Needs Review (for moving later)
    needsReviewFolderId: string; // Source folder (for removeParents)
  };
  contactId: string | null;
  threadContext: {
    gmailThreadId: string;
    gmailMessageRfc822Id: string | null;
    senderEmail: string;
    emailSubject: string;
  };
  createdAt: string;
}

// Store: keyed by threadId (Cat replies land in the same thread)
await redis.set(
  `${PENDING_CHOICE_PREFIX}${threadId}`,
  JSON.stringify(pendingChoice),
  'EX', PENDING_CHOICE_TTL,
);
```

**Key design decision -- use threadId as Redis key, not gmailMessageId.** When Cat replies, the reply arrives in the same Gmail thread. The intake worker already has `messageMeta.threadId` from `getMessageDetails()`. Using threadId as the key makes the reply-to-pending-choice lookup a single O(1) Redis GET. Using gmailMessageId would require storing a reverse mapping.

### Pattern 2: Reply Detection in Intake Worker
**What:** Before processing a Gmail message as a new document intake, check if it's a reply to a pending choice thread.
**When to use:** At the top of `processGmailSource()`, after the sender domain check and BCC detection, but before attachment extraction.
**Example:**
```typescript
// In intake-worker.ts processGmailSource():

// After sender domain check, after BCC check, BEFORE full message fetch:
// Check if this message is a reply to a pending filing choice
const pendingChoice = await getPendingChoice(messageMeta.threadId);
if (pendingChoice) {
  // This is a reply to a question we asked -- route to reply handler
  return handleFilingReply(messageMeta, pendingChoice);
}

// Normal processing continues...
```

**Why this position:** The intake worker already filters non-venturemortgages.com senders. Cat's replies come from admin@venturemortgages.com, so they pass the sender check. The reply intercept must happen before attachment extraction because replies typically have no attachments.

### Pattern 3: Gemini Structured Output for Reply Parsing
**What:** Parse Cat's natural language reply using the same Gemini 2.0 Flash pattern used in `body-extractor.ts`.
**When to use:** When a reply to a pending choice thread is detected.
**Example:**
```typescript
// Same pattern as body-extractor.ts parseForwardingNoteAI()
const replyParseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    selectedOption: {
      type: SchemaType.STRING,
      description: 'The folder name Cat selected, or "new" for create new, or "skip" to leave in Needs Review',
      nullable: true,
    },
    selectedIndex: {
      type: SchemaType.NUMBER,
      description: 'Zero-based index of the selected option from the list',
      nullable: true,
    },
    action: {
      type: SchemaType.STRING,
      enum: ['select', 'create_new', 'skip', 'unclear'],
      description: 'What Cat wants to do',
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: 'Confidence in the interpretation (0.0 to 1.0)',
    },
  },
  required: ['action', 'confidence'],
};
```

### Pattern 4: Drive File Move
**What:** Move a file from Needs Review to the chosen client folder using the Drive API `files.update` with `addParents`/`removeParents`.
**When to use:** After Cat's reply is parsed and the target folder is determined.
**Example:**
```typescript
// Source: Google Drive API v3 documentation
export async function moveFile(
  drive: DriveClient,
  fileId: string,
  fromFolderId: string,
  toFolderId: string,
): Promise<void> {
  await drive.files.update({
    fileId,
    addParents: toFolderId,
    removeParents: fromFolderId,
    fields: 'id, parents',
  });
}
```

### Anti-Patterns to Avoid
- **Storing PDF buffers in Redis:** Never store file content in Redis. The document is already in Drive (Needs Review folder). Store only the Drive file ID.
- **Blocking the intake worker on Gemini calls:** The reply parser is fast (text-only, no PDF), but still wrap in try/catch with timeout. If Gemini fails, leave the choice pending and Cat can reply again.
- **Using In-Reply-To header for reply detection:** Gmail may or may not preserve custom headers. Use threadId (always available from Gmail API) as the reliable correlation mechanism.
- **Creating a separate worker/queue for replies:** Unnecessary complexity. The intake worker already polls docs@ every 120s. Reply detection is a simple Redis lookup at the top of message processing. No new queue needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reply threading in Gmail | Custom Message-ID tracking | Gmail threadId (from API response) | Gmail groups messages by thread automatically; threadId is always available |
| Natural language parsing | Regex-based option matching | Gemini 2.0 Flash structured output | Cat might say "the first one", "wong ranasinghe", or "file it under srimal" -- NLP needed |
| State persistence | Custom file/database storage | Redis with TTL | Already used by filing-confirmation.ts; auto-expiry handles stale state |
| File moving in Drive | Download + re-upload | `files.update` with `addParents`/`removeParents` | Single API call, no data transfer, preserves file ID and permissions |
| Email composition/sending | Raw SMTP | `encodeMimeMessage()` + Gmail API | Already built and tested in Phase 25 |

**Key insight:** The codebase already has every building block needed. `filing-confirmation.ts` handles Redis state + threaded email sending. `body-extractor.ts` handles Gemini structured output for natural language. `folder-search.ts` does fuzzy matching. Phase 26 connects these patterns into a conversational flow.

## Common Pitfalls

### Pitfall 1: Gmail Threading Mismatch
**What goes wrong:** Reply emails don't land in the same thread as the question email, breaking threadId-based lookup.
**Why it happens:** Gmail uses subject line and In-Reply-To/References headers to group threads. If the reply's subject doesn't match or headers are stripped, Gmail creates a new thread.
**How to avoid:** Always include `In-Reply-To` and `References` headers when sending question emails (already done in `filing-confirmation.ts`). Use `Re: {original subject}` format. Send the question email with `threadId` set so Gmail groups them.
**Warning signs:** Redis lookup returns null for a reply that should match. Check if threadId of the reply matches the stored threadId.

### Pitfall 2: Reply Body Extraction
**What goes wrong:** Cat's reply includes the quoted original message, email signatures, and other noise. The AI parses the quoted text instead of Cat's actual reply.
**Why it happens:** Gmail includes the entire previous conversation below the reply line.
**How to avoid:** Strip quoted content before sending to Gemini. Look for standard Gmail quote markers: `On {date}, {sender} wrote:` or `>` prefix lines. Extract only the text above the first quote marker. The `body-extractor.ts` already has the `findPlainTextBody()` utility.
**Warning signs:** AI returns selections that match the question text rather than the reply.

### Pitfall 3: Stale Pending Choices After TTL Expiry
**What goes wrong:** Cat replies after 24 hours and the pending choice has expired from Redis. The system processes her reply as a normal intake message (no attachments = no-op).
**Why it happens:** 24h TTL is a reasonable default but Cat may be slow.
**How to avoid:** When the Redis lookup returns null for a reply-like message (same thread as a confirmation email), log a warning. The system gracefully degrades -- the doc stays in Needs Review and Cat files it manually.
**Warning signs:** Log messages showing "no pending choice found for threadId X" for messages from admin@venturemortgages.com with subjects starting with "Re: ".

### Pitfall 4: Race Condition with Multiple Attachments
**What goes wrong:** A single forwarded email has multiple ambiguous documents. Each triggers its own question email and pending choice. Cat replies once thinking she's answering all questions.
**Why it happens:** The current system processes attachments individually through the classification pipeline.
**How to avoid:** Key pending choices by threadId. When multiple ambiguous docs come from the same original email, they share the same threadId. Group them into a single question email. Cat's reply resolves all pending choices for that thread.
**Warning signs:** Multiple pending choice entries with the same threadId but different document info.

### Pitfall 5: Confirmation Email Arrives in Cat's Admin@ Inbox Not Docs@
**What goes wrong:** Cat sees the question email in the wrong inbox, or doesn't see it at all.
**Why it happens:** The confirmation email is sent from docs@ but Cat forwards from admin@. The in-thread reply appears in the docs@ sent folder, not admin@'s inbox.
**How to avoid:** Send the question email TO `admin@venturemortgages.com` (Cat's inbox) FROM `docs@`. The Phase 25 confirmation already does this correctly -- it sends `to: context.senderEmail` which is the person who forwarded the docs (Cat = admin@).
**Warning signs:** Cat reports not seeing question emails.

### Pitfall 6: Intake Worker Processes Reply as Normal Document
**What goes wrong:** A reply message passes through to the normal attachment extraction pipeline, finds no attachments, and returns `{ documentsProcessed: 0 }`. The reply is never handled.
**Why it happens:** The reply detection check is missing or has a bug, so the code falls through to normal processing.
**How to avoid:** Place the reply detection check early in `processGmailSource()`, after the sender domain check. The check is a fast Redis GET by threadId -- if it returns a pending choice, handle the reply and return immediately.
**Warning signs:** Filing choices never get executed despite Cat replying.

## Code Examples

### Example 1: Modified `searchExistingFolders` Return Type
```typescript
// Source: existing folder-search.ts, modified for Phase 26
export interface FolderSearchResult {
  match: { folderId: string; folderName: string } | null;
  allMatches: Array<{ folderId: string; folderName: string }>;
}

export async function searchExistingFolders(
  drive: DriveClient,
  clientName: string,
  rootFolderId: string,
): Promise<FolderSearchResult> {
  // ... existing Drive API search logic ...

  if (matches.length === 0) {
    return { match: null, allMatches: [] };
  }

  if (matches.length === 1) {
    const single = { folderId: matches[0].id!, folderName: matches[0].name! };
    return { match: single, allMatches: [single] };
  }

  // Multiple matches -- ambiguous, but now we RETURN them instead of null
  return {
    match: null,  // Still null (ambiguous), but allMatches populated
    allMatches: matches.map(m => ({ folderId: m.id!, folderName: m.name! })),
  };
}
```

### Example 2: Question Email Body Builder
```typescript
// Source: based on existing buildConfirmationBody in filing-confirmation.ts
export function buildQuestionBody(
  originalFilename: string,
  docTypeLabel: string,
  options: Array<{ folderName: string }>,
): string {
  const lines: string[] = [];

  lines.push(`I received "${originalFilename}" (${docTypeLabel}) but I'm not sure where to file it.`);
  lines.push('');
  lines.push('I found a couple of folders that might match:');
  lines.push('');

  for (let i = 0; i < options.length; i++) {
    lines.push(`  ${i + 1}. ${options[i].folderName}`);
  }

  lines.push('');
  lines.push('Which one should I use? You can reply with the number, the folder name,');
  lines.push('"create new folder", or "skip" to leave it in Needs Review.');

  return lines.join('\n');
}
```

### Example 3: Reply Text Extraction (strip quoted content)
```typescript
// Strip Gmail quoted content from reply
export function extractReplyText(fullBody: string): string {
  const lines = fullBody.split('\n');
  const replyLines: string[] = [];

  for (const line of lines) {
    // Stop at Gmail quote marker
    if (line.match(/^On .+ wrote:$/)) break;
    // Stop at ">" quoted lines
    if (line.startsWith('>')) break;
    // Stop at "--" signature delimiter
    if (line.trim() === '--') break;

    replyLines.push(line);
  }

  return replyLines.join('\n').trim();
}
```

### Example 4: Gemini Reply Parser Prompt
```typescript
const prompt = `You are parsing a reply from a mortgage broker's assistant who was asked to choose a filing folder for a document.

The options presented were:
${options.map((o, i) => `${i + 1}. ${o.folderName}`).join('\n')}

The assistant replied: "${replyText}"

Determine what the assistant wants:
- If they chose one of the listed options, set action to "select" and selectedIndex to the 0-based index
- If they want a new folder created, set action to "create_new"
- If they want to skip/leave in Needs Review, set action to "skip"
- If the reply is unclear or ambiguous, set action to "unclear"

Set confidence between 0.0 and 1.0. If you are uncertain, set it below 0.7.`;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Multiple folder matches return null (ambiguous) | Return null + match list (Phase 26) | Phase 26 | System can present options instead of silently routing to Needs Review |
| One-way confirmation emails | Two-way conversational emails (Phase 26) | Phase 26 | Cat can resolve ambiguous filings via email reply |
| Manual filing for ambiguous docs | AI-assisted filing via reply parsing (Phase 26) | Phase 26 | Saves Cat time on ambiguous cases |

**Unchanged patterns:**
- Gemini 2.0 Flash structured output (proven in classifier.ts, body-extractor.ts)
- Redis state management with TTL (proven in filing-confirmation.ts)
- Gmail threading via In-Reply-To/References headers (proven in filing-confirmation.ts)
- Intake worker message routing (proven since Phase 6)

## Open Questions

1. **How many ambiguous cases occur in practice?**
   - What we know: Phase 25 fuzzy search returns null for 2+ matches, routing to Needs Review. The frequency is unknown.
   - What's unclear: Whether this is a daily or weekly occurrence.
   - Recommendation: Add logging/metrics to track ambiguous match frequency. If rare, Phase 26 is a polish feature. If common, it has high ROI.

2. **Should replies from Taylor also be handled?**
   - What we know: The intake worker filters for `@venturemortgages.com` senders. Taylor also has this domain.
   - What's unclear: Whether Taylor would ever reply to filing questions.
   - Recommendation: Handle any `@venturemortgages.com` sender replying to a pending choice thread. No need to restrict to Cat only.

3. **Thread grouping for multi-document questions**
   - What we know: Multiple ambiguous docs from the same forwarded email share a threadId.
   - What's unclear: Whether to send one question email per doc or group all into one email.
   - Recommendation: Group into one email per thread. Simpler for Cat, one reply resolves all.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONV-01 | folder-search returns match list for 2+ matches | unit | `npx vitest run src/matching/__tests__/folder-search.test.ts -t "multiple matches"` | Modify existing |
| CONV-01 | Confirmation email presents options naturally | unit | `npx vitest run src/email/__tests__/filing-confirmation.test.ts -t "question"` | Modify existing |
| CONV-02 | Intake worker detects reply to pending choice | unit | `npx vitest run src/intake/__tests__/intake-worker.test.ts -t "pending choice"` | Modify existing |
| CONV-03 | Reply parser extracts correct selection | unit | `npx vitest run src/intake/__tests__/reply-parser.test.ts` | Wave 0 |
| CONV-03 | Reply text extraction strips quoted content | unit | `npx vitest run src/intake/__tests__/reply-parser.test.ts -t "strip"` | Wave 0 |
| CONV-04 | File moved from Needs Review to chosen folder | unit | `npx vitest run src/classification/__tests__/filer.test.ts -t "moveFile"` | Modify existing |
| CONV-04 | Follow-up confirmation sent in same thread | unit | `npx vitest run src/email/__tests__/filing-confirmation.test.ts -t "follow-up"` | Modify existing |
| CONV-04 | Expired pending choice handled gracefully | unit | `npx vitest run src/intake/__tests__/reply-parser.test.ts -t "expired"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/intake/reply-parser.ts` -- new module, needs test file
- [ ] `src/intake/__tests__/reply-parser.test.ts` -- covers CONV-03, CONV-04 edge cases

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `src/email/filing-confirmation.ts` -- Redis state + threaded email pattern
- Codebase inspection: `src/intake/body-extractor.ts` -- Gemini 2.0 Flash structured output pattern
- Codebase inspection: `src/matching/folder-search.ts` -- current fuzzy search behavior (returns null for 2+ matches)
- Codebase inspection: `src/classification/classification-worker.ts` -- full filing pipeline with match outcomes
- Codebase inspection: `src/intake/intake-worker.ts` -- Gmail message processing flow and reply insertion point
- Codebase inspection: `src/email/gmail-client.ts` -- compose client for sending from docs@
- Codebase inspection: `src/email/mime.ts` -- MIME encoding with In-Reply-To/References threading
- [Google Drive API v3 files.update documentation](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) -- addParents/removeParents for file moves
- [Google Drive folder management guide](https://developers.google.com/workspace/drive/api/guides/folder) -- file move API usage

### Secondary (MEDIUM confidence)
- Phase 26 CONTEXT.md -- locked decisions from user discussion

### Tertiary (LOW confidence)
- None -- all findings verified against codebase or official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- 100% existing dependencies, no new libraries needed
- Architecture: HIGH -- follows exact same patterns already proven in Phase 25 (Redis state, Gemini structured output, Gmail threading)
- Pitfalls: HIGH -- identified from direct codebase analysis and Gmail API behavior
- Reply detection: HIGH -- Gmail threadId is the reliable correlation mechanism, already used by existing code

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable -- no fast-moving dependencies)
