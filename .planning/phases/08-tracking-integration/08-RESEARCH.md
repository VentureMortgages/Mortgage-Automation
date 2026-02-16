# Phase 8: Tracking Integration - Research

**Researched:** 2026-02-15
**Domain:** CRM custom field update orchestration, audit trail via contact notes, BullMQ event-driven patterns, GoHighLevel API v2 (contacts, notes, custom fields)
**Confidence:** HIGH

## Summary

Phase 8 closes the loop between document receipt (Phase 7) and CRM status tracking (Phase 4). When the classification worker files a document to Google Drive, Phase 8 updates the contact's custom fields in MyBrokerPro to move that document from "missing" to "received," adjusts aggregate counters (preDocsReceived, fullDocsReceived), recomputes the overall doc status label, and writes an audit note to the contact record. When all PRE documents are received, the system creates a task for Taylor (budget call readiness). When all documents are received, the pipeline stage advances to "All Docs Received."

The existing codebase already contains nearly all the building blocks needed. Phase 4 created the custom field schema (9 fields including missingDocs/receivedDocs JSON arrays, PRE/FULL counters, docStatus picklist), the `computeDocStatus()` function in `checklist-mapper.ts`, the `moveToAllDocsReceived()` function in `opportunities.ts`, and the `createPreReadinessTask()` function in `tasks.ts`. The classification worker (`classification-worker.ts`) returns a `ClassificationJobResult` containing `classification.documentType` and `filed: true/false`. The primary technical question is WHERE and HOW to hook in the CRM update after the classification worker completes.

**Primary recommendation:** Add the tracking update logic directly at the end of `processClassificationJob()` in `classification-worker.ts` (after successful filing), calling a new `updateDocTracking()` orchestrator in `src/crm/tracking-sync.ts`. This avoids adding a new queue or event listener while keeping the CRM update logic cleanly separated from classification. The audit trail should use GHL's Contact Notes API (POST `/contacts/:contactId/notes`) rather than custom fields or logging, since notes are visible in the CRM UI timeline and provide a native audit experience for Cat.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (existing) GoHighLevel REST API v2 | 2021-07-28 | Contact update, note creation | Already used via `crmFetch` in contacts.ts, tasks.ts; same pattern extends to notes and field updates |
| (existing) BullMQ | ^5.69.1 | Classification queue where tracking hook lives | Already processing classification jobs; tracking is added to the same worker processor |
| (existing) `vitest` | ^4.0.18 | Testing with mocked CRM calls | Already established testing patterns with vi.mock in all CRM/classification tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (existing) `dotenv` | ^17.3.1 | Environment variable loading | Already loads all CRM config |
| (existing) `zod` | ^4.3.6 | Optional: validate GHL API responses | If we want runtime validation on contact GET response |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline in classification worker | Separate BullMQ tracking queue | A separate queue adds complexity (new queue, new worker, new Redis connection) for minimal benefit. The tracking update is 2-3 API calls and takes <500ms. BullMQ flows/parent-child pattern could work but is over-engineered for this use case. |
| Inline in classification worker | QueueEvents listener on classification queue | QueueEvents only receives jobId, not job result data. Would need to fetch the completed job to get the classification result, adding unnecessary Redis lookups. |
| Contact Notes for audit | Custom LARGE_TEXT audit log field | Notes are visible in the CRM UI timeline alongside emails and tasks. A custom field would be a JSON blob that's harder to read and has size limits. Notes are the native GHL pattern for activity history. |
| Contact Notes for audit | External audit log (file/database) | Cat needs to see audit info IN the CRM, not in a separate system. Notes satisfy TRACK-02 and are visible where Cat already works. |
| Read-modify-write for counters | Blind increment | GHL API doesn't support atomic increment. Must read current values, compute new values, then write. This creates a race condition window but is acceptable at our volume (<10 docs/day). |

