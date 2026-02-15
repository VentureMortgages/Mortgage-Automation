# Phase 7: Classification & Filing - Research

**Researched:** 2026-02-15
**Domain:** Document classification (AI/LLM), Google Drive API (file management), Finmo document download API, file naming/routing logic
**Confidence:** MEDIUM-HIGH

## Summary

Phase 7 receives `IntakeDocument` objects from Phase 6's intake pipeline and processes them through three stages: (1) AI-based document classification using the Claude API, (2) automated file naming using Cat's conventions, and (3) filing to the correct Google Drive folder/subfolder. Additionally, this phase implements the previously-stubbed Finmo document download (`processFinmoSource` in `intake-worker.ts`) using confirmed Finmo API endpoints.

The classification engine uses the Anthropic Claude API to analyze PDF content and return structured classification results (document type, borrower attribution, year/amount metadata, confidence score). Claude supports native PDF analysis via base64-encoded `document` content blocks, with each page costing 1,500-3,000 tokens. The structured output feature (`output_config.format` with `json_schema`) guarantees valid JSON matching a defined schema, eliminating the need for JSON parsing error handling. Claude Haiku 4.5 is the recommended model for classification -- fast, cheap, and sufficient for document type identification.

Google Drive integration uses the existing `googleapis` package (already in `package.json` at ^171.4.0) with the Drive API v3. The same service account authentication pattern from `gmail-client.ts` is reused with the `https://www.googleapis.com/auth/drive` scope. Key operations: search folders by name + parent, create folders, upload files with metadata (name, parent, MIME type), and update/replace existing files.

The filing logic maps classified document types to Cat's subfolder structure (person subfolders for income/ID docs, `Subject Property/` for property docs, etc.) and applies Cat's naming convention: `FirstName - DocType [Year] [Amount].pdf`. Client-to-folder matching uses the CRM contact record which should store the Google Drive folder ID (set during folder creation or first filing).

**Primary recommendation:** Use Claude Haiku 4.5 via `@anthropic-ai/sdk` for document classification with structured output (`output_config.format`), `googleapis` Drive v3 for file operations, and a new `src/classification/` module that consumes IntakeDocuments from a BullMQ classification queue.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | latest | Claude API client for document classification | Official Anthropic TypeScript SDK; typed request/response, streaming, PDF document support, structured output helpers |
| `googleapis` | ^171.4.0 | Google Drive API v3 for folder search, file upload, file update | Already in project; provides `google.drive({ version: 'v3' })` with typed methods |
| `google-auth-library` | ^10.5.0 | Service account JWT authentication for Drive API | Already in project; reuse same auth pattern as `gmail-client.ts` |
| `bullmq` | ^5.69.1 | Classification queue (IntakeDocument -> classification worker) | Already in project; same queue/worker pattern as Phases 1 and 6 |
| `zod` | latest | Schema definition for classification output + runtime validation | Used with `@anthropic-ai/sdk` helper `zodOutputFormat` for structured output; also validates classification results before filing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^4.0.18 | Unit/integration testing | Already in project; test classifier, filer, naming logic |
| `pdf-lib` | ^1.17.1 | Already in project | May be needed for extracting page count metadata before classification |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Claude Haiku 4.5 | Claude Sonnet 4.5 | Sonnet is more accurate but 3-5x more expensive. Haiku is fast and cheap ($0.25/$1.25 per MTok), and mortgage docs have strong visual/textual cues (T4, LOE headers, CRA letterhead) that don't need a large model. Sonnet could be a fallback for low-confidence results. |
| Claude Haiku 4.5 | OpenAI GPT-4o-mini | GPT-4o-mini is comparable for classification, but the project has no OpenAI integration. Adding a second AI provider increases complexity. Claude is already the project's AI. |
| `output_config.format` (structured output) | Tool use with `tool_choice` | Structured output via `output_config.format` is the modern approach (GA since late 2025). It uses constrained decoding to guarantee schema-valid JSON. Tool use approach works but is more verbose and was the workaround before structured outputs existed. |
| `@anthropic-ai/sdk` | Direct HTTP fetch to Claude API | SDK provides typed responses, streaming, retry logic, and structured output helpers. Hand-rolling HTTP calls gains nothing. |
| Single classification call | Two-pass (classify then extract metadata) | Single call with a comprehensive schema is cheaper and faster. Mortgage docs rarely need multi-pass analysis. |
| Store Drive folder ID in CRM | Search Drive by folder name each time | Searching by name is brittle (naming inconsistencies, multiple matches for repeat clients). Storing the folder ID in a CRM custom field is reliable and avoids API calls. |

