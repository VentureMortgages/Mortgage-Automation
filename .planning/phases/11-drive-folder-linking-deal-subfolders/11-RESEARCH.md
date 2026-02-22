# Phase 11: Drive Folder Linking + Deal Subfolders - Research

**Researched:** 2026-02-21
**Domain:** Google Drive folder management, CRM custom fields, document filing architecture
**Confidence:** HIGH

## Summary

Phase 11 addresses a critical architectural gap: the classification worker currently uses `DRIVE_ROOT_FOLDER_ID` as a catch-all for file resolution, with no connection between the CRM contact's Drive folder and the classification pipeline. The webhook worker already resolves client folders via `buildClientFolderName` + `findOrCreateFolder`, but this folder ID is discarded after the webhook worker completes. Meanwhile, the classification worker (which runs asynchronously when documents arrive later) has no way to find the correct client folder except by falling back to the Drive root.

Phase 10 established opportunity-centric architecture where doc tracking lives on opportunities. Phase 11 extends this by: (1) persisting the client folder ID on the CRM contact, (2) creating deal-specific subfolders per Finmo application for property-specific documents, and (3) teaching the classification worker and Drive scanner to use both the client folder (reusable docs) and deal subfolder (property-specific docs). The DRIVE_STRUCTURE.md analysis confirms Cat creates new folders per deal for repeat clients, meaning the deal subfolder pattern aligns with existing practice.

All required building blocks already exist in the codebase: `findOrCreateFolder`, `resolveTargetFolder`, `PROPERTY_SPECIFIC_TYPES`, `SUBFOLDER_ROUTING`, `getContact`, `upsertContact` with `customFields`, the opportunity search/read API, and the Drive scanner with expiry rules. The work is primarily wiring and refactoring, not greenfield development.

**Primary recommendation:** Store Drive folder ID as a TEXT custom field on the CRM contact. Create deal subfolders named by the Finmo deal reference extracted from the CRM opportunity name (e.g., `BRXM-F050382/`). Route property-specific docs to `deal-subfolder/Subject Property/` and reusable docs to the client folder level. Teach the Drive scanner to check both locations.

## Standard Stack

### Core (Already in Project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| googleapis | existing | Google Drive API v3 client | Already used in `drive-client.ts` |
| google-auth-library | existing | OAuth2/JWT auth for Drive | Already used in `drive-client.ts` |
| GoHighLevel API (raw fetch) | v2021-07-28 | CRM custom field storage | Already used via `crmFetch` in contacts/opportunities |
| bullmq | existing | Queue job data carries folder/deal IDs | Already used in webhook + classification workers |
| vitest | 4.x | Testing with vi.hoisted/vi.mock pattern | Project-wide standard |

### Supporting (No New Dependencies)
No new npm packages needed. All operations use existing Google Drive API methods (`files.list`, `files.create`) and GHL API endpoints (`/contacts/upsert`, `GET /contacts/:id`).

## Architecture Patterns

### Current State (What Exists)

```
Webhook Worker (application submitted):
  1. fetchFinmoApplication(applicationId)
  2. generateChecklist(finmoApp)
  3. buildClientFolderName(borrowers) -> findOrCreateFolder(driveClient, name, rootId)
     -> clientFolderId  [CREATED BUT NOT PERSISTED TO CRM]
  4. scanClientFolder(driveClient, clientFolderId, borrowerFirstNames)
  5. syncChecklistToCrm({ ..., finmoApplicationId })
  6. createEmailDraft(...)
  7. createBudgetSheet(finmoApp, clientFolderId)

Classification Worker (document received later):
  1. classifyDocument(pdfBuffer, filename)
  2. resolveContactId({ senderEmail, borrowerName })
  3. clientFolderId = classificationConfig.driveRootFolderId  [WRONG - uses root, not client folder]
  4. routeToSubfolder(documentType)
  5. resolveTargetFolder(drive, clientFolderId, subfolderTarget, personName)
  6. uploadFile / updateFileContent
  7. updateDocTracking(...)

Drive Scanner (checklist filtering):
  1. scanClientFolder(drive, clientFolderId, borrowerFirstNames)
  2. listClientFolderFiles(drive, clientFolderId)  [ONLY scans client folder + 1 level deep]
  3. filterChecklistByExistingDocs(checklist, existingDocs, currentDate)
     - PROPERTY_SPECIFIC_TYPES are excluded from cross-deal reuse (correct)
     - But scanner doesn't know about deal subfolders (missing)
```