**Installation:**
```bash
# No new dependencies needed. All libraries already installed.
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── crm/                          # EXISTING — extend with tracking modules
│   ├── tracking-sync.ts          # NEW: orchestrator for doc-received CRM updates
│   ├── notes.ts                  # NEW: contact notes API (create note for audit trail)
│   ├── contacts.ts               # EXISTING: add getContact() to read current custom field values
│   ├── checklist-mapper.ts       # EXISTING: computeDocStatus() already built for Phase 8
│   ├── tasks.ts                  # EXISTING: createPreReadinessTask() already built for Phase 8
│   ├── opportunities.ts          # EXISTING: moveToAllDocsReceived() already built for Phase 8
│   ├── index.ts                  # UPDATE: export new modules
│   └── __tests__/
│       ├── tracking-sync.test.ts # NEW: tests for tracking orchestrator
│       └── notes.test.ts         # NEW: tests for contact notes
├── classification/
│   └── classification-worker.ts  # UPDATE: call updateDocTracking() after successful filing
└── ...existing modules...
```

### Pattern 1: Tracking Update After Successful Filing (Integration Point)
**What:** After the classification worker successfully files a document to Drive (filed=true), it calls the tracking sync orchestrator to update CRM status.
**When to use:** Every time a document is classified AND filed successfully.
**Example:**
```typescript
// In classification-worker.ts, after successful filing (step k)
// Source: Existing codebase pattern (same as how createReviewTask is called in worker)

import { updateDocTracking } from '../crm/tracking-sync.js';

// After filing succeeds...
if (filed && classification && senderEmail) {
  try {
    await updateDocTracking({
      senderEmail,
      documentType: classification.documentType,
      driveFileId,
      source,
      receivedAt: job.data.receivedAt,
    });
  } catch (trackingErr) {
    // Tracking failure is NON-FATAL — doc is already filed to Drive
    console.error('[classification] Tracking update failed:', {
      error: trackingErr instanceof Error ? trackingErr.message : String(trackingErr),
      intakeDocumentId,
    });
  }
}
```

### Pattern 2: Read-Modify-Write for Custom Field Counters
**What:** Read the contact's current custom field values, compute new values (move doc from missing to received, increment counter, recompute status), then write updated fields back.
**When to use:** Every tracking update. Required because GHL has no atomic increment operation.
**Example:**
```typescript
// In tracking-sync.ts
// Source: Extends existing mapChecklistToFields pattern in checklist-mapper.ts

async function updateDocTracking(input: TrackingUpdateInput): Promise<TrackingUpdateResult> {
  // 1. Find contact by email
  const contactId = await findContactByEmail(input.senderEmail);
  if (!contactId) return { updated: false, reason: 'no-contact' };

  // 2. GET contact to read current custom field values
  const contact = await getContact(contactId);
  const currentFields = parseContactFields(contact);

  // 3. Compute updates: move doc from missing to received
  const docName = DOC_TYPE_LABELS[input.documentType] ?? input.documentType;
  const missingDocs = currentFields.missingDocs.filter(d => d !== docName);
  const receivedDocs = [...currentFields.receivedDocs, docName];

  // 4. Determine stage and increment correct counter
  const stage = getDocStage(input.documentType, currentFields.missingDocs);
  const preReceived = stage === 'PRE' ? currentFields.preReceived + 1 : currentFields.preReceived;
  const fullReceived = stage === 'FULL' ? currentFields.fullReceived + 1 : currentFields.fullReceived;

  // 5. Compute new status using existing pure function
  const newStatus = computeDocStatus(currentFields.preTotal, preReceived, currentFields.fullTotal, fullReceived);

  // 6. Write updated fields to contact
  await updateContactFields(contactId, [
    { id: fieldIds.missingDocs, field_value: JSON.stringify(missingDocs) },
    { id: fieldIds.receivedDocs, field_value: JSON.stringify(receivedDocs) },
    { id: fieldIds.preDocsReceived, field_value: preReceived },
    { id: fieldIds.fullDocsReceived, field_value: fullReceived },
    { id: fieldIds.docStatus, field_value: newStatus },
    { id: fieldIds.lastDocReceived, field_value: new Date().toISOString().split('T')[0] },
  ]);

  // 7. Write audit note
  await createAuditNote(contactId, {
    documentType: docName,
    source: input.source,
    driveFileId: input.driveFileId,
  });

  // 8. Trigger milestone actions
  if (newStatus === 'PRE Complete') {
    await createPreReadinessTask(contactId, contact.firstName + ' ' + contact.lastName);
  }
  if (newStatus === 'All Complete') {
    await moveToAllDocsReceived(contactId, contact.firstName + ' ' + contact.lastName);
  }

  return { updated: true, newStatus, contactId };
}
```

