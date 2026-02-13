# Phase 4: CRM Integration - Research

**Researched:** 2026-02-13
**Domain:** GoHighLevel (MyBrokerPro) API v2 -- contacts, custom fields, tasks, opportunities
**Confidence:** MEDIUM-HIGH

## Summary

Phase 4 connects the Phase 3 checklist engine output to MyBrokerPro (GoHighLevel white-labeled CRM) so that Cat can view document status, review tasks, and track PRE-readiness without leaving the CRM. The integration creates/updates contacts, writes checklist status to custom fields, creates tasks for Cat and Taylor, and manages opportunity pipeline stage transitions.

GoHighLevel provides a comprehensive REST API v2 with an official TypeScript SDK (`@gohighlevel/api-client`) that supports Private Integration Token (PIT) authentication -- the auth method already confirmed working for this project. The API covers all needed operations: contact CRUD, custom field management, task creation, and opportunity/pipeline management. Rate limits are generous (100 requests per 10 seconds burst, 200K/day) and will not be a concern for our low-volume use case (a few API calls per Finmo application submission).

The key technical challenge is designing the custom field schema for document tracking. GoHighLevel custom fields on contacts support TEXT, LONG_TEXT, SINGLE_OPTIONS, MULTIPLE_OPTIONS, DATE, NUMERICAL, and other types. We need to store per-document status (received/missing) in a way that is both API-writable and human-readable in the CRM UI. The recommended approach is a combination of a SINGLE_OPTIONS status field and a LONG_TEXT JSON field for detailed per-document tracking, plus individual status fields for high-visibility items.

**Primary recommendation:** Use the official `@gohighlevel/api-client` SDK with PIT authentication. Build a thin CRM service layer (`src/crm/`) that wraps GHL operations. Store document tracking in a mix of SINGLE_OPTIONS aggregate status + LONG_TEXT JSON detail fields. Use upsert patterns for idempotency.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@gohighlevel/api-client` | latest | Official GHL TypeScript SDK | Official SDK, typed methods, PIT support, auto-retry on 429, GHLError class |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `dotenv` | ^16.x | Environment variable loading | Load PIT token and location ID from .env |
| `vitest` | ^4.0.18 | Test framework | Already in project, use for CRM service tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@gohighlevel/api-client` | Raw `fetch` calls | SDK gives typed responses, auto-retry on rate limit, error classes. Raw fetch is simpler but requires manual header/auth/error handling. SDK is worth it. |
| LONG_TEXT JSON field | Multiple individual custom fields per doc | Individual fields are more visible in CRM UI but 20+ fields per client would be unwieldy. JSON field is compact but less readable. Recommendation: hybrid approach (aggregate status field + JSON detail field). |

**Installation:**
```bash
npm install @gohighlevel/api-client dotenv
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── checklist/           # Phase 3 (existing) - pure function engine
│   ├── types/
│   ├── rules/
│   └── engine/
├── crm/                 # Phase 4 (new) - CRM integration layer
│   ├── types/           # GHL-specific type definitions
│   │   └── index.ts     # CrmContact, CrmTask, custom field IDs, etc.
│   ├── client.ts        # GHL SDK initialization + configuration
│   ├── contacts.ts      # Contact upsert, lookup by Finmo Deal ID
│   ├── custom-fields.ts # Custom field creation + value mapping
│   ├── tasks.ts         # Task creation for Cat and Taylor
│   ├── opportunities.ts # Pipeline stage management
│   ├── checklist-sync.ts # Maps GeneratedChecklist -> CRM operations
│   └── index.ts         # Barrel export
└── __tests__/
    └── crm/             # CRM integration tests (mocked SDK)
```