### Target State (Phase 11)

```
Webhook Worker (application submitted):
  1. fetchFinmoApplication(applicationId)
  2. generateChecklist(finmoApp)
  3. buildClientFolderName(borrowers) -> findOrCreateFolder(driveClient, name, rootId)
     -> clientFolderId
  4. [NEW] Store clientFolderId on CRM contact custom field
  5. [NEW] Extract deal reference from opportunity name (e.g., "BRXM-F050382")
  6. [NEW] Create deal subfolder: findOrCreateFolder(driveClient, dealRef, clientFolderId)
     -> dealSubfolderId
  7. [NEW] Store dealSubfolderId on CRM opportunity custom field
  8. scanClientFolder + scanDealSubfolder (both locations)
  9. syncChecklistToCrm({ ..., finmoApplicationId })
  10. createEmailDraft(...)
  11. createBudgetSheet(finmoApp, clientFolderId)

Classification Worker (document received later):
  1. classifyDocument(pdfBuffer, filename)
  2. resolveContactId({ senderEmail, borrowerName })
  3. [CHANGED] Read clientFolderId from CRM contact custom field
  4. [CHANGED] If property-specific doc:
       Read dealSubfolderId from CRM opportunity
       Route to deal subfolder (e.g., "BRXM-F050382/Subject Property/")
     Else (reusable doc):
       Route to client folder level (e.g., "Albrecht, Terry|Kathy/Terry/")
  5. [FALLBACK] If no folder ID on contact: use DRIVE_ROOT_FOLDER_ID (backward compat)
  6. uploadFile / updateFileContent
  7. updateDocTracking(...)

Drive Scanner (checklist filtering):
  1. [CHANGED] scanClientFolder(drive, clientFolderId, borrowerFirstNames)
     - Scans client-level subfolders (person, down payment, etc.) for reusable docs
  2. [NEW] scanDealSubfolder(drive, dealSubfolderId, borrowerFirstNames)
     - Scans deal subfolder (subject property, etc.) for property-specific docs
  3. filterChecklistByExistingDocs(checklist, [...clientDocs, ...dealDocs], currentDate)
```

### Recommended Project Structure Changes

```
src/
  crm/
    config.ts              # Add driveFolderIdFieldId, oppDealSubfolderIdFieldId
    contacts.ts            # Add getContactDriveFolderId helper
    types/index.ts         # Add new field definitions for setup script
    setup/
      create-custom-fields.ts  # Add Drive folder ID field creation
  classification/
    classification-worker.ts     # Read folder ID from CRM contact, route property docs to deal subfolder
    types.ts               # No changes needed (applicationId already in ClassificationJobData)
  drive/
    folder-scanner.ts      # Add scanDealSubfolder (parallel to scanClientFolder)
    checklist-filter.ts    # No changes needed (already accepts ExistingDoc[])
  webhook/
    worker.ts              # Store folder IDs to CRM, create deal subfolder
```

### Pattern 1: CRM Custom Field for Drive Folder ID

**What:** Store the Google Drive folder ID as a TEXT custom field on the CRM contact and opportunity.
**When to use:** Every time the webhook worker creates/resolves a client folder or deal subfolder.
**Why TEXT not URL:** It's an opaque Google Drive ID (e.g., `1g6UIKA5hk1oNSotiTA89z2m65yNIBTn0`), not a human-readable value. TEXT is simplest.

```typescript
// Contact: store client folder ID
await upsertContact({
  email: borrowerEmail,
  firstName: borrowerFirstName,
  lastName: borrowerLastName,
  customFields: [
    { id: crmConfig.driveFolderIdFieldId, field_value: clientFolderId },
  ],
});

// Opportunity: store deal subfolder ID
await updateOpportunityFields(opportunityId, [
  { id: crmConfig.oppDealSubfolderIdFieldId, field_value: dealSubfolderId },
]);
```