### Pattern 3: Contact Notes as Audit Trail (TRACK-02)
**What:** Create a contact note for every document received, providing a timestamped audit trail visible in the CRM UI.
**When to use:** After every successful tracking update.
**Example:**
```typescript
// In notes.ts
// Source: GHL API v2 — POST /contacts/:contactId/notes

export async function createAuditNote(
  contactId: string,
  data: { documentType: string; source: string; driveFileId: string },
): Promise<string> {
  const noteBody = [
    `Document received: ${data.documentType}`,
    `Source: ${data.source}`,
    `Filed to Drive: ${data.driveFileId}`,
    `Received: ${new Date().toISOString()}`,
    `[Automated by Venture Mortgages Doc System]`,
  ].join('\n');

  const response = await noteFetch(`/contacts/${contactId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body: noteBody }),
  });

  const result = (await response.json()) as { note: { id: string } };
  return result.note.id;
}
```

### Pattern 4: Get Contact with Custom Fields
**What:** Retrieve a contact's full record including custom field current values.
**When to use:** Before every tracking update (read-modify-write cycle).
**Example:**
```typescript
// In contacts.ts (add to existing module)
// Source: GHL API v2 — GET /contacts/:contactId

export async function getContact(contactId: string): Promise<CrmContact> {
  const response = await crmFetch(`/contacts/${contactId}`, { method: 'GET' });
  const data = (await response.json()) as { contact: CrmContact };
  return data.contact;
}