### Pattern 1: CRM Service Layer (Facade over SDK)
**What:** Thin wrapper around `@gohighlevel/api-client` that exposes domain-specific operations (e.g., `syncChecklistToContact`, `createReviewTask`) rather than raw API calls.
**When to use:** Always. Keeps CRM details out of business logic.
**Example:**
```typescript
// src/crm/checklist-sync.ts
import type { GeneratedChecklist } from '../checklist/types/index.js';
import { upsertContact } from './contacts.js';
import { updateChecklistFields } from './custom-fields.js';
import { createTask } from './tasks.js';

export async function syncChecklistToCrm(
  checklist: GeneratedChecklist,
  finmoDealId: string,
  contactEmail: string,
): Promise<{ contactId: string; taskId: string }> {
  // 1. Find or create contact by email/Finmo Deal ID
  const contact = await upsertContact({ finmoDealId, email: contactEmail });

  // 2. Write checklist status to custom fields
  await updateChecklistFields(contact.id, checklist);

  // 3. Create review task for Cat
  const task = await createTask({
    contactId: contact.id,
    title: 'Review doc request checklist',
    assignedTo: CAT_USER_ID,
    dueDate: addBusinessDays(new Date(), 1),
  });

  return { contactId: contact.id, taskId: task.id };
}
```

### Pattern 2: Custom Field ID Constants
**What:** All GHL custom field IDs stored as typed constants in one file. Never hardcoded in business logic.
**When to use:** Every CRM operation that touches custom fields.
**Example:**
```typescript
// src/crm/types/index.ts

/** Existing Finmo custom fields (already in CRM) */
export const EXISTING_FIELDS = {
  FINMO_DEAL_ID: 'YoBlMiUV8N3MrvUYoxH0',
  FINMO_APPLICATION_ID: 'FmesbQomeEwegqIyAst4',
  FINMO_DEAL_LINK: 'NhJ3BGgSZcEtyccuYkOB',
  TRANSACTION_TYPE: 'no18IIHr4smgHvfpkMHm',
  CLOSING_DATE: 'JZdgo6e5kYorFubnSMzI',
} as const;

/** New custom fields to be created for doc tracking (IDs populated after creation) */
export const DOC_TRACKING_FIELDS = {
  DOC_STATUS: '',           // SINGLE_OPTIONS: Not Started | In Progress | PRE Complete | All Complete
  DOC_REQUEST_SENT: '',     // DATE: when initial email was sent
  MISSING_DOCS_JSON: '',    // LONG_TEXT: JSON array of missing doc names
  RECEIVED_DOCS_JSON: '',   // LONG_TEXT: JSON array of received doc names
  PRE_DOCS_TOTAL: '',       // NUMERICAL: total PRE items
  PRE_DOCS_RECEIVED: '',    // NUMERICAL: received PRE items
  FULL_DOCS_TOTAL: '',      // NUMERICAL: total FULL items
  FULL_DOCS_RECEIVED: '',   // NUMERICAL: received FULL items
  LAST_DOC_RECEIVED: '',    // DATE: most recent doc upload
} as const;
```

### Pattern 3: Upsert-First for Idempotency
**What:** Use GHL upsert endpoints instead of create-then-update patterns. Upsert contact by email; upsert opportunity by contactId + pipelineId.
**When to use:** Every write operation. Critical for webhook-driven flows where retries may fire.
**Example:**
```typescript
// Contact upsert uses email as dedup key
const response = await ghl.contacts.upsertContact({
  locationId: LOCATION_ID,
  email: borrowerEmail,
  firstName: borrowerFirstName,
  lastName: borrowerLastName,
  customFields: [
    { id: DOC_TRACKING_FIELDS.DOC_STATUS, field_value: 'In Progress' },
    { id: DOC_TRACKING_FIELDS.MISSING_DOCS_JSON, field_value: JSON.stringify(missingDocs) },
  ],
});
```