### Pattern 2: Deal Subfolder Naming from Opportunity Name

**What:** Extract the Finmo deal reference from the CRM opportunity name. Finmo creates opportunities with names like `John - BRXM-F050382`. The `BRXM-F050382` portion is the human-readable deal reference.
**Source evidence:** Test fixtures in `src/crm/__tests__/opportunities.test.ts` show opportunity names in this format.
**Extraction strategy:** Parse the opportunity name after ` - ` to get the deal reference.
**Fallback:** If the opportunity name doesn't follow this pattern, use the Finmo application UUID (first 8 chars).

```typescript
// Extract deal reference from opportunity name: "John - BRXM-F050382" -> "BRXM-F050382"
function extractDealReference(opportunityName: string | undefined, fallbackId: string): string {
  if (opportunityName) {
    const dashIdx = opportunityName.lastIndexOf(' - ');
    if (dashIdx >= 0) {
      const ref = opportunityName.slice(dashIdx + 3).trim();
      if (ref.length > 0) return ref;
    }
  }
  return fallbackId.slice(0, 8);
}
```

**Why not the Finmo API:** The `FinmoApplication` type has `id` (UUID) but no short `referenceId` field. The short deal reference (`BRXM-F050382`) is created by Finmo when it syncs to GHL and is only available on the opportunity name. The webhook `applicationId` from JobData needs verification -- it may be this short reference or the UUID.

### Pattern 3: Folder ID Resolution in Classification Worker

**What:** Read the client's Drive folder ID from CRM instead of using the global root folder.
**Fallback chain:** CRM contact field -> DRIVE_ROOT_FOLDER_ID -> manual review.

```typescript
// In classification worker, after resolving contactId:
let clientFolderId: string | null = null;

if (contactId) {
  const contact = await getContact(contactId);
  clientFolderId = getContactDriveFolderId(contact, crmConfig.driveFolderIdFieldId);
}

// Fallback to root folder
if (!clientFolderId) {
  clientFolderId = classificationConfig.driveRootFolderId || null;
}
```

### Pattern 4: Deal Subfolder for Property-Specific Docs

**What:** When filing a property-specific doc, resolve to the deal subfolder instead of the client folder.
**Uses existing:** `PROPERTY_SPECIFIC_TYPES` set from `doc-expiry.ts` already defines which docs are deal-specific.

```typescript
const isPropertySpecific = PROPERTY_SPECIFIC_TYPES.has(classification.documentType);

if (isPropertySpecific && dealSubfolderId) {
  // Route within the deal subfolder
  targetFolderId = await resolveTargetFolder(drive, dealSubfolderId, subfolderTarget, personName);
} else {
  // Route within the client folder (reusable docs)
  targetFolderId = await resolveTargetFolder(drive, clientFolderId, subfolderTarget, personName);
}
```

### Pattern 5: Shared getContact Call to Avoid Extra API Calls

**What:** The classification worker already resolves a contactId (via `resolveContactId`), then `updateDocTracking` calls `getContact` again. Rather than adding a third `getContact` call for folder resolution, share the contact record across stages.

```typescript
// Resolve contact ONCE, share across folder resolution and tracking
let contact: CrmContact | null = null;
if (contactId) {
  contact = await getContact(contactId);
}

// Use contact for folder resolution
const clientFolderId = contact
  ? getContactDriveFolderId(contact, crmConfig.driveFolderIdFieldId)
  : null;

// Pass contact to tracking-sync (refactor updateDocTracking to accept pre-fetched contact)
```

### Anti-Patterns to Avoid