// CRM contact shape (add to types/index.ts)
export interface CrmContact {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  customFields: Array<{ id: string; value: unknown }>;
}
```

### Anti-Patterns to Avoid
- **Blind writes without reading first:** Writing `preDocsReceived = 1` without reading the current value would overwrite previous tracking state. Always read-then-write.
- **Storing audit data in custom fields:** Custom fields have size limits and are not designed for append-only logs. Notes are the correct GHL primitive for timestamped activity records.
- **Making tracking failures fatal to the classification pipeline:** A CRM update failure should NEVER cause a retry of the entire classification + Drive filing pipeline. Wrap in try/catch and log.
- **Creating a separate tracking queue:** Over-engineering for this volume. The CRM update is 3-4 fast API calls. Adding queue infrastructure means more Redis connections, more worker lifecycle management, and more failure modes for minimal benefit.
- **Matching document types by string comparison alone:** The classifier returns `DocumentType` enum values (e.g., `t4`, `pay_stub`), but the CRM stores human-readable `document` names from `ChecklistItem` (e.g., `"T4 (Current Year)"`, `"Recent paystub (within 30 days)"`). The matching function needs to be fuzzy or use a mapping table from `DocumentType` to possible checklist document names.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Document status computation | Custom if/else chains for status | `computeDocStatus()` in `checklist-mapper.ts` | Already built, tested, and matches CRM picklist values exactly |
| Pipeline stage transitions | Direct API calls in tracking code | `moveToAllDocsReceived()` in `opportunities.ts` | Already built with proper error handling and dev prefix |
| PRE readiness notification | Custom notification logic | `createPreReadinessTask()` in `tasks.ts` | Already built, assigns to Taylor, sets due date |
| Document type labels | Hardcoded label map | `DOC_TYPE_LABELS` in `classification/types.ts` | Already maps all 30+ document types to human-readable labels |
| HTTP error classification | Generic try/catch | `CrmApiError` / `CrmRateLimitError` / `CrmAuthError` | Already built in `crm/errors.ts`, used by all CRM modules |

**Key insight:** Phase 4 was deliberately designed to prepare for Phase 8. The functions `computeDocStatus()`, `moveToAllDocsReceived()`, and `createPreReadinessTask()` all have JSDoc comments explicitly referencing Phase 8 as their consumer. The custom field schema (missingDocs/receivedDocs JSON arrays, counter fields) was designed for this read-modify-write update pattern.

## Common Pitfalls

### Pitfall 1: Document Type Mismatch Between Classifier and Checklist
**What goes wrong:** The classifier returns `DocumentType` values like `t4`, `pay_stub`, `loe`. The checklist stores `document` field names like `"T4 (Current Year)"`, `"Recent paystub (within 30 days)"`, `"Letter of Employment"`. A naive string match would never find the document in the missing list.
**Why it happens:** Two different systems (classifier types in Phase 7, checklist rules in Phase 3) use different naming schemes for the same concept.
**How to avoid:** Build a mapping function that converts a `DocumentType` enum value to a list of possible checklist document names it could match. Use the existing `DOC_TYPE_LABELS` as a starting point, but also check partial/fuzzy matches against the missingDocs array. The matching should be case-insensitive and should check if the checklist document name STARTS WITH or CONTAINS the doc type label.
**Warning signs:** Documents getting filed to Drive but CRM status never updating. The missingDocs list stays unchanged.

### Pitfall 2: Race Condition on Read-Modify-Write
**What goes wrong:** Two documents for the same client arrive simultaneously. Both read `preDocsReceived = 2`, both increment to 3, both write 3. Result: one document's tracking is lost.
**Why it happens:** GHL API has no atomic increment operation. The read-modify-write cycle is not transactional.
**How to avoid:** At current volume (<10 documents/day, classification worker concurrency=1, BullMQ processes sequentially), this is extremely unlikely. The single-concurrency BullMQ worker is the primary guard. If volume increases in the future, add a Redis-based per-contact lock (e.g., `SETNX tracking:lock:${contactId}` with TTL). For now, document the risk and move on.
**Warning signs:** Counter values that don't match the actual number of received documents. Usually only visible if concurrency is increased.

### Pitfall 3: Stale Missing Docs List After Checklist Re-generation
**What goes wrong:** Taylor re-runs a Finmo application (e.g., co-borrower added), regenerating the checklist. The missingDocs list is reset to the new full list. Previous tracking state (documents already received) is lost.
**Why it happens:** `syncChecklistToCrm()` in `checklist-sync.ts` always writes `receivedDocs: '[]'` and `preDocsReceived: 0`.
**How to avoid:** This is an edge case for Phase 8 scope. For now, document it as a known limitation. A future enhancement could preserve previously-received documents by cross-referencing the new checklist against the existing receivedDocs list. The current design is acceptable because checklist re-generation is rare and Cat would notice the reset.
**Warning signs:** Contact custom fields showing zero received docs when Cat knows documents were already filed.

### Pitfall 4: Note Spam in CRM
**What goes wrong:** If the same document is re-uploaded (version update per FILE-04), a new audit note is created each time, cluttering the contact timeline.
**Why it happens:** The tracking sync runs on every successful filing, including updates to existing files.
**How to avoid:** Check if the document type is already in the receivedDocs list before creating a new note. If it's an update (already received), create a shorter "updated" note or skip the note entirely. Only decrement/increment counters on truly NEW documents.
**Warning signs:** Multiple notes for the same document type on a contact, or receivedDocs count exceeding totalDocs.

### Pitfall 5: Missing Contact (No CRM Record for Sender)
**What goes wrong:** A document arrives from an email address that doesn't match any CRM contact. The tracking update silently fails.
**Why it happens:** The document sender email doesn't match the borrower email stored in the CRM (e.g., spouse sends from different email, employer sends LOE from company email).
**How to avoid:** The tracking sync should gracefully handle "no contact found" as a non-error case. Log it for visibility. In the future, a manual mapping UI could let Cat link email addresses to contacts. For now, documents are still filed to Drive (Phase 7 uses the root folder fallback), just not tracked in the CRM.
**Warning signs:** Documents appearing in Drive but not reflected in CRM tracking status.

## Code Examples

Verified patterns from existing codebase (HIGH confidence):

### Existing computeDocStatus (Already Built for Phase 8)
```typescript
// Source: src/crm/checklist-mapper.ts lines 116-126
export function computeDocStatus(
  preTotal: number,
  preReceived: number,
  fullTotal: number,
  fullReceived: number,
): string {
  if (preReceived >= preTotal && fullReceived >= fullTotal) return 'All Complete';
  if (preReceived >= preTotal) return 'PRE Complete';
  if (preReceived > 0 || fullReceived > 0) return 'In Progress';
  return 'Not Started';
}
```

### Existing moveToAllDocsReceived (Already Built for Phase 8)
```typescript
// Source: src/crm/opportunities.ts lines 83-96
export async function moveToAllDocsReceived(
  contactId: string,
  borrowerName: string,
): Promise<string> {
  return upsertOpportunity({
    contactId,
    pipelineId: PIPELINE_IDS.LIVE_DEALS,
    stageId: crmConfig.stageIds.allDocsReceived,
    name: devPrefix(`${borrowerName} — Doc Collection`),
  });
}
```

### Existing createPreReadinessTask (Already Built for Phase 8)
```typescript
// Source: src/crm/tasks.ts lines 66-86
export async function createPreReadinessTask(
  contactId: string,
  borrowerName: string,
): Promise<string> {
  const body = {
    title: devPrefix(`PRE docs complete — ${borrowerName}`),
    body: 'All PRE-approval documents have been received. Client is ready for budget call.',
    assignedTo: crmConfig.userIds.taylor,
    dueDate: addBusinessDays(new Date(), 1).toISOString(),
    completed: false,
  };
  const response = await taskFetch(`/contacts/${contactId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as { task: { id: string } };
  return data.task.id;
}
```

### Existing CRM HTTP Pattern (Reuse for Notes)
```typescript
// Source: Pattern from src/crm/contacts.ts and tasks.ts
// All CRM modules use the same authenticated fetch helper with error classification.
// notes.ts should follow the identical pattern.

async function noteFetch(path: string, init: RequestInit): Promise<Response> {
  const url = `${crmConfig.baseUrl}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${crmConfig.apiKey}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    // ... same error classification as contacts.ts
  }
  return response;
}
```

### Classification Worker Integration Point
```typescript
// Source: src/classification/classification-worker.ts line 225 (return block)
// The tracking hook goes right before the return statement at line 225.
// The worker already has the classification result, driveFileId, and senderEmail.