### Pattern 4: Checklist-to-CRM Field Mapper
**What:** Pure function that transforms a `GeneratedChecklist` into the CRM field update payload. Testable independently from API calls.
**When to use:** Every time we sync checklist state to CRM.
**Example:**
```typescript
// src/crm/custom-fields.ts
import type { GeneratedChecklist, ChecklistItem } from '../checklist/types/index.js';

interface CrmFieldUpdate {
  id: string;
  field_value: string | number;
}

export function mapChecklistToFields(
  checklist: GeneratedChecklist,
): CrmFieldUpdate[] {
  const allItems = [
    ...checklist.borrowerChecklists.flatMap(bc => bc.items),
    ...checklist.propertyChecklists.flatMap(pc => pc.items),
    ...checklist.sharedItems,
  ];

  const preItems = allItems.filter(i => i.stage === 'PRE');
  const fullItems = allItems.filter(i => i.stage === 'FULL');
  const missingDocNames = allItems.map(i => i.displayName);

  return [
    { id: DOC_TRACKING_FIELDS.DOC_STATUS, field_value: 'In Progress' },
    { id: DOC_TRACKING_FIELDS.PRE_DOCS_TOTAL, field_value: preItems.length },
    { id: DOC_TRACKING_FIELDS.PRE_DOCS_RECEIVED, field_value: 0 },
    { id: DOC_TRACKING_FIELDS.FULL_DOCS_TOTAL, field_value: fullItems.length },
    { id: DOC_TRACKING_FIELDS.FULL_DOCS_RECEIVED, field_value: 0 },
    { id: DOC_TRACKING_FIELDS.MISSING_DOCS_JSON, field_value: JSON.stringify(missingDocNames) },
    { id: DOC_TRACKING_FIELDS.RECEIVED_DOCS_JSON, field_value: '[]' },
    { id: DOC_TRACKING_FIELDS.DOC_REQUEST_SENT, field_value: new Date().toISOString().split('T')[0] },
  ];
}
```

### Anti-Patterns to Avoid
- **Hardcoded field IDs in business logic:** All GHL IDs must be in one constants file. If a field gets recreated, change it in one place.
- **Create-then-update instead of upsert:** Upsert is idempotent; create-then-update requires existence checks and is race-condition prone.
- **Storing PII in custom field JSON:** The missing/received docs JSON should contain doc TYPE names only ("T4 - Previous Year"), never amounts, SINs, or borrower-specific values.
- **Direct SDK calls from business logic:** Always go through the CRM service layer. Business logic should call `syncChecklistToCrm()`, not `ghl.contacts.upsertContact()`.
- **Polling for status changes:** Do not build polling loops. This phase writes TO the CRM. Phase 8 (Tracking Integration) handles status updates coming back.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GHL API client | Custom fetch wrapper with auth/retry | `@gohighlevel/api-client` SDK | Handles PIT auth, rate limit retries, typed responses, error classes |
| Custom field creation | Manual API calls to create fields | SDK `locations.createCustomField()` | SDK validates field types, handles errors |
| Contact dedup | Custom email-matching logic | GHL `contacts.upsertContact()` | GHL handles dedup based on location's "Allow Duplicate" setting |
| Opportunity upsert | Search-then-create-or-update logic | GHL `opportunities.upsertOpportunity()` | Single API call, handles matching by contactId+pipelineId |
| Rate limiting | Custom rate limiter | SDK built-in retry on 429 | SDK handles this automatically |

**Key insight:** The official SDK wraps every GHL endpoint with typed methods and handles auth, retries, and errors. Building a custom HTTP client would duplicate significant work.

## Common Pitfalls

### Pitfall 1: Custom Field ID vs Key Confusion
**What goes wrong:** GHL custom fields have both an `id` (random string like "YoBlMiUV8N3MrvUYoxH0") and a `fieldKey` (readable string like "contact.dealid"). The API create/update contact endpoints expect the `id`, not the `fieldKey`.
**Why it happens:** The CRM UI shows field keys (like `contact.doc_status`) but the API requires the actual field ID.
**How to avoid:** After creating custom fields via API, immediately store the returned `id` values. Use the `GET /locations/{locationId}/customFields` endpoint to map field keys to IDs.
**Warning signs:** 422 Unprocessable Entity errors when updating custom fields.

### Pitfall 2: customFields Array Format
**What goes wrong:** The customFields parameter in contact create/update has TWO possible formats. The wrong format silently ignores updates.
**Why it happens:** Some documentation shows `{ "customFields": { "key": "value" } }` (object format) while the array format `[{ "id": "...", "field_value": "..." }]` is the correct v2 format.
**How to avoid:** Always use the array format: `customFields: [{ id: "fieldId", field_value: "value" }]`. Verify with a read-back after write.
**Warning signs:** Custom field values not appearing in CRM UI after API update with 200 response.