- **Searching Drive by folder name at classification time:** Folder names are inconsistent (DRIVE_STRUCTURE.md documents this extensively). Always use the stored folder ID from CRM, never folder name search.
- **Storing folder ID only on opportunity:** The client folder is shared across deals. The folder ID must be on the **contact** (shared) while the deal subfolder ID goes on the **opportunity** (per-deal).
- **Creating all subfolders upfront:** DRIVE_STRUCTURE.md notes that subfolders evolve as deals progress. Create subfolders lazily via `findOrCreateFolder` when needed.
- **Modifying folder scanner to recurse arbitrarily deep:** The current 1-level scan is deliberate and efficient. Add a targeted `scanDealSubfolder` function instead of making the scanner recursive.
- **Calling getContact multiple times per job:** CRM API has rate limits. Fetch the contact once and pass it around.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Client folder creation | New folder creation logic | Existing `findOrCreateFolder` in `filer.ts` | Already idempotent and handles duplicates |
| Property-specific vs reusable routing | New routing table | Existing `PROPERTY_SPECIFIC_TYPES` from `doc-expiry.ts` | Single source of truth, already used by tracking-sync |
| Contact custom field access | Direct API call construction | Existing `getContact` + `upsertContact` in `contacts.ts` | Auth headers, error classification already handled |
| Opportunity field access | New API functions | Existing `getOpportunityFieldValue`, `updateOpportunityFields` | Already handles the typed field format |
| Drive folder search | Custom search logic | Existing `findFolder` in `filer.ts` | Already escapes queries and handles pagination |
| Deal reference extraction | New Finmo API call | Parse opportunity name from CRM | The BRXM reference is only in the GHL opportunity name |

**Key insight:** Phase 11 is primarily a wiring/integration phase. Nearly every building block exists. The work is connecting them correctly and adding two custom fields (contact-level folder ID, opportunity-level deal subfolder ID).

## Common Pitfalls

### Pitfall 1: Race Condition on Client Folder Creation
**What goes wrong:** Two simultaneous Finmo applications for different deals from the same client could both try to create the client folder.
**Why it happens:** Worker concurrency is 1, so this is unlikely with the current webhook worker, but the classification worker could also resolve folders.
**How to avoid:** `findOrCreateFolder` is already idempotent (find-first pattern). Two concurrent calls may create two folders briefly, but the first one found wins. For the webhook worker (concurrency 1), this is a non-issue.
**Warning signs:** Multiple folders with the same name under the same parent.

### Pitfall 2: Deal Subfolder vs Client Subfolder Confusion
**What goes wrong:** `Subject Property/` subfolder could exist at both client level (old docs from before Phase 11) and deal level (new filing target), causing confusion about where to look.
**Why it happens:** Phase 11 changes where property docs are filed without migrating existing files.
**How to avoid:** For **new** applications, property docs go in `deal-subfolder/Subject Property/`. The Drive scanner checks **both** locations. No migration of existing files needed. The client-level `Subject Property/` folder contains old-deal docs that the expiry rules will naturally exclude.
**Warning signs:** Drive scanner missing docs that exist in the client-level Subject Property folder from an older deal.

### Pitfall 3: Missing Deal Subfolder ID on Opportunity
**What goes wrong:** Classification worker receives a property-specific doc but can't find the deal subfolder because the opportunity doesn't have the field set.
**Why it happens:** The opportunity may have been created by Finmo before Phase 11 was deployed, or the webhook worker failed between creating the subfolder and writing the ID to CRM.
**How to avoid:** Graceful fallback chain: (1) try deal subfolder from opportunity, (2) fall back to client folder, (3) fall back to `DRIVE_ROOT_FOLDER_ID`. Never fail just because a deal subfolder isn't found.
**Warning signs:** Property-specific docs being filed at client level instead of deal level (logged but not fatal).

### Pitfall 4: Opportunity Name Format Varies
**What goes wrong:** The deal reference extraction from opportunity name fails because the name format isn't `Name - BRXM-XXXXXX`.
**Why it happens:** Finmo may change the opportunity naming format, or older opportunities may have different formats.
**How to avoid:** Use the webhook `applicationId` (from `JobData`) as the primary deal reference. Only use opportunity name parsing as a secondary strategy if `applicationId` is a UUID and we need a short name. Fall back gracefully to UUID-based naming.
**Warning signs:** Deal subfolders named with UUIDs or empty names.

### Pitfall 5: CRM API Rate Limits on Extra Calls
**What goes wrong:** Adding a `getContact` call to the classification worker (to read folder ID) adds an API call per document processed.
**Why it happens:** The classification worker currently calls `resolveContactId` (1-2 API calls) then `getContact` is called by `updateDocTracking`. Adding another `getContact` early in the pipeline doubles the read calls.
**How to avoid:** Fetch the contact record once after `resolveContactId` succeeds, then share it with both folder resolution and `updateDocTracking`. Refactor `updateDocTracking` to accept a pre-fetched contact as an optional parameter.
**Warning signs:** 429 rate limit errors from GHL API.