**Installation:**
```bash
npm install @anthropic-ai/sdk zod
```

Note: `googleapis`, `google-auth-library`, `bullmq`, and `pdf-lib` are already installed.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── classification/              # Phase 7 (new)
│   ├── types.ts                 # ClassificationResult, FilingDecision, DriveFileInfo types
│   ├── config.ts                # Classification config: model, confidence threshold, Drive folder IDs
│   ├── classifier.ts            # Claude API classification (PDF -> structured result)
│   ├── naming.ts                # File naming logic (Cat's convention: "Name - DocType Year Amount.pdf")
│   ├── filer.ts                 # Google Drive operations (search, create folder, upload, update)
│   ├── drive-client.ts          # Google Drive API client (lazy singleton, same pattern as gmail-client.ts)
│   ├── router.ts                # Routes classified doc to correct subfolder based on type
│   ├── classification-worker.ts # BullMQ worker: classify -> name -> file -> update CRM
│   ├── index.ts                 # Barrel export
│   └── __tests__/
│       ├── classifier.test.ts
│       ├── naming.test.ts
│       ├── router.test.ts
│       └── filer.test.ts
├── intake/
│   └── intake-worker.ts         # UPDATE: enqueue to classification queue instead of logging
│   └── finmo-downloader.ts      # NEW: Finmo document download implementation
├── ...existing modules...
```

### Pattern 1: Claude Structured Document Classification
**What:** Send a PDF to Claude with a classification prompt and a JSON schema. Claude returns a structured classification result with document type, confidence, borrower name, year, and amount.
**When to use:** For every IntakeDocument that enters the classification queue.
**Example:**
```typescript
// Source: Anthropic API docs (https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const ClassificationSchema = z.object({
  documentType: z.string().describe('The document type identifier, e.g., "t4", "pay_stub", "noa", "loe", "photo_id", "void_cheque"'),
  confidence: z.number().describe('Confidence score 0.0-1.0'),
  borrowerFirstName: z.string().nullable().describe('First name of the person this doc belongs to, or null if shared/unknown'),
  borrowerLastName: z.string().nullable().describe('Last name, or null'),
  taxYear: z.number().nullable().describe('Tax year if applicable (e.g., 2024 for a 2024 T4)'),
  amount: z.string().nullable().describe('Dollar amount if visible (e.g., "$45k", "$125,000")'),
  institution: z.string().nullable().describe('Financial institution or employer name if visible'),
  additionalNotes: z.string().nullable().describe('Any other relevant metadata'),
});

const client = new Anthropic();

async function classifyDocument(pdfBuffer: Buffer): Promise<z.infer<typeof ClassificationSchema>> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20241022',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: pdfBuffer.toString('base64'),
          },
        },
        {
          type: 'text',
          text: `Classify this Canadian mortgage document. Identify the document type, who it belongs to, and extract key metadata.

Common document types: photo_id, t4, t4a, noa, t1, loe (letter of employment), pay_stub, employment_contract, void_cheque, bank_statement, mortgage_statement, property_tax_bill, mls_listing, purchase_agreement, lease_agreement, articles_of_incorporation, financial_statement, pension_letter, separation_agreement, pr_card, passport, gift_letter, rrsp_statement, tfsa_statement, fhsa_statement, t5, t2, cra_statement_of_account, other.

If you cannot confidently classify the document, set confidence below 0.7.`,
        },
      ],
    }],
    output_config: { format: zodOutputFormat(ClassificationSchema) },
  });

  return JSON.parse(response.content[0].text);
}
```

### Pattern 2: Google Drive Client (Service Account, Lazy Singleton)
**What:** Create a Google Drive API v3 client using the same service account pattern as `gmail-client.ts`. The service account with domain-wide delegation impersonates a user in the workspace domain.
**When to use:** All Google Drive operations (search, create, upload, update).
**Example:**
```typescript
// Source: Google Drive API docs + existing gmail-client.ts pattern
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

type DriveClient = ReturnType<typeof google.drive>;

let _driveClient: DriveClient | null = null;