### Pitfall 3: Opportunity vs Contact Confusion
**What goes wrong:** GHL has both Contacts (people) and Opportunities (deals in pipelines). Custom fields can be on either. Pipeline stages are on Opportunities, not Contacts.
**Why it happens:** Finmo integration creates contacts. We need BOTH a contact record AND an opportunity record to track pipeline stages.
**How to avoid:** Create/upsert the contact first, then create/upsert an opportunity linked to that contact in the target pipeline.
**Warning signs:** Contact exists but doesn't appear in pipeline view; stage updates fail.

### Pitfall 4: Existing Finmo Integration Conflicts
**What goes wrong:** Finmo already syncs contacts into MyBrokerPro (source: "finmo"). Our automation might create duplicate contacts or overwrite Finmo-synced data.
**Why it happens:** Both systems use email as the dedup key, but timing matters. If Finmo webhook fires before our automation, contact already exists.
**How to avoid:** Always use upsert. Search for existing contact by email first. Only ADD custom field values, never overwrite Finmo-managed fields (Deal ID, Application ID, Deal Link).
**Warning signs:** Duplicate contacts in CRM; Finmo fields getting blanked out.

### Pitfall 5: LONG_TEXT Field Size Limits
**What goes wrong:** JSON stored in LONG_TEXT custom fields may exceed undocumented character limits, causing silent truncation.
**Why it happens:** GoHighLevel does not publicly document character limits for LONG_TEXT fields.
**How to avoid:** Keep JSON payloads compact. Use short doc names, not full display names. Test with a worst-case checklist (~40 items). If truncation occurs, fall back to storing only missing items (smaller set over time).
**Warning signs:** JSON parse errors when reading back from CRM; incomplete doc lists.

### Pitfall 6: Task Assignment Requires User IDs
**What goes wrong:** Task `assignedTo` field requires a GHL user ID (like "kfvuds7wRjIAvb3uWueF"), not a name or email.
**Why it happens:** The API is user-ID based, not name-based.
**How to avoid:** Fetch user IDs for Cat and Taylor via `GET /users/` (or `GET /locations/{locationId}/users`) at startup or configuration time. Store as environment variables.
**Warning signs:** Tasks created but not visible to the intended user.

## Code Examples

### GHL SDK Initialization with PIT
```typescript
// src/crm/client.ts
import HighLevel from '@gohighlevel/api-client';

const ghl = new HighLevel({
  privateIntegrationToken: process.env.GHL_PRIVATE_TOKEN!,
});

export const LOCATION_ID = process.env.GHL_LOCATION_ID ?? 'bzzWH2mLpCr7HHulO3bW';

export { ghl };
```

### Contact Upsert with Custom Fields
```typescript
// src/crm/contacts.ts
import { ghl, LOCATION_ID } from './client.js';

interface UpsertContactInput {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  customFields?: Array<{ id: string; field_value: string | number }>;
}

export async function upsertContact(input: UpsertContactInput) {
  const response = await ghl.contacts.upsertContact({
    locationId: LOCATION_ID,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    ...(input.phone ? { phone: input.phone } : {}),
    customFields: input.customFields ?? [],
  });
  return response;
}
```

### Create Task for Cat
```typescript
// src/crm/tasks.ts
import { ghl } from './client.js';

interface CreateTaskInput {
  contactId: string;
  title: string;
  body?: string;
  assignedTo: string;  // GHL user ID
  dueDate: Date;
}

export async function createTask(input: CreateTaskInput) {
  const response = await ghl.contacts.createTask(
    { contactId: input.contactId },
    {
      title: input.title,
      body: input.body ?? '',
      assignedTo: input.assignedTo,
      dueDate: input.dueDate.toISOString(),
      completed: false,
    }
  );
  return response;
}
```