### Pitfall 6: Backward Compatibility Break
**What goes wrong:** Existing contacts without the Drive folder ID field, or existing opportunities without the deal subfolder field, cause errors.
**Why it happens:** Phase 11 adds new fields that don't exist on existing records.
**How to avoid:** All reads must treat missing/empty field values as null and fall back gracefully. The setup script creates the fields but doesn't backfill existing records. Custom field `find` on empty `customFields` array returns `undefined` -- this is safe.
**Warning signs:** Errors reading `undefined` custom field values.

## Code Examples

### Reading Custom Field from CRM Contact

```typescript
// Source: existing pattern in tracking-sync.ts parseContactTrackingFields
function getContactDriveFolderId(contact: CrmContact, fieldId: string): string | null {
  const field = contact.customFields.find((f) => f.id === fieldId);
  if (!field || !field.value || typeof field.value !== 'string') {
    return null;
  }
  return field.value;
}
```

### Writing Custom Field to CRM Contact (upsertContact pattern)

```typescript
// Source: existing pattern in webhook/worker.ts + contacts.ts
// The upsertContact call already happens in the webhook worker for CRM sync.
// Add the driveFolderId to the customFields array in that existing call.
await upsertContact({
  email: mainBorrower.email,
  firstName: mainBorrower.firstName,
  lastName: mainBorrower.lastName,
  customFields: [
    { id: crmConfig.driveFolderIdFieldId, field_value: clientFolderId },
  ],
});
```

### Creating Deal Subfolder

```typescript
// Source: existing findOrCreateFolder in filer.ts
// Extract deal reference from opportunity name or use applicationId
const dealRef = extractDealReference(opportunity?.name, applicationId);
const dealSubfolderId = await findOrCreateFolder(
  getDriveClient(),
  dealRef,
  clientFolderId,
);
```

### Classification Worker - Folder Resolution Chain

```typescript
// Fallback chain: CRM contact field -> DRIVE_ROOT_FOLDER_ID -> manual review
let clientFolderId: string | null = null;
let dealSubfolderId: string | null = null;

// Fetch contact ONCE (shared with tracking-sync later)
let contact: CrmContact | null = null;
if (contactId) {
  contact = await getContact(contactId);
  clientFolderId = getContactDriveFolderId(contact, crmConfig.driveFolderIdFieldId);
}

// For property-specific docs, also resolve deal subfolder from opportunity
if (PROPERTY_SPECIFIC_TYPES.has(classification.documentType) && contactId && applicationId) {
  try {
    const opp = await findOpportunityByFinmoId(contactId, PIPELINE_IDS.LIVE_DEALS, applicationId);
    if (opp) {
      dealSubfolderId = getOpportunityFieldValue(opp, crmConfig.oppDealSubfolderIdFieldId) as string | undefined ?? null;
    }
  } catch {
    // Non-fatal: fall back to client folder
  }
}

// Fallback to global root folder
if (!clientFolderId && classificationConfig.driveRootFolderId) {
  clientFolderId = classificationConfig.driveRootFolderId;
}
```

### Drive Scanner - Dual Location Scan

```typescript
// Source: extends existing scanClientFolder pattern
// Scan client-level for reusable docs
const clientDocs = await scanClientFolder(drive, clientFolderId, borrowerFirstNames);

// Scan deal-level for property-specific docs (if deal subfolder exists)
let dealDocs: ExistingDoc[] = [];
if (dealSubfolderId) {
  // scanDealSubfolder uses same listClientFolderFiles internally
  // but scoped to the deal subfolder
  dealDocs = await scanClientFolder(drive, dealSubfolderId, borrowerFirstNames);
}

// Combine and filter - checklist-filter.ts already handles PROPERTY_SPECIFIC_TYPES
const allDocs = [...clientDocs, ...dealDocs];
const filterResult = filterChecklistByExistingDocs(checklist, allDocs, new Date());
```