// Current code (line 225):
return {
  intakeDocumentId,
  classification,
  filed: true,
  driveFileId,
  manualReview: false,
  error: null,
};

// Phase 8 adds tracking call BEFORE this return:
// try { await updateDocTracking({ ... }); } catch { /* non-fatal */ }
```

### Document Type to Checklist Name Matching
```typescript
// The key matching challenge: classifier returns 'pay_stub',
// but missingDocs contains "Recent paystub (within 30 days)".
// DOC_TYPE_LABELS maps 'pay_stub' -> 'Pay Stub'.
// Matching function needs to find 'pay_stub' match in missingDocs.

// Source: src/classification/types.ts (DOC_TYPE_LABELS)
// Strategy: For each doc in missingDocs, check if it starts with or
// contains the DOC_TYPE_LABEL for the classified documentType.
// Handle case-insensitivity and common abbreviations.

function findMatchingChecklistDoc(
  documentType: DocumentType,
  missingDocs: string[],
): string | null {
  const label = DOC_TYPE_LABELS[documentType];
  if (!label) return null;

  const labelLower = label.toLowerCase();

  // Exact start-of-string match (most common case)
  const match = missingDocs.find(doc =>
    doc.toLowerCase().startsWith(labelLower)
  );

  return match ?? null;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Poll CRM for changes | Event-driven update after classification | Current design | No polling needed; tracking update is immediate after filing |
| Separate tracking queue | Inline tracking in classification worker | Current design decision | Simpler architecture, fewer failure modes |
| Custom audit log field | GHL Contact Notes API | Current design decision | Native CRM UX, visible in timeline, no size limits |
| GHL API v1 contacts | GHL API v2 contacts (search/upsert) | V1 EOL | Project already uses v2 exclusively |

**Deprecated/outdated:**
- GHL API v1: End of life. All code uses v2. No changes needed.
- `GET /contacts/` endpoint: Deprecated by GHL. Use `POST /contacts/search` or `GET /contacts/:contactId` instead. The existing `findContactByEmail()` already uses the search endpoint.

## Open Questions

1. **GHL Contact GET response shape for customFields**
   - What we know: The GHL API v2 GET `/contacts/:contactId` endpoint returns contact data. Custom fields are included in the response. The field values are stored as `{ id: string; value: unknown }` arrays based on the upsert pattern used in Phase 4.
   - What's unclear: The exact key names in the GET response (`value` vs `field_value`, nested structure). The existing codebase only writes to contacts (upsert), never reads custom field values back.
   - Recommendation: Write a small test script (`src/crm/setup/test-get-contact.ts`) early in implementation that GETs a test contact and logs the response shape. This should be the FIRST task in the phase plan. LOW risk since the API endpoint is well-documented and we already have auth working.

2. **Document type matching accuracy**
   - What we know: DOC_TYPE_LABELS provides a mapping from DocumentType enum to human-readable labels. Checklist document names use these labels as prefixes (e.g., "T4" -> "T4 (Current Year)").
   - What's unclear: Whether ALL checklist document names start with the DOC_TYPE_LABEL. Some might use different naming (e.g., "Letter of Employment" vs DOC_TYPE_LABELS['loe'] = 'LOE').
   - Recommendation: Write a comprehensive mapping test that runs all fixture checklists through the matching function to verify coverage. Build a fallback map for known mismatches.

3. **Whether to handle document STAGE tracking (PRE vs FULL)**
   - What we know: The checklist items have a `stage` field (PRE/FULL/LATER/CONDITIONAL). The CRM tracks PRE and FULL counters separately. The classifier returns `documentType` but NOT `stage`.
   - What's unclear: How to determine if a received document is PRE or FULL without the original checklist context.
   - Recommendation: When reading the contact's missingDocs, we don't have stage info. Instead, we need the ORIGINAL checklist to determine stage. Two options: (a) store the checklist in a lightweight lookup structure (Redis key or CRM custom field), or (b) infer from the document type's position in the missingDocs array (less reliable). The simplest approach: when a document name is found in missingDocs, look it up in the ORIGINAL checklist (regenerate from Finmo data? or cache?). Alternatively, maintain a separate `missingPreDocs` and `missingFullDocs` field in the CRM, which avoids needing the original checklist. This is the MOST IMPORTANT open question for the planner.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/crm/checklist-mapper.ts` - computeDocStatus, mapChecklistToFields already designed for Phase 8
- Existing codebase: `src/crm/opportunities.ts` - moveToAllDocsReceived already built with JSDoc referencing Phase 8
- Existing codebase: `src/crm/tasks.ts` - createPreReadinessTask already built for Phase 8
- Existing codebase: `src/classification/classification-worker.ts` - TODO comments on lines 122, 131 explicitly reference Phase 8
- Existing codebase: `src/crm/types/index.ts` - DOC_TRACKING_FIELD_DEFS defines all 9 custom fields
- Existing codebase: `src/classification/types.ts` - DOC_TYPE_LABELS maps all document types to labels
- [BullMQ Events Documentation](https://docs.bullmq.io/guide/events) - Worker completed event pattern
- [BullMQ Flows Documentation](https://docs.bullmq.io/guide/flows) - Parent-child job pattern (considered but rejected)

### Secondary (MEDIUM confidence)
- [GoHighLevel API v2 Update Contact](https://marketplace.gohighlevel.com/docs/ghl/contacts/update-contact/index.html) - PUT /contacts/:contactId with customFields
- [GoHighLevel API v2 Create Note](https://marketplace.gohighlevel.com/docs/ghl/contacts/create-note/index.html) - POST /contacts/:contactId/notes
- [GoHighLevel API v2 Get Contact](https://marketplace.gohighlevel.com/docs/ghl/contacts/get-contact/index.html) - GET /contacts/:contactId (need to verify customField response shape)
- [GoHighLevel Custom Fields v2 API](https://marketplace.gohighlevel.com/docs/ghl/custom-fields/custom-fields-v-2-api/index.html) - Custom field types and management
- [GoHighLevel API Documentation Portal](https://marketplace.gohighlevel.com/docs/) - Main developer portal

### Tertiary (LOW confidence)
- GHL contact GET response customField format: Based on community patterns and API consistency, expected to be `{ id: string; value: unknown }[]` but needs validation with actual API call (see Open Question 1)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies. All libraries already installed and used. CRM helper functions already built.
- Architecture: HIGH - Pattern is straightforward (add tracking call to existing worker). Integration point is clearly identified with TODO comments in the code. The read-modify-write pattern is well-understood.
- Pitfalls: HIGH - Major pitfalls (type mismatch, race condition, stale state) identified from codebase analysis. Mitigations are practical and proportionate to risk.
- Open questions: MEDIUM - The document type matching and stage tracking questions need resolution during planning. The GHL response shape question is low-risk (quick API call validates it).

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (stable domain, no fast-moving dependencies)