### Create Opportunity in Pipeline
```typescript
// src/crm/opportunities.ts
import { ghl, LOCATION_ID } from './client.js';

const PIPELINE_IDS = {
  FINMO_LEADS: 'FK2LWevdQrcfHLHfjpDa',
  LIVE_DEALS: 'tkBeD1nIfgNphnh1oyDW',
} as const;

export async function upsertOpportunity(input: {
  contactId: string;
  pipelineId: string;
  stageId: string;
  name: string;
}) {
  const response = await ghl.opportunities.upsertOpportunity({
    locationId: LOCATION_ID,
    contactId: input.contactId,
    pipelineId: input.pipelineId,
    stageId: input.stageId,
    name: input.name,
    status: 'open',
  });
  return response;
}
```

### Create Custom Field Definition
```typescript
// src/crm/custom-fields.ts (setup script, run once)
import { ghl, LOCATION_ID } from './client.js';

const FINMO_GROUP_ID = 'jlGAdTgblv5q2cWiw2Qc';

export async function createDocTrackingFields() {
  const fields = [
    {
      name: 'Doc Collection Status',
      dataType: 'SINGLE_OPTIONS',
      model: 'contact',
      parentId: FINMO_GROUP_ID,
      picklistOptions: ['Not Started', 'In Progress', 'PRE Complete', 'All Complete'],
    },
    {
      name: 'Doc Request Sent Date',
      dataType: 'DATE',
      model: 'contact',
      parentId: FINMO_GROUP_ID,
    },
    {
      name: 'Missing Docs',
      dataType: 'LONG_TEXT',
      model: 'contact',
      parentId: FINMO_GROUP_ID,
    },
    {
      name: 'Received Docs',
      dataType: 'LONG_TEXT',
      model: 'contact',
      parentId: FINMO_GROUP_ID,
    },
    {
      name: 'PRE Docs Total',
      dataType: 'NUMERICAL',
      model: 'contact',
      parentId: FINMO_GROUP_ID,
    },
    {
      name: 'PRE Docs Received',
      dataType: 'NUMERICAL',
      model: 'contact',
      parentId: FINMO_GROUP_ID,
    },
    {
      name: 'FULL Docs Total',
      dataType: 'NUMERICAL',
      model: 'contact',
      parentId: FINMO_GROUP_ID,
    },
    {
      name: 'FULL Docs Received',
      dataType: 'NUMERICAL',
      model: 'contact',
      parentId: FINMO_GROUP_ID,
    },
    {
      name: 'Last Doc Received Date',
      dataType: 'DATE',
      model: 'contact',
      parentId: FINMO_GROUP_ID,
    },
  ];

  const createdIds: Record<string, string> = {};
  for (const field of fields) {
    const result = await ghl.locations.createCustomField(
      { locationId: LOCATION_ID },
      field,
    );
    createdIds[field.name] = result.customField.id;
    console.log(`Created: ${field.name} -> ${result.customField.id}`);
  }

  return createdIds;
}
```

## API Reference (GoHighLevel v2)

### Authentication
```
Authorization: Bearer <PRIVATE_INTEGRATION_TOKEN>
Version: 2021-07-28
Content-Type: application/json
```

### Key Endpoints

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| Upsert Contact | POST | `/contacts/upsert` | Dedup by email; locationId required |
| Update Contact | PUT | `/contacts/:contactId` | Set custom fields |
| Search Contacts | POST | `/contacts/search` | Advanced filters, replaces deprecated GET |
| Get Contact | GET | `/contacts/:contactId` | Full contact with custom fields |
| Create Task | POST | `/contacts/:contactId/tasks` | assignedTo, dueDate, title, body |
| Get Tasks | GET | `/contacts/:contactId/tasks` | List tasks for contact |
| Create Opportunity | POST | `/opportunities/` | pipelineId, stageId, contactId |
| Upsert Opportunity | POST | `/opportunities/upsert` | Dedup by contactId + pipelineId |
| Update Opportunity | PUT | `/opportunities/:opportunityId` | Change stage, status |
| Get Pipelines | GET | `/opportunities/pipelines` | Lists all pipelines + stages |
| Create Custom Field | POST | `/locations/:locationId/customFields` | name, dataType, model, parentId |
| Get Custom Fields | GET | `/locations/:locationId/customFields` | Returns all fields with IDs |
| Get Users | GET | `/users/` | Get user IDs for task assignment |