### Setup Script - New Custom Field Definitions

```typescript
// New field definitions (same pattern as DOC_TRACKING_FIELD_DEFS)
// Contact-level: client Drive folder ID
{
  envKey: 'GHL_FIELD_DRIVE_FOLDER_ID',
  name: 'Drive Folder ID',
  dataType: 'TEXT' as const,
}

// Opportunity-level: deal subfolder ID
{
  envKey: 'GHL_OPP_FIELD_DEAL_SUBFOLDER_ID',
  name: 'Deal Subfolder ID',
  dataType: 'TEXT' as const,
}
```

## State of the Art

| Old Approach (Current) | New Approach (Phase 11) | Impact |
|------------------------|------------------------|--------|
| `DRIVE_ROOT_FOLDER_ID` as fallback for all filing | CRM contact stores client folder ID | Classification worker files to correct client folder |
| No deal-level separation | Deal subfolder per Finmo application | Property docs isolated per deal |
| Scanner checks client folder only | Scanner checks client + deal folder | Accurate "already on file" detection for property docs |
| Folder resolution is best-effort | Folder ID is authoritative from CRM | Reliable filing, no guessing |
| `getContact` called redundantly | Single getContact call shared across stages | Fewer API calls, respects rate limits |

## Requirement Traceability

| Requirement | Implementation Approach |
|-------------|----------------------|
| DRIVE-01: Client folder ID on CRM contact | New TEXT custom field on contact, written by webhook worker after `findOrCreateFolder` |
| DRIVE-02: Classification worker reads folder from contact | `getContact` -> read `driveFolderIdFieldId` -> use as base for filing |
| DRIVE-03: Deal subfolder per Finmo application | `findOrCreateFolder(drive, dealRef, clientFolderId)` in webhook worker; ID stored on opportunity |
| DRIVE-04: Reusable docs at client folder level | `PROPERTY_SPECIFIC_TYPES.has(docType)` check: if false -> route to client folder subfolders |
| DRIVE-05: Deal-specific docs in deal subfolder | `PROPERTY_SPECIFIC_TYPES.has(docType)` check: if true -> route to deal subfolder |
| DRIVE-06: Scanner checks both locations | `scanClientFolder(clientId)` + `scanClientFolder(dealSubfolderId)` -> merge results |
| DRIVE-07: Fallback to DRIVE_ROOT_FOLDER_ID | Existing config fallback preserved when CRM field is empty/missing |

## Finmo Deal Reference ID

**Verified finding:** The Finmo deal reference (e.g., `BRXM-F050382`) is NOT in the Finmo API response type (`FinmoApplication` has `id: string` which is a UUID). The short reference comes from the **CRM opportunity name**, which Finmo creates in the format `BorrowerName - BRXM-XXXXXX`.

**Evidence:**
- `src/checklist/types/finmo.ts` - `FinmoApplication.id` is a UUID, no `referenceId` field exists
- `src/crm/__tests__/opportunities.test.ts` - Test fixtures show opportunity names like `John - BRXM-F050382`
- `src/webhook/worker.ts` line 155 - `finmoDealId: applicationId` (the webhook `applicationId`)
- `EXISTING_OPP_FIELDS.FINMO_DEAL_ID` on opportunities - Finmo stores its own deal ID as a custom field

**Strategy for deal subfolder naming:**
1. After finding the opportunity (via `findOpportunityByFinmoId`), read the opportunity name
2. Extract the deal reference after ` - ` separator
3. If extraction fails, use the `FINMO_DEAL_ID` custom field from the opportunity
4. Last fallback: use the Finmo application UUID (first 8 chars)

**Alternative simpler strategy:** Use the `applicationId` from the webhook payload directly. Need to verify if this is the UUID or the short reference (the webhook `extractApplicationId` function suggests it could be either format). If it turns out to be the UUID, the opportunity name parsing is the reliable source.

## Open Questions

1. **What format is the webhook `applicationId`?**
   - What we know: `extractApplicationId` tries multiple payload shapes. The `finmoDealId` in checklist-sync is set to this value. The `finmoApp.application.id` is the UUID.
   - What's unclear: Whether the webhook provides the short reference (BRXM-F050382) or the UUID
   - Recommendation: During implementation, log both `applicationId` (from webhook) and `finmoApp.application.id` (from Finmo API) to compare. The deal reference for folder naming should be human-readable.
   - Impact: LOW -- fallback to opportunity name parsing or UUID-based naming works either way.

