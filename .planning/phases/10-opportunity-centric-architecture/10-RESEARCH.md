# Phase 10: Opportunity-Centric Architecture - Research

**Researched:** 2026-02-21
**Domain:** GoHighLevel CRM API (opportunities, custom fields) + internal architecture refactor
**Confidence:** MEDIUM (GHL API docs are poorly scrapeable; SDK type definitions and community reports are primary sources)

## Summary

Phase 10 is a significant architectural refactor that moves document tracking from the CRM contact level to the opportunity (deal) level. This is critical because Finmo already creates its own opportunities in GoHighLevel with custom fields (deal ID, borrower info, transaction type), and our current code creates **duplicate** opportunities via `/opportunities/upsert` (which deduplicates by `contactId + pipelineId`, overwriting Finmo's opportunity or creating a conflicting one). Additionally, storing doc tracking on the contact breaks when a client has multiple simultaneous deals.

The refactor touches 5 core modules: `opportunities.ts`, `tracking-sync.ts`, `checklist-sync.ts`, `checklist-mapper.ts`, and `classification-worker.ts`. It also requires new setup scripts to create opportunity-scoped custom fields and a migration path for existing contacts with doc tracking data. The GHL API supports custom fields on opportunities (confirmed via SDK type definitions: `CreateDto.customFields`, `UpdateOpportunityDto.customFields`, and `SearchOpportunitiesResponseSchema.customFields`), though the Custom Fields V2 API for creating fields scoped to opportunities has been historically unreliable per community reports.

**Primary recommendation:** Use `searchOpportunity({ contactId, pipelineId })` to find Finmo's existing opportunity, then `PUT /opportunities/:id` with `customFields` to store doc tracking data on the opportunity instead of the contact. Create opportunity-scoped custom fields via the legacy `POST /locations/:locationId/customFields` endpoint with `model: 'opportunity'`. Fall back to contact-level tracking if no opportunity is found (backward compat).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Raw fetch (native) | N/A | GHL API calls | Project uses raw fetch throughout (SDK types incomplete for custom fields); consistent pattern |
| @gohighlevel/api-client | 2.2.2 | Type definitions only | Already installed; use for type reference, not runtime (project decision from Phase 4) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.0.18 | Testing | All unit/integration tests |
| dotenv | 17.3.1 | Config | Environment variable loading |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw fetch | GHL SDK runtime | SDK `CreateCustomFieldsDTO` missing parentId/picklistOptions (Phase 4 decision); SDK customFields typed as `any[]` |
| Contact-level fallback | Hard cutover | Backward compat lost; existing single-deal clients break |

**No new packages needed.** This is purely an internal architecture refactor using existing dependencies.

## Architecture Patterns

### Current Architecture (Contact-Level Tracking)

```
webhook worker (processJob)
  -> syncChecklistToCrm
       -> upsertContact (email, customFields with doc tracking)
       -> createReviewTask (contactId)
       -> moveToCollectingDocs (contactId) -- creates OUR opportunity via upsert

classification worker (processClassificationJob)
  -> updateDocTracking
       -> getContact (read contact custom fields)
       -> upsertContact (write updated custom fields)
       -> createAuditNote (contactId)
       -> moveToAllDocsReceived (contactId) -- upsert opportunity
```

### Target Architecture (Opportunity-Level Tracking)

```
webhook worker (processJob)
  -> findFinmoOpportunity (contactId, pipelineId) -- FIND existing, don't create
  -> syncChecklistToOpportunity (opportunityId, customFields with doc tracking)
       -> updateOpportunity (opportunityId, customFields)
       -> createReviewTask (contactId) -- tasks stay on contact
       -> updateOpportunityStage (opportunityId, "Collecting Documents")

classification worker (processClassificationJob)
  -> resolveOpportunityId (contactId, applicationId/dealId)
  -> updateDocTracking
       -> getOpportunity (read opportunity custom fields)
       -> updateOpportunity (write updated custom fields)
       -> createAuditNote (contactId) -- notes stay on contact
       -> updateOpportunityStage (opportunityId, "All Docs Received")
```

### Recommended Project Structure Changes

```
src/crm/
├── config.ts              # Add opportunity field IDs
├── types/index.ts         # Add opportunity types, update field defs
├── contacts.ts            # Remove doc tracking fields (keep contact upsert)
├── opportunities.ts       # MAJOR: find by contact, get, update with custom fields
├── tracking-sync.ts       # MAJOR: read/write opportunity instead of contact
├── checklist-sync.ts      # MAJOR: write to opportunity, not contact
├── checklist-mapper.ts    # Minor: same logic, different target
├── notes.ts               # Unchanged (notes stay on contact)
├── tasks.ts               # Unchanged (tasks stay on contact)
├── doc-type-matcher.ts    # Unchanged
├── setup/
│   ├── create-custom-fields.ts  # MAJOR: model='opportunity' instead of 'contact'
│   └── fetch-ids.ts             # Minor: also list opportunity custom fields
└── __tests__/
    ├── tracking-sync.test.ts    # MAJOR: mock opportunity instead of contact
    ├── checklist-sync.test.ts   # MAJOR: mock opportunity write
    └── opportunities.test.ts    # NEW: test find/get/update patterns
```

### Pattern 1: Find Finmo's Existing Opportunity

**What:** Search for the opportunity Finmo already created instead of creating our own via upsert.

**When to use:** Every time a new Finmo application arrives (webhook worker step 4).

**Example:**
```typescript
// Source: GHL SDK type definitions (searchOpportunity params)
// GET /opportunities/search?locationId=X&pipelineId=Y&contactId=Z
export async function findOpportunityByContact(
  contactId: string,
  pipelineId: string,
): Promise<Opportunity | null> {
  const params = new URLSearchParams({
    locationId: crmConfig.locationId,
    pipelineId,
    contactId,
    limit: '10',
  });

  const response = await oppFetch(`/opportunities/search?${params}`, {
    method: 'GET',
  });

  const data = await response.json() as {
    opportunities: Opportunity[];
  };

  // Return the most recently created opportunity for this contact+pipeline
  // Finmo creates one per application
  return data.opportunities?.[0] ?? null;
}
```

**Confidence:** MEDIUM -- SDK confirms `contactId` and `pipelineId` are valid search params. Exact response shape may vary.

### Pattern 2: Update Opportunity Custom Fields

**What:** Write doc tracking fields (missingDocs, receivedDocs, counters) to the opportunity.

**When to use:** When checklist is generated (webhook worker) and when docs are received (classification worker).

**Example:**
```typescript
// Source: GHL SDK UpdateOpportunityDto + customFieldsInputObjectSchema
// PUT /opportunities/:id
export async function updateOpportunityFields(
  opportunityId: string,
  customFields: Array<{ id: string; field_value: string | number }>,
): Promise<void> {
  await oppFetch(`/opportunities/${opportunityId}`, {
    method: 'PUT',
    body: JSON.stringify({ customFields }),
  });
}
```

**Confidence:** HIGH -- SDK type `UpdateOpportunityDto` has `customFields?: any[]` and `customFieldsInputObjectSchema` shows `{ id, key?, field_value? }`. The n8n community confirms `{ id, field_value }` format works for opportunities.

### Pattern 3: Opportunity Resolution Strategy

**What:** Find the correct opportunity for a document that was just classified.

**When to use:** Classification worker, after resolving contact ID.

**Example:**
```typescript
// Strategy: try multiple approaches to find the right opportunity
export async function resolveOpportunityForDoc(
  contactId: string,
  finmoDealId: string | null,
): Promise<string | null> {
  // 1. If we have a Finmo deal ID, search for opportunity with that custom field
  // Note: GHL search may not support custom field filtering directly
  // Alternative: search by contactId + pipelineId, then filter client-side

  const opportunities = await searchOpportunities(contactId, PIPELINE_IDS.LIVE_DEALS);

  if (!opportunities.length) return null;

  // 2. If Finmo deal ID known, match by custom field
  if (finmoDealId) {
    const match = opportunities.find(opp =>
      opp.customFields?.some(f =>
        f.id === EXISTING_FIELDS.FINMO_DEAL_ID && f.fieldValue === finmoDealId
      )
    );
    if (match) return match.id;
  }

  // 3. Fallback: most recent opportunity (single-deal clients)
  return opportunities[0]?.id ?? null;
}
```

**Confidence:** MEDIUM -- searching by custom field value directly via API may not be supported. Client-side filtering after contact+pipeline search is the safe approach.

### Pattern 4: Document Reuse Across Deals

**What:** Reusable docs (IDs, T4s, bank statements) should mark as received across all active opportunities for a client. Property-specific docs only apply to one deal.

**When to use:** Classification worker tracking step, after filing a reusable document.

**Example:**
```typescript
import { PROPERTY_SPECIFIC_TYPES } from '../drive/doc-expiry.js';

// If this is a reusable doc, update ALL active opportunities for this contact
if (!PROPERTY_SPECIFIC_TYPES.has(documentType)) {
  const allOpps = await searchOpportunities(contactId, PIPELINE_IDS.LIVE_DEALS);
  for (const opp of allOpps.filter(o => o.status === 'open')) {
    await updateDocTrackingOnOpportunity(opp.id, documentType, driveFileId);
  }
} else {
  // Property-specific: only update the matched opportunity
  await updateDocTrackingOnOpportunity(matchedOppId, documentType, driveFileId);
}
```

**Confidence:** HIGH -- PROPERTY_SPECIFIC_TYPES already defined in `src/drive/doc-expiry.ts` with the exact set of property-specific doc types.

### Anti-Patterns to Avoid

- **Using `/opportunities/upsert`:** This deduplicates by `contactId + pipelineId`, which will overwrite Finmo's existing opportunity. NEVER upsert; always FIND first, then UPDATE.
- **Creating our own opportunity:** Finmo creates opportunities with rich metadata (deal ID, link, borrower info). We should find and update, not create.
- **Storing doc tracking on contact AND opportunity:** During migration, keep it on opportunity only. Don't maintain two copies -- that's the bug we're fixing.
- **Assuming one opportunity per contact:** Multi-deal clients will have multiple. Always search and filter.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Opportunity search | Custom search endpoint | `GET /opportunities/search` with contactId+pipelineId params | SDK confirms these params exist |
| Custom field CRUD | Custom field management | `POST /locations/:locationId/customFields` with model='opportunity' | Same pattern as current contact fields |
| Property-specific check | New doc type list | `PROPERTY_SPECIFIC_TYPES` from `src/drive/doc-expiry.ts` | Already defined and tested |
| Doc status computation | New status logic | `computeDocStatus` from `src/crm/checklist-mapper.ts` | Already works -- it's pure math |

**Key insight:** Most of the business logic (checklist mapping, doc status computation, doc type matching) doesn't change. What changes is WHERE the data lives (opportunity vs contact) and HOW we find the right opportunity.

## Common Pitfalls

### Pitfall 1: Upsert Creates Duplicate Opportunities
**What goes wrong:** Using `/opportunities/upsert` with contactId+pipelineId as the current code does will match/overwrite Finmo's opportunity OR create a new one alongside it.
**Why it happens:** GHL upsert uses contactId+pipelineId as dedup key. If Finmo already created one, we match and overwrite its name/stage. If not, we create a second opportunity.
**How to avoid:** Never use upsert. Search for existing opportunity first, then update.
**Warning signs:** Test contacts showing 2+ opportunities in the pipeline (e.g., John van der Woude had 3).

### Pitfall 2: Custom Fields V2 API May Not Support Opportunity Model
**What goes wrong:** The Custom Fields V2 API (`POST /custom-fields/`) says it "Only supports Custom Objects and Company (Business) today." Creating custom fields with `objectKey: 'opportunity'` via V2 may fail.
**Why it happens:** GHL has two custom field APIs: legacy (`POST /locations/:locationId/customFields` with `model` param) and V2 (with `objectKey`). V2 is newer but more limited.
**How to avoid:** Use the legacy API (`POST /locations/:locationId/customFields`) with `model: 'opportunity'` -- this is what Finmo itself uses to create its custom fields on opportunities.
**Warning signs:** 422/400 errors when creating fields with the V2 endpoint.

### Pitfall 3: Opportunity Custom Fields Not Returned in GET
**What goes wrong:** Community reports that custom fields may not be returned in `GET /opportunities/:id` or search results.
**Why it happens:** GHL had a rocky rollout of opportunity custom fields (marked "complete" in Sept 2023 but reported broken through 2024).
**How to avoid:** Test with live API early. If GET doesn't return custom fields, try the search endpoint which the SDK type `SearchOpportunitiesResponseSchema` explicitly includes `customFields?: CustomFieldResponseSchema[]`.
**Warning signs:** `customFields` array is undefined or empty on opportunities that should have values.

### Pitfall 4: Breaking Existing Single-Deal Clients
**What goes wrong:** Existing contacts have doc tracking data in their custom fields. New code reads from opportunity, finds nothing, treats everything as missing.
**Why it happens:** No migration of existing data from contact fields to opportunity fields.
**How to avoid:** Phase the migration: (1) write to opportunity going forward, (2) for existing clients, read from contact as fallback, (3) eventually clean up contact fields.
**Warning signs:** Clients who had docs received show "Not Started" status after deployment.

### Pitfall 5: Classification Worker Can't Find Opportunity
**What goes wrong:** A document arrives for a client but the worker can't determine which opportunity to update (no applicationId in the email context).
**Why it happens:** Documents arriving via email don't have a Finmo deal ID attached. The worker only knows the sender email.
**How to avoid:** Resolution strategy: contactId -> search opportunities -> if only one open, use it. If multiple, check if document is reusable (update all) or property-specific (log warning, route to manual review).
**Warning signs:** Tracking updates silently failing for multi-deal clients.

## Code Examples

### GHL Opportunity API Endpoints (from SDK type definitions)

```typescript
// Source: @gohighlevel/api-client v2.2.2 opportunities.d.ts

// SEARCH: GET /opportunities/search
// Params: locationId (required), pipelineId?, contactId?, status?, q?, limit?, page?
// Response: { opportunities: SearchOpportunitiesResponseSchema[], meta: SearchMetaResponseSchema }

// GET: GET /opportunities/:id
// Response: { opportunity: SearchOpportunitiesResponseSchema }

// CREATE: POST /opportunities/
// Body: { pipelineId, locationId, name, status, contactId, customFields?: any[] }
// Response: { opportunity: SearchOpportunitiesResponseSchema }

// UPDATE: PUT /opportunities/:id
// Body: { pipelineId?, name?, pipelineStageId?, status?, customFields?: any[] }
// Response: { opportunity: SearchOpportunitiesResponseSchema }

// UPSERT: POST /opportunities/upsert (DO NOT USE -- see Pitfall 1)
// Body: { pipelineId, locationId, contactId, name?, status?, pipelineStageId? }
// Note: NO customFields in UpsertOpportunityDto!
```

### Custom Field Format on Opportunities

```typescript
// Source: n8n community workaround + SDK customFieldsInputObjectSchema
// Same format as contacts:
{
  customFields: [
    { id: "field_id_here", field_value: "text value" },
    { id: "field_id_here", field_value: 42 },
  ]
}

// Response format (from SearchOpportunitiesResponseSchema):
{
  customFields: [
    { id: "field_id_here", fieldValue: "text value" }  // Note: fieldValue, not field_value
  ]
}
```

### Creating Opportunity-Scoped Custom Fields

```typescript
// Source: Current create-custom-fields.ts pattern, adapted for opportunity model
// POST /locations/:locationId/customFields
{
  name: "Missing Docs",
  dataType: "LARGE_TEXT",
  model: "opportunity",  // Changed from "contact"
  parentId: FIELD_GROUP_ID,  // Same Finmo Integration group
}
```

### Opportunity Type Definition (for project)

```typescript
// Based on SDK SearchOpportunitiesResponseSchema
export interface CrmOpportunity {
  id: string;
  name?: string;
  contactId?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: string;
  customFields?: Array<{ id: string; fieldValue: unknown }>;
  createdAt?: string;
  updatedAt?: string;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Contact custom fields for doc tracking | Opportunity custom fields | Phase 10 | Each deal has independent checklist |
| `/opportunities/upsert` (create our own) | `GET /opportunities/search` + `PUT /opportunities/:id` | Phase 10 | Find Finmo's opportunity, don't overwrite |
| One checklist per contact | One checklist per opportunity | Phase 10 | Multi-deal clients work correctly |

**Deprecated/outdated:**
- `upsertOpportunity()` in `src/crm/opportunities.ts`: Will be replaced by search+update pattern
- `moveToCollectingDocs()` and `moveToAllDocsReceived()` in `src/crm/opportunities.ts`: Will be replaced by `updateOpportunityStage()`
- Contact-level doc tracking fields (9 fields): Will be deprecated after migration

## Open Questions

1. **Can opportunity custom fields be created via the legacy API with `model: 'opportunity'`?**
   - What we know: The current setup script uses `model: 'contact'`. Finmo's own custom fields (deal ID, deal link) exist on opportunities. The Custom Fields V2 API explicitly says it only supports Custom Objects and Company today.
   - What's unclear: Whether the legacy API (`POST /locations/:locationId/customFields`) supports `model: 'opportunity'`. Finmo does it somehow.
   - Recommendation: Test empirically by creating one test field with `model: 'opportunity'` via the legacy API. If it fails, use the GHL UI to create fields manually and just fetch their IDs via script. **LOW confidence** -- must validate before planning.

2. **Does `GET /opportunities/:id` reliably return customFields?**
   - What we know: SDK types include `customFields` on the response. Community reports from 2023-2024 said it didn't work.
   - What's unclear: Current state (Feb 2026) -- may have been fixed.
   - Recommendation: Test with a real Finmo-created opportunity. Read it via GET and check if Finmo's custom fields (deal ID `YoBlMiUV8N3MrvUYoxH0`) are present. **LOW confidence** -- must validate.

3. **How does the Finmo deal ID custom field map between contact and opportunity?**
   - What we know: `EXISTING_FIELDS.FINMO_DEAL_ID = 'YoBlMiUV8N3MrvUYoxH0'` is stored on the contact. Finmo also creates opportunities with custom fields.
   - What's unclear: Is the same field ID used on both contact and opportunity? Or does Finmo create separate opportunity-scoped fields?
   - Recommendation: Use the fetch-ids script or API call to list custom fields with `model=opportunity` and compare IDs. This determines our lookup strategy. **MEDIUM confidence**.

4. **What happens to existing contacts with doc tracking data during migration?**
   - What we know: There are up to 11 contacts with doc tracking fields populated (from the 11 test draft emails generated).
   - What's unclear: Whether these are real production contacts or test contacts (likely test based on `[TEST]` prefix).
   - Recommendation: Since this is still development mode, likely safe to clear contact fields without migration. But verify with Taylor. If production contacts exist, need a one-time migration script.

5. **How to handle document tracking when classification worker doesn't know which deal a doc belongs to?**
   - What we know: Email-sourced docs only have sender email, not Finmo deal ID. Classification extracts borrower name but not deal context.
   - What's unclear: For multi-deal clients, how to determine which deal a non-property-specific doc should be tracked against.
   - Recommendation: For reusable docs (IDs, T4s, bank statements), update ALL active opportunities. For property-specific docs with no deal context, create a CRM manual review task.

## Sources

### Primary (HIGH confidence)
- `@gohighlevel/api-client@2.2.2` SDK type definitions -- `dist/lib/code/opportunities/models/opportunities.d.ts`
  - `SearchOpportunitiesResponseSchema`: confirms `customFields?: CustomFieldResponseSchema[]` on GET
  - `CreateDto`: confirms `customFields?: any[]` on POST
  - `UpdateOpportunityDto`: confirms `customFields?: any[]` on PUT
  - `UpsertOpportunityDto`: confirms NO customFields on upsert (important limitation)
  - `searchOpportunity` params: confirms `contactId`, `pipelineId`, `q`, `limit` as valid search params
  - `customFieldsInputObjectSchema`: confirms `{ id, key?, field_value? }` input format

### Secondary (MEDIUM confidence)
- [Custom Fields V2 API](https://marketplace.gohighlevel.com/docs/ghl/custom-fields/custom-fields-v-2-api/index.html) -- "Only supports Custom Objects and Company (Business) today"
- [n8n Community: Custom Fields Update Not Working](https://community.n8n.io/t/custom-fields-update-in-highlevel-using-highlevel-node-or-http-request-put-not-working/48904) -- confirms `{ id, field_value }` format works via raw HTTP
- [GHL Feature Request: Add Opportunity Custom Fields to API](https://ideas.gohighlevel.com/apis/p/add-opportunities-custom-fields-to-the-api) -- marked "Complete" Sep 2023, but community reports issues through 2024
- [GoHighLevel highlevel-api-docs GitHub](https://github.com/GoHighLevel/highlevel-api-docs) -- official API v2 documentation repo

### Tertiary (LOW confidence)
- [How to Use Custom Fields for Opportunities](https://help.gohighlevel.com/support/solutions/articles/155000000521-how-to-use-custom-fields-for-opportunities) -- GHL support article, UI-focused not API-focused
- [GoHighLevel API Documentation](https://marketplace.gohighlevel.com/docs/) -- JS-rendered docs, could not scrape endpoint details

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new packages, same fetch pattern as existing code
- Architecture: MEDIUM -- patterns are sound but GHL API reliability for opportunity custom fields is uncertain (community reports of historical issues)
- Pitfalls: HIGH -- well-documented from gap analysis session (John van der Woude 3-opportunity case) and community reports
- GHL API compatibility: LOW -- opportunity custom fields were "completed" in 2023 but reported broken through 2024; must validate with live API before implementation

**Critical pre-implementation validation required:**
1. Create one test custom field with `model: 'opportunity'` via legacy API
2. Read a Finmo-created opportunity via `GET /opportunities/:id` and verify customFields are present
3. Write a custom field value to an opportunity via `PUT /opportunities/:id` and verify it persists

**Research date:** 2026-02-21
**Valid until:** 2026-03-07 (14 days -- GHL API stability uncertain, revalidate if delayed)