### Rate Limits
- **Burst:** 100 requests per 10 seconds per location
- **Daily:** 200,000 requests per day per location
- **Impact:** Negligible for our use case (5-10 API calls per application submission)

### Custom Field Types
| dataType | Use For | Value Format |
|----------|---------|--------------|
| TEXT | Short strings | `"string value"` |
| LONG_TEXT | JSON data, notes | `"long string value"` |
| SINGLE_OPTIONS | Status dropdowns | `"option value"` (must match defined options) |
| MULTIPLE_OPTIONS | Multi-select | `["option1", "option2"]` |
| DATE | Dates | `"YYYY-MM-DD"` |
| NUMERICAL | Counts, amounts | `42` |
| MONETORY | Dollar amounts | `50000` |
| PHONE | Phone numbers | `"+15551234567"` |
| CHECKBOX | Boolean options | `["option1"]` |

### Custom Fields in Contact Create/Update
```json
{
  "customFields": [
    { "id": "YoBlMiUV8N3MrvUYoxH0", "field_value": "some-deal-id" },
    { "id": "NEW_FIELD_ID_HERE", "field_value": "In Progress" }
  ]
}
```
**Important:** Use `id` (the random GHL field ID), NOT `fieldKey` (the human-readable key). The `field_value` property name is literal.

### Known IDs (Already Captured)

| Entity | Name | ID |
|--------|------|-----|
| Location | Venture Mortgages | `bzzWH2mLpCr7HHulO3bW` |
| Pipeline | Finmo - Leads | `FK2LWevdQrcfHLHfjpDa` |
| Pipeline | Finmo - Live Deals | `tkBeD1nIfgNphnh1oyDW` |
| Field | Finmo Deal ID | `YoBlMiUV8N3MrvUYoxH0` |
| Field | Finmo Application ID | `FmesbQomeEwegqIyAst4` |
| Field | Finmo Deal Link | `NhJ3BGgSZcEtyccuYkOB` |
| Field | Transaction Type | `no18IIHr4smgHvfpkMHm` |
| Field | Closing Date | `JZdgo6e5kYorFubnSMzI` |
| Field Group | Finmo Integration | `jlGAdTgblv5q2cWiw2Qc` |

### IDs to Fetch (Phase 4 Task)

| Entity | Name | How to Fetch |
|--------|------|--------------|
| Stage ID | "Collecting Documents" (Live Deals) | `GET /opportunities/pipelines` |
| Stage ID | "All Docs Received" (Live Deals) | `GET /opportunities/pipelines` |
| Stage ID | "Application Received" (Leads) | `GET /opportunities/pipelines` |
| User ID | Cat (task assignee) | `GET /users/` |
| User ID | Taylor (PRE-readiness notification) | `GET /users/` |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| GHL API v1 | GHL API v2 | 2024 | v1 is EOL, no support. Must use v2. |
| Raw HTTP + manual auth | `@gohighlevel/api-client` SDK | 2025 | Official SDK with PIT support, types, auto-retry |
| GET /contacts/ (list) | POST /contacts/search (advanced) | 2025 | Old list endpoint deprecated. Search supports filters. |
| Manual OAuth token refresh | SDK handles automatically | 2025 | No manual refresh code needed |
| Custom field values as object | Custom field values as array | v2 | Format: `[{ id, field_value }]` not `{ key: value }` |

**Deprecated/outdated:**
- GHL API v1: EOL, no support, do not use
- `GET /contacts/` list endpoint: deprecated, use `POST /contacts/search` instead

## Open Questions

1. **LONG_TEXT field character limit**
   - What we know: GoHighLevel does not publicly document character limits for LONG_TEXT fields
   - What's unclear: Maximum characters before truncation. Our JSON payloads could be 1-3KB for a complex checklist.
   - Recommendation: Test with worst-case payload (40+ items, ~2KB JSON). If truncation occurs, switch to storing only missing items (smaller) or use a TEXT_AREA custom field type if available. LOW risk -- most checklists will be under 1KB.