2. **Should existing client folders be backfilled with folder IDs?**
   - What we know: ~168 client folders exist in Drive. Webhook worker only processes new applications.
   - What's unclear: Whether a one-time backfill script is needed for active deals
   - Recommendation: Don't backfill. New applications get folder IDs automatically. Old applications use `DRIVE_ROOT_FOLDER_ID` fallback. Add a backfill script only if Cat reports issues.

3. **Gift letter routing: deal subfolder or client-level Down Payment?**
   - What we know: Gift letter is in `PROPERTY_SPECIFIC_TYPES` (not reusable across deals) AND in `SUBFOLDER_ROUTING` as `down_payment`
   - What's unclear: Should it go in `deal-subfolder/Down Payment/` or client-level `Down Payment/`?
   - Recommendation: Since gift letters are deal-specific (correctly in PROPERTY_SPECIFIC_TYPES), route them to the deal subfolder level. The existing `resolveTargetFolder` function creates subfolders within whatever base folder you pass it, so routing to `deal-subfolder/Down Payment/` requires no filer changes -- just pass the deal subfolder ID instead of the client folder ID.

## Sources

### Primary (HIGH confidence)
- Project codebase: `src/classification/classification-worker.ts` - Current folder resolution logic (TODO comment on line 130 confirms this is known gap)
- Project codebase: `src/drive/doc-expiry.ts` - PROPERTY_SPECIFIC_TYPES definition (7 types: purchase_agreement, mls_listing, property_tax_bill, home_insurance, gift_letter, lease_agreement, mortgage_statement)
- Project codebase: `src/classification/filer.ts` - findOrCreateFolder, resolveTargetFolder (all folder CRUD operations)
- Project codebase: `src/classification/types.ts` - SUBFOLDER_ROUTING (maps all 36 doc types to subfolder targets)
- Project codebase: `src/crm/contacts.ts` - getContact, upsertContact with customFields (auth + error handling)
- Project codebase: `src/crm/opportunities.ts` - getOpportunityFieldValue, updateOpportunityFields, findOpportunityByFinmoId
- Project codebase: `src/crm/tracking-sync.ts` - updateDocTracking orchestrator (calls getContact internally)
- Project codebase: `src/webhook/worker.ts` - Current webhook pipeline flow (steps 1-10)
- Project codebase: `src/checklist/types/finmo.ts` - FinmoApplication type (id is UUID, no referenceId)
- Project codebase: `src/crm/__tests__/opportunities.test.ts` - Opportunity name format `Name - BRXM-F050382`
- Project codebase: `.planning/DRIVE_STRUCTURE.md` - Drive folder analysis (repeat clients = new folder per deal, ~168 folders, naming conventions)

### Secondary (MEDIUM confidence)
- [GoHighLevel Custom Fields API](https://marketplace.gohighlevel.com/docs/ghl/locations/create-custom-field/index.html) - TEXT field creation via same legacy API used for existing fields
- [GoHighLevel Update Contact API](https://marketplace.gohighlevel.com/docs/ghl/contacts/update-contact/index.html) - Custom field updates on contacts

### Tertiary (LOW confidence)
- Finmo webhook `applicationId` format -- needs validation with actual webhook payloads to determine if it's UUID or short reference

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, no new dependencies
- Architecture: HIGH - Patterns follow existing codebase conventions exactly
- CRM custom fields: HIGH - Uses same pattern as existing doc tracking fields (9 fields created in Phase 4/10)
- Drive operations: HIGH - Uses existing `findOrCreateFolder`, `resolveTargetFolder`
- Deal subfolder naming: MEDIUM - Opportunity name parsing strategy is evidence-based but needs runtime verification
- Finmo deal reference: LOW - Need to verify webhook payload format
- Pitfalls: HIGH - Based on direct codebase analysis and documented issues (DRIVE_STRUCTURE.md)

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (stable domain, no external dependency changes expected)