export function getDriveClient(): DriveClient {
  if (_driveClient) return _driveClient;

  const key = loadServiceAccountKey(); // reuse from gmail-client.ts
  const auth = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: 'admin@venturemortgages.com', // impersonate admin user
  });

  _driveClient = google.drive({ version: 'v3', auth });
  return _driveClient;
}
```

### Pattern 3: Folder Search and Creation
**What:** Find an existing folder by name within a parent, or create one if it doesn't exist. Uses Drive API `files.list` with query parameter.
**When to use:** When filing a document and the person subfolder or client folder needs to be located/created.
**Example:**
```typescript
// Source: Google Drive API docs (https://developers.google.com/drive/api/guides/folder)
async function findOrCreateFolder(
  drive: DriveClient,
  name: string,
  parentId: string,
): Promise<string> {
  // Search for existing folder
  const query = `name = '${name}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const list = await drive.files.list({ q: query, fields: 'files(id, name)' });

  if (list.data.files && list.data.files.length > 0) {
    return list.data.files[0].id!;
  }

  // Create new folder
  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });

  return folder.data.id!;
}
```

### Pattern 4: File Upload with Metadata
**What:** Upload a PDF to a specific folder with a given filename using multipart upload.
**When to use:** Filing a classified document to the correct subfolder.
**Example:**
```typescript
// Source: Google Drive API docs (https://developers.google.com/drive/api/guides/manage-uploads)
import { Readable } from 'node:stream';

async function uploadFile(
  drive: DriveClient,
  pdfBuffer: Buffer,
  filename: string,
  parentFolderId: string,
): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [parentFolderId],
    },
    media: {
      mimeType: 'application/pdf',
      body: Readable.from(pdfBuffer),
    },
    fields: 'id, name, webViewLink',
  });

  return response.data.id!;
}
```

### Pattern 5: Document Versioning (Re-upload Handling)
**What:** When a document of the same type already exists in the target folder, either update the existing file (replace content) or upload alongside with a version suffix.
**When to use:** When client re-uploads a document (e.g., updated pay stub).
**Example:**
```typescript
// Search for existing file with same classification in same folder
async function findExistingDoc(
  drive: DriveClient,
  filename: string,
  parentFolderId: string,
): Promise<string | null> {
  const query = `name contains '${docTypePrefix}' and '${parentFolderId}' in parents and trashed = false`;
  const list = await drive.files.list({ q: query, fields: 'files(id, name, modifiedTime)' });

  if (list.data.files && list.data.files.length > 0) {
    return list.data.files[0].id!;
  }
  return null;
}

// Replace existing file content (update)
async function updateFileContent(
  drive: DriveClient,
  fileId: string,
  pdfBuffer: Buffer,
  newFilename?: string,
): Promise<void> {
  await drive.files.update({
    fileId,
    requestBody: newFilename ? { name: newFilename } : {},
    media: {
      mimeType: 'application/pdf',
      body: Readable.from(pdfBuffer),
    },
  });
}
```

### Pattern 6: Finmo Document Download
**What:** Download documents from Finmo using the confirmed API endpoints. List document requests, get file details, download via signed URLs.
**When to use:** When processing a Finmo-source intake job (currently stubbed in `processFinmoSource`).
**Example:**
```typescript
// Source: Phase context (confirmed Finmo API endpoints)
import { appConfig } from '../config.js';

interface FinmoDocRequest {
  id: string;
  name: string;
  numberOfFiles: number;
  files: Array<{ src: string; fileName: string; mimeType: string }>;
}

// 1. List document requests for an application
async function listDocRequests(applicationId: string): Promise<FinmoDocRequest[]> {
  const url = `${appConfig.finmo.apiBase}/document-requests?applicationId=${applicationId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${appConfig.finmo.apiKey}` },
  });
  return (await res.json()) as FinmoDocRequest[];
}

// 2. Get document request detail with files
async function getDocRequestDetail(docRequestId: string): Promise<FinmoDocRequest> {
  const url = `${appConfig.finmo.apiBase}/document-requests/${docRequestId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${appConfig.finmo.apiKey}` },
  });
  return (await res.json()) as FinmoDocRequest;
}

// 3. Get signed download URL for a file
async function getSignedUrl(fileSrc: string): Promise<string> {
  const url = `${appConfig.finmo.apiBase}/documents/application-document?src=${encodeURIComponent(fileSrc)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${appConfig.finmo.apiKey}` },
  });
  const data = await res.json();
  return data.url; // signed download URL
}

// 4. Download the actual file
async function downloadFile(signedUrl: string): Promise<Buffer> {
  const res = await fetch(signedUrl);
  return Buffer.from(await res.arrayBuffer());
}
```

### Anti-Patterns to Avoid
- **Classifying by filename only:** Filenames from clients are unreliable ("scan001.pdf", "Document (3).pdf"). Always use content-based classification via Claude. Filename can be a secondary hint in the prompt.
- **Storing Drive folder paths instead of IDs:** Folder names can change, files can be moved between status folders. Always store the Drive file/folder ID, never the path.
- **Auto-filing low-confidence classifications:** Documents with confidence below threshold MUST go to manual review. Filing a T4 as a pay stub wastes Cat's time more than manual filing.
- **Logging PDF content or Claude API responses with PII:** The classification prompt may include document content summaries. Never log the full Claude response -- only log the structured classification result (doc type, confidence).
- **Oversized buffers in queue:** Do NOT put pdfBuffer in BullMQ job data. Pass a reference (e.g., temporary file path or document ID) and fetch the buffer in the worker.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Document classification | Regex/keyword matching on filenames | Claude API with structured output | Documents have inconsistent names, visual layouts, handwritten elements. AI handles all of these. Regex would miss 30%+ of docs. |
| Structured AI output parsing | JSON.parse with try/catch and retry loops | `output_config.format` with `json_schema` | Constrained decoding guarantees valid JSON matching the schema. Zero parse errors, no retry needed. |
| Google Drive authentication | Custom OAuth flow for Drive | Reuse `loadServiceAccountKey()` from `gmail-client.ts` | Same service account, same pattern, just different scope (`drive` instead of `gmail.readonly`). |
| File naming from metadata | Template strings with manual sanitization | Dedicated `naming.ts` module with sanitization + conventions | Cat's naming has edge cases: amounts in various formats ($16k, $1,600, $585), inconsistent field ordering. A dedicated module handles all variations. |
| Subfolder routing | If/else chain on document type | Lookup table mapping docType -> subfolder | Clean, testable, extensible. New doc types added without code changes. |
| Document deduplication | Custom hash tables | SHA-256 hash of pdfBuffer stored in Redis | Prevents re-processing the same file. Works across restarts (Redis persistence). |

**Key insight:** The classification problem is inherently AI-shaped. Canadian mortgage documents (T4, NOA, LOE, pay stubs) have strong visual and textual cues that Claude Haiku identifies with high accuracy. The value add is not in the classification itself, but in the reliable pipeline around it: confidence thresholds, manual review routing, consistent naming, correct subfolder filing, and versioning.

## Common Pitfalls

### Pitfall 1: Claude API Cost Overruns
**What goes wrong:** Each PDF page costs 1,500-3,000 tokens for text + image processing. A 10-page T1 tax return could cost 15,000-30,000 input tokens per classification call. At high volume, costs add up.
**Why it happens:** PDF support processes each page as both text and image. Multi-page documents are significantly more expensive.
**How to avoid:** (a) Use Claude Haiku 4.5 ($0.25/$1.25 per MTok input/output) -- cheapest option. (b) Send only the first 2-3 pages for classification -- the document type is almost always identifiable from page 1. (c) Track monthly API costs via Anthropic dashboard. At ~10 docs/day, 1-2 pages each, cost is ~$1-5/month with Haiku.
**Warning signs:** Monthly Anthropic bill exceeding $50 (signals either high volume or multi-page sends).

### Pitfall 2: Google Drive OAuth Scope Not Configured
**What goes wrong:** The service account or OAuth credentials are configured for `gmail.compose` and `gmail.readonly` but not `drive`. Drive API calls return 403 Forbidden.
**Why it happens:** Each new Google API requires explicit scope addition in the service account's domain-wide delegation settings in Google Workspace admin console.
**How to avoid:** Before Phase 7 implementation, add `https://www.googleapis.com/auth/drive` to the service account's domain-wide delegation scopes. For OAuth2 dev mode, re-run the consent flow with the drive scope.
**Warning signs:** 403 errors from Drive API on first test.

### Pitfall 3: Client Folder Not Found (Email-Only Docs)
**What goes wrong:** A document arrives via email (Gmail source). The IntakeDocument has `senderEmail` but no `applicationId`. The system cannot determine which client folder to file to.
**Why it happens:** When clients email docs directly to docs@, there's no Finmo application context. The system needs to match sender email to a CRM contact, then look up the CRM contact's Drive folder ID.
**How to avoid:** (a) Implement email-to-CRM-contact matching using the CRM `findContactByEmail()` function (already exists in `contacts.ts`). (b) Store the Drive folder ID as a CRM custom field on the contact record. (c) If no match, route to manual review queue instead of failing.
**Warning signs:** High rate of "unmatched" documents; documents piling up in review queue.

### Pitfall 4: Naming Convention Inconsistencies
**What goes wrong:** The naming module produces filenames that don't match Cat's existing conventions, creating visual inconsistency in Drive. Cat has to manually rename files.
**Why it happens:** Cat's naming convention has undocumented variations (amount formats: $16k vs $1,600 vs $585; field ordering varies between doc types; `*` prefix for bundled packages).
**How to avoid:** (a) Study the DRIVE_STRUCTURE.md naming examples exhaustively. (b) Use the most common pattern: `FirstName - DocType Year Amount.pdf`. (c) Normalize amounts to Cat's format: use `$Xk` for thousands, `$X` for hundreds. (d) Don't try to replicate Cat's exact inconsistencies -- standardize going forward.
**Warning signs:** Cat requesting manual rename on filed docs.

### Pitfall 5: Concurrent Filing Race Conditions
**What goes wrong:** Two documents for the same client arrive simultaneously. Both workers search for the person subfolder, both find it doesn't exist, both create it. Duplicate folders result.
**Why it happens:** BullMQ worker concurrency > 1, or multiple workers running.
**How to avoid:** (a) Keep classification worker concurrency at 1 (same as existing workers). (b) Use "find or create" pattern with a Redis mutex lock on the client folder ID. (c) Even with concurrency 1, the find-or-create pattern is idempotent -- if a folder already exists, just use it.
**Warning signs:** Duplicate subfolders appearing in Drive.

### Pitfall 6: Finmo Document API Returns Unexpected Formats
**What goes wrong:** The Finmo document download endpoints return different response structures than expected, or the signed URL format changes.
**Why it happens:** The Finmo API endpoints for document requests/files are confirmed by the user but exact response shapes may vary. Finmo documentation is not fully public.
**How to avoid:** (a) Implement defensive parsing with fallback fields (same pattern as `extractField` in `finmo-docs.ts`). (b) Log response metadata (status code, content-type) without PII for debugging. (c) Wrap Finmo download in try/catch with meaningful error messages. (d) Test with real Finmo data before deploying.
**Warning signs:** Finmo source intake jobs consistently failing; `processFinmoSource` returning errors.

### Pitfall 7: Oversized PDFs Overwhelming Classification
**What goes wrong:** A multi-page document (50+ page T1 tax return or financial statement) is sent to Claude. The API call times out or costs much more than expected.
**Why it happens:** Claude's PDF support processes every page. 100-page limit exists but even 50 pages is 75,000-150,000 tokens.
**How to avoid:** (a) Only send first 3-5 pages for classification -- document type is identifiable from the first page. (b) Set max page count in classification config. (c) Use `pdf-lib` to extract first N pages before sending to Claude. (d) Fall back to filename-hint classification for very large documents.
**Warning signs:** Classification API calls taking >30 seconds; individual call costs >$0.10.

## Code Examples

### Classification Result Schema (Zod)
```typescript
// Source: Anthropic structured output docs + project domain knowledge
import { z } from 'zod';

/** All document types the classifier recognizes */
export const DOCUMENT_TYPES = [
  // Base pack
  'photo_id', 'second_id', 'void_cheque',
  // Income - Employed
  'pay_stub', 'loe', 't4', 'noa',
  // Income - Self-employed
  't1', 't2', 'articles_of_incorporation', 'financial_statement',
  // Income - Other
  'pension_letter', 't4a', 'employment_contract',
  // Variable income
  'commission_statement', 'lease_agreement',
  // Down payment
  'bank_statement', 'rrsp_statement', 'tfsa_statement', 'fhsa_statement',
  'gift_letter',
  // Property
  'purchase_agreement', 'mls_listing', 'mortgage_statement', 'property_tax_bill',
  'home_insurance',
  // Tax
  't5', 'cra_statement_of_account', 't4rif',
  // Situations
  'separation_agreement', 'divorce_decree', 'discharge_certificate',
  // Residency
  'pr_card', 'passport', 'work_permit',
  // Other
  'other',
] as const;

export type DocumentType = typeof DOCUMENT_TYPES[number];

export const ClassificationResultSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  confidence: z.number().describe('Classification confidence 0.0-1.0'),
  borrowerFirstName: z.string().nullable().describe('First name of person doc belongs to'),
  borrowerLastName: z.string().nullable().describe('Last name'),
  taxYear: z.number().nullable().describe('Tax year if applicable'),
  amount: z.string().nullable().describe('Dollar amount if visible'),
  institution: z.string().nullable().describe('Bank/employer name if visible'),
  pageCount: z.number().nullable().describe('Number of pages in the document'),
  additionalNotes: z.string().nullable().describe('Other relevant metadata'),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;
```

### Subfolder Routing Table
```typescript
// Source: DRIVE_STRUCTURE.md analysis
export type SubfolderTarget = 'person' | 'subject_property' | 'non_subject_property'
  | 'signed_docs' | 'down_payment' | 'root';

/** Maps document type to the subfolder it should be filed in */
export const SUBFOLDER_ROUTING: Record<DocumentType, SubfolderTarget> = {
  // Person subfolder (income, ID docs)
  photo_id: 'person',
  second_id: 'person',
  pay_stub: 'person',
  loe: 'person',
  t4: 'person',
  t4a: 'person',
  noa: 'person',
  t1: 'person',
  t5: 'person',
  t4rif: 'person',
  pension_letter: 'person',
  employment_contract: 'person',
  commission_statement: 'person',
  cra_statement_of_account: 'person',

  // Subject property subfolder
  purchase_agreement: 'subject_property',
  mls_listing: 'subject_property',
  property_tax_bill: 'subject_property',
  home_insurance: 'subject_property',

  // Non-subject property
  lease_agreement: 'non_subject_property',
  mortgage_statement: 'non_subject_property', // Could also be subject property -- needs context

  // Down payment subfolder
  bank_statement: 'down_payment',
  rrsp_statement: 'down_payment',
  tfsa_statement: 'down_payment',
  fhsa_statement: 'down_payment',
  gift_letter: 'down_payment',

  // Signed docs (lender/legal paperwork)
  // (not typically filed by this system -- lender docs come later)

  // Shared / root level
  void_cheque: 'root',

  // Business docs (person subfolder or root)
  t2: 'person',
  articles_of_incorporation: 'person',
  financial_statement: 'person',

  // Situations
  separation_agreement: 'person',
  divorce_decree: 'person',
  discharge_certificate: 'person',

  // Residency
  pr_card: 'person',
  passport: 'person',
  work_permit: 'person',

  // Other
  other: 'root',
  signed_docs: 'signed_docs',
};
```

### File Naming Function
```typescript
// Source: DRIVE_STRUCTURE.md naming conventions
/**
 * Generates a filename following Cat's naming convention.
 *
 * Pattern: "FirstName - DocType [Year] [Amount].pdf"
 *
 * Examples:
 * - "Kathy - T4A CPP 2024 $16k.pdf"
 * - "Terry - T5 Scotia 2024 $5.2k.pdf"
 * - "Susan - Pay Stub Dec 5.pdf"
 * - "Susan - ID.pdf"
 */
export function generateFilename(
  classification: ClassificationResult,
  fallbackName: string,
): string {
  const name = classification.borrowerFirstName ?? fallbackName;
  const docLabel = DOC_TYPE_LABELS[classification.documentType] ?? classification.documentType;

  const parts = [name, '-', docLabel];

  if (classification.institution) {
    parts.push(classification.institution);
  }
  if (classification.taxYear) {
    parts.push(String(classification.taxYear));
  }
  if (classification.amount) {
    parts.push(classification.amount);
  }

  return sanitizeFilename(parts.join(' ') + '.pdf');
}

/** Human-readable labels for document types */
const DOC_TYPE_LABELS: Record<string, string> = {
  photo_id: 'ID',
  second_id: 'Second ID',
  pay_stub: 'Pay Stub',
  loe: 'LOE',
  t4: 'T4',
  t4a: 'T4A',
  noa: 'NOA',
  t1: 'T1',
  t5: 'T5',
  t4rif: 'T4RIF',
  t2: 'T2',
  bank_statement: 'Bank Statement',
  // ... etc
};
```

### Classification Queue Flow
```typescript
// Source: existing BullMQ patterns from intake-worker.ts and webhook/worker.ts
// Phase 6 intake-worker produces IntakeDocument -> enqueues to classification queue
// Phase 7 classification-worker consumes from classification queue

export const CLASSIFICATION_QUEUE_NAME = 'doc-classification';

export interface ClassificationJobData {
  /** IntakeDocument ID for retrieval */
  intakeDocumentId: string;
  /** Temporary file path where pdfBuffer is stored (NOT in Redis) */
  tempFilePath: string;
  /** Original filename (hint for classifier) */
  originalFilename: string;
  /** Sender email (for CRM contact matching) */
  senderEmail: string | null;
  /** Finmo application ID (if from Finmo source) */
  applicationId: string | null;
  /** Source of the document */
  source: 'gmail' | 'finmo';
  /** ISO timestamp */
  receivedAt: string;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tool use for structured output | `output_config.format` with `json_schema` (constrained decoding) | GA late 2025 | Guaranteed schema-valid JSON. No more JSON.parse errors or retry loops. Direct replacement for the tool_choice workaround. |
| `output_format` parameter | `output_config.format` parameter | Recent deprecation notice | `output_format` still works but deprecated. Use `output_config.format` for new code. |
| Claude 3 Haiku/Sonnet | Claude Haiku 4.5 / Sonnet 4.5 / Opus 4.5 | 2025 | Haiku 4.5 is the cheapest model with strong PDF understanding. Perfect for classification tasks. |
| Custom PDF text extraction (pdfjs-dist, pdf-parse) | Claude native PDF support (base64 `document` blocks) | Anthropic 2024 | No need to extract text ourselves. Claude receives the PDF directly and analyzes both text and visual layout. Handles scanned docs, images, tables. |
| Google Drive API v2 | Google Drive API v3 | Long-standing | v3 is the current stable version. v2 is deprecated. Use `google.drive({ version: 'v3' })`. |

**Deprecated/outdated:**
- `output_format` (top-level parameter): Deprecated in favor of `output_config.format`. Still works temporarily.
- `beta` headers for structured output: No longer required. Structured outputs are GA.
- Tool use as structured output workaround: Replaced by `output_config.format`. Tool use is for actual tool calls.
- `pdf-parse` / `pdfjs-dist` for text extraction: Unnecessary when using Claude's native PDF support.

## Open Questions

1. **Drive folder ID storage in CRM**
   - What we know: We need to store each client's Google Drive folder ID so the system can file documents without searching by name each time. CRM custom fields exist for doc tracking.
   - What's unclear: Is there already a custom field for Drive folder ID/link in MyBrokerPro? The architecture doc mentions storing it but it's unclear if the field was created in Phase 4.
   - Recommendation: Check existing CRM custom fields. If no Drive folder field exists, create one (Phase 7 setup step). Store the Drive folder ID, not the URL.

2. **Finmo document tagging (mark as "picked up")**
   - What we know: The phase context asks us to investigate if Finmo API supports marking documents as processed.
   - What's unclear: Whether a PATCH endpoint exists on document-requests to set a status or tag. The confirmed endpoints are all GET.
   - Recommendation: Test with PATCH on `/api/v1/document-requests/{id}` with a status field. If not supported, maintain a local Redis set of processed document request IDs for dedup.

3. **Mortgage statement routing: subject property vs non-subject**
   - What we know: Mortgage statements could belong to the subject property (refinance) or a non-subject property (investment property owned by borrower).
   - What's unclear: How to determine which property a mortgage statement belongs to without full application context.
   - Recommendation: If `applicationId` is available, check application goal. For refinance, mortgage statement goes to `Subject Property/`. For purchase, it goes to `Non-Subject Property/`. If ambiguous, route to manual review.

4. **How should Cat be notified of manual review items?**
   - What we know: Documents with low classification confidence should go to Cat for review. The CRM has task creation capability (Phase 4).
   - What's unclear: Should we create a CRM task per low-confidence doc? A daily summary? A special Gmail label?
   - Recommendation: Create a CRM task per low-confidence document, assigned to Cat. The task description includes the document's original filename, sender, and the classifier's best guess. This integrates with Cat's existing CRM workflow.

5. **Subfolder structure still needs full documentation from Cat**
   - What we know: DRIVE_STRUCTURE.md has detailed examples from several client folders. The core subfolders are: person name, Subject Property, Non-Subject Property, Signed Docs, and sometimes Down Payment.
   - What's unclear: Are there other situational subfolders? Is "Down Payment" always a subfolder or only when relevant? Does Cat create them manually as needed?
   - Recommendation: Create subfolders on demand (when a document needs to go there), not all upfront. The base set is: person subfolder(s) (always), Subject Property (when property docs arrive), and root level for shared docs.

6. **Buffer storage between intake and classification queues**
   - What we know: PDF buffers can be 10+ MB. Storing them in BullMQ/Redis is an anti-pattern (already noted in Phase 6 design).
   - What's unclear: Should we use temporary files on disk, or a dedicated object store (Google Cloud Storage, S3)?
   - Recommendation: Use temporary files on local disk (Node.js `os.tmpdir()`) with cleanup after filing. The volume is low (~10 docs/day) and files are processed within minutes. Object storage is overkill for this volume. Use `crypto.randomUUID()` for temp filenames to avoid collisions.

## Sources

### Primary (HIGH confidence)
- [Anthropic Structured Outputs Documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) - `output_config.format`, JSON schema, Zod integration, GA status
- [Anthropic PDF Support Documentation](https://platform.claude.com/docs/en/build-with-claude/pdf-support) - base64 document blocks, token costs, model support, limitations
- [Google Drive API v3: Create and populate folders](https://developers.google.com/drive/api/guides/folder) - Folder MIME type, parent IDs, create/search/move operations
- [Google Drive API v3: Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads) - Simple/multipart/resumable uploads, metadata, size limits
- [Google Drive API v3: Search query terms and operators](https://developers.google.com/workspace/drive/api/guides/ref-search-terms) - Query syntax, `parents in`, `name =`, `mimeType =`, `trashed =`
- [Google Drive API v3: Method files.create](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create) - File creation endpoint, request body, media upload
- Existing codebase: `src/email/gmail-client.ts` - Service account auth pattern to reuse for Drive
- Existing codebase: `src/intake/types.ts` - IntakeDocument interface (input to this phase)
- Existing codebase: `src/intake/intake-worker.ts` - Stubbed `processFinmoSource` to implement
- `.planning/DRIVE_STRUCTURE.md` - Cat's folder structure, naming conventions, subfolder patterns (from screenshots + API analysis)
- Phase context: Confirmed Finmo document API endpoints (GET /document-requests, GET /document-requests/{id}, GET /documents/application-document)

### Secondary (MEDIUM confidence)
- [@anthropic-ai/sdk npm](https://www.npmjs.com/package/@anthropic-ai/sdk) - TypeScript SDK, structured output helpers, PDF support
- [Anthropic SDK TypeScript GitHub](https://github.com/anthropics/anthropic-sdk-typescript) - `zodOutputFormat` helper, document content blocks
- [Google Drive API Node.js Quickstart](https://developers.google.com/workspace/drive/api/quickstart/nodejs) - Setup, auth, basic operations

### Tertiary (LOW confidence)
- Finmo document tagging (PATCH on document-requests): NOT verified. Needs live API testing. All confirmed endpoints are GET only.
- Claude Haiku 4.5 classification accuracy for Canadian mortgage docs: HIGH confidence based on document visual distinctiveness, but not empirically tested with real mortgage docs in this project. Should validate with Cat on first 10-20 classifications.
- Drive folder ID custom field in CRM: Existence NOT verified. Needs to be checked in MyBrokerPro setup.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries either already in project (googleapis, bullmq) or well-established (Anthropic SDK, Zod). API patterns verified with official docs.
- Architecture: HIGH - Follows existing codebase patterns (lazy singleton clients, BullMQ workers, typed modules). Classification-as-a-service pattern is well-established.
- Classification approach: MEDIUM-HIGH - Claude PDF support is production-ready, structured outputs guarantee valid JSON. Actual classification accuracy on Canadian mortgage docs needs empirical validation.
- Finmo document download: MEDIUM - Endpoints confirmed by user but response shapes not fully documented. Defensive parsing required.
- Pitfalls: HIGH - Most pitfalls derive from verified API documentation and existing Phase 6 lessons.
- File naming/routing: MEDIUM - Based on thorough analysis of DRIVE_STRUCTURE.md, but Cat's conventions have undocumented variations. First-batch review with Cat is essential.

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (30 days; stable domain -- Anthropic SDK and Google Drive API are mature)