2. **Exact SDK method signatures for tasks and custom fields**
   - What we know: SDK wraps all endpoints with typed methods. Contact and opportunity methods are well-documented.
   - What's unclear: Exact parameter names for `createTask` and `createCustomField` via SDK (docs show REST, not SDK methods).
   - Recommendation: Install SDK and check TypeScript definitions directly. The types will be authoritative. If SDK methods are unclear, fall back to raw `fetch` for those specific endpoints.

3. **User ID for Cat and Taylor**
   - What we know: `assignedTo` field on sample contact shows a user ID ("kfvuds7wRjIAvb3uWueF"). Need to confirm which user this maps to.
   - What's unclear: Whether `GET /users/` requires special scopes on the PIT.
   - Recommendation: First task in Phase 4 should fetch and document all user IDs. Store as environment variables.

4. **Pipeline stage IDs**
   - What we know: Pipeline names and IDs confirmed. Stage names listed but IDs not yet fetched.
   - What's unclear: Exact stage IDs for "Collecting Documents", "All Docs Received", "Application Received".
   - Recommendation: First task should fetch via `GET /opportunities/pipelines` and store in constants file.

5. **Finmo-to-CRM contact linking**
   - What we know: Finmo integration creates contacts with `source: "finmo"` and populates Finmo Deal ID, Application ID, Deal Link fields. 551 contacts exist.
   - What's unclear: Exact timing of Finmo's contact creation vs our automation trigger. Whether upsert by email will correctly match Finmo-created contacts.
   - Recommendation: Search for contact by email first. If found, update custom fields. If not found, upsert will create. Always preserve existing Finmo field values (never overwrite Deal ID, Application ID, or Deal Link).

## Sources

### Primary (HIGH confidence)
- [GoHighLevel API v2 Official Docs](https://marketplace.gohighlevel.com/docs/) - Endpoint reference, auth, rate limits
- [GoHighLevel Official SDK](https://github.com/GoHighLevel/highlevel-api-sdk) - TypeScript SDK with PIT support
- [SDK Node.js Docs](https://marketplace.gohighlevel.com/docs/sdk/node/index.html) - SDK usage examples
- [Private Integration Tokens Guide](https://help.gohighlevel.com/support/solutions/articles/155000003054-private-integrations-everything-you-need-to-know) - PIT auth details
- [MBP_CRM_REFERENCE.md](.planning/MBP_CRM_REFERENCE.md) - Project-specific CRM field inventory, pipeline IDs, existing Finmo integration analysis

### Secondary (MEDIUM confidence)
- [Webhook Integration Guide](https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/index.html) - Webhook events and payload format
- [n8n Community: Custom Fields](https://community.n8n.io/t/custom-fields-update-in-highlevel-using-highlevel-node-or-http-request-put-not-working/48904) - Confirmed `[{ id, field_value }]` format
- [n8n Community: Opportunity Upsert](https://community.n8n.io/t/how-to-filter-create-update-an-opportunity-in-highlevel-using-n8n/142273) - Confirmed upsert endpoint and body format

### Tertiary (LOW confidence)
- LONG_TEXT character limits: No official documentation found. Needs empirical testing.
- SDK method signatures for tasks/custom-fields: Documented for REST, inferred for SDK. Will be confirmed when SDK is installed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official SDK is well-documented, PIT auth confirmed working
- Architecture: HIGH - Pattern is straightforward CRUD over REST API with typed wrappers
- API endpoints: MEDIUM-HIGH - REST endpoints confirmed, SDK method signatures need validation after install
- Custom field schema: MEDIUM - Field types confirmed, but LONG_TEXT limits and optimal schema design need testing
- Pitfalls: MEDIUM-HIGH - Common issues well-documented in community forums

**Research date:** 2026-02-13
**Valid until:** 2026-03-13 (stable API, unlikely to change)
