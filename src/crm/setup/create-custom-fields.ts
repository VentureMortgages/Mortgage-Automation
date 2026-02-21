/**
 * One-time setup script: Create doc tracking custom fields in MyBrokerPro.
 *
 * Create contact fields (existing behavior):
 *   npx tsx src/crm/setup/create-custom-fields.ts
 * Create opportunity fields (Phase 10):
 *   npx tsx src/crm/setup/create-custom-fields.ts --model=opportunity
 * Deprecate contact-level doc tracking fields (Phase 10):
 *   npx tsx src/crm/setup/create-custom-fields.ts --deprecate-contact-fields
 *
 * This creates 9 custom fields in a "Doc Tracking" (opportunity) or
 * "Finmo Integration" (contact) field group and prints the resulting
 * field IDs in .env format for copy-paste.
 *
 * The --deprecate-contact-fields flag renames the 9 contact-level doc tracking
 * fields to "DEPRECATED - [name]" via PUT API, marking them as obsolete in the
 * MyBrokerPro UI. Field IDs remain valid (rename does not change IDs).
 *
 * If a field already exists (422/409 error), the script prints a warning
 * and continues with the remaining fields.
 */

import 'dotenv/config';
import { DOC_TRACKING_FIELD_DEFS, OPP_DOC_TRACKING_FIELD_DEFS, FIELD_GROUP_ID } from '../types/index.js';

const API_KEY = process.env.GHL_API_KEY;
const BASE_URL = process.env.GHL_BASE_URL ?? 'https://services.leadconnectorhq.com';
const LOCATION_ID = process.env.GHL_LOCATION_ID;

if (!API_KEY) {
  console.error('ERROR: GHL_API_KEY is not set in .env');
  console.error('Copy .env.example to .env and fill in GHL_API_KEY with your Private Integration Token.');
  process.exit(1);
}

if (!LOCATION_ID) {
  console.error('ERROR: GHL_LOCATION_ID is not set in .env');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Version': '2021-07-28',
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateFieldPayload {
  name: string;
  dataType: string;
  model: string;
  parentId: string;
  options?: string[];
}

interface CreateFieldResponse {
  customField: {
    id: string;
    name: string;
    fieldKey: string;
    dataType: string;
  };
}

interface CustomFieldRecord {
  id: string;
  name: string;
  dataType: string;
  parentId?: string;
}

interface CustomFieldsListResponse {
  customFields: CustomFieldRecord[];
}

// ---------------------------------------------------------------------------
// Create a single custom field
// ---------------------------------------------------------------------------

async function createField(
  payload: CreateFieldPayload
): Promise<{ id: string; name: string } | null> {
  const url = `${BASE_URL}/locations/${LOCATION_ID}/customFields`;

  const body: Record<string, unknown> = {
    name: payload.name,
    dataType: payload.dataType,
    model: payload.model,
    ...(payload.parentId ? { parentId: payload.parentId } : {}),
  };

  if (payload.options && payload.options.length > 0) {
    body.options = [...payload.options];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const status = response.status;
    const responseBody = await response.text();

    // 409 Conflict or 422 Unprocessable often means field already exists
    if (status === 409 || status === 422) {
      console.error(`WARNING: Field "${payload.name}" may already exist (${status}). Skipping.`);
      console.error(`  Response: ${responseBody}`);
      return null;
    }

    // 400 Bad Request could also mean duplicate name
    if (status === 400 && responseBody.toLowerCase().includes('already exists')) {
      console.error(`WARNING: Field "${payload.name}" already exists. Skipping.`);
      return null;
    }

    throw new Error(
      `Failed to create field "${payload.name}" (${status}): ${responseBody}`
    );
  }

  const data = (await response.json()) as CreateFieldResponse;
  return {
    id: data.customField.id,
    name: data.customField.name,
  };
}

// ---------------------------------------------------------------------------
// Find or create a field group on opportunities
// ---------------------------------------------------------------------------

const DOC_TRACKING_GROUP_NAME = 'Doc Tracking';

/**
 * Known opportunity field group: Finmo Integration (already exists in GHL).
 * GHL API does not support creating field groups (dataType='GROUP') on opportunities,
 * so we use this existing group. If it doesn't work, fields are created without a group.
 */
const OPP_FINMO_INTEGRATION_GROUP_ID = 'FULgVWPY3FAigzC5MLP3';

async function findOppFieldGroup(): Promise<string> {
  // Verify the known group exists
  const listUrl = `${BASE_URL}/locations/${LOCATION_ID}/customFields?model=opportunity`;
  const listResponse = await fetch(listUrl, { headers });

  if (!listResponse.ok) {
    const body = await listResponse.text();
    throw new Error(`Failed to list opportunity custom fields (${listResponse.status}): ${body}`);
  }

  const listData = (await listResponse.json()) as CustomFieldsListResponse;

  // Look for existing Doc Tracking group first
  const docTrackingGroup = listData.customFields.find(
    (f) => f.name === DOC_TRACKING_GROUP_NAME && !f.parentId
  );
  if (docTrackingGroup) {
    console.log(`Found existing "${DOC_TRACKING_GROUP_NAME}" group: ${docTrackingGroup.id}`);
    return docTrackingGroup.id;
  }

  // Fall back to Finmo Integration group
  const finmoGroup = listData.customFields.find(
    (f) => f.id === OPP_FINMO_INTEGRATION_GROUP_ID
  );
  if (finmoGroup) {
    console.log(`Using existing "Finmo Integration" group: ${OPP_FINMO_INTEGRATION_GROUP_ID}`);
    return OPP_FINMO_INTEGRATION_GROUP_ID;
  }

  // No group found — create fields without parentId
  console.log('WARNING: No suitable field group found. Fields will be created at root level.');
  return '';
}

// ---------------------------------------------------------------------------
// Deprecate contact-level fields (Phase 10)
// ---------------------------------------------------------------------------

/** Env key -> GHL_FIELD_* env var mapping for contact-level doc tracking fields */
const CONTACT_FIELD_ENV_MAP: Record<string, string> = {
  GHL_FIELD_DOC_STATUS_ID: 'Doc Collection Status',
  GHL_FIELD_DOC_REQUEST_SENT_ID: 'Doc Request Sent Date',
  GHL_FIELD_MISSING_DOCS_ID: 'Missing Docs',
  GHL_FIELD_RECEIVED_DOCS_ID: 'Received Docs',
  GHL_FIELD_PRE_TOTAL_ID: 'PRE Docs Total',
  GHL_FIELD_PRE_RECEIVED_ID: 'PRE Docs Received',
  GHL_FIELD_FULL_TOTAL_ID: 'FULL Docs Total',
  GHL_FIELD_FULL_RECEIVED_ID: 'FULL Docs Received',
  GHL_FIELD_LAST_DOC_RECEIVED_ID: 'Last Doc Received Date',
};

/**
 * Renames contact-level doc tracking fields to "DEPRECATED - [name]" in MBP.
 * Uses PUT /locations/:locationId/customFields/:fieldId to rename each field.
 * Field IDs remain valid after rename (only the display name changes).
 */
async function deprecateContactFields(): Promise<void> {
  console.log('Deprecating contact-level doc tracking fields...');
  console.log(`Location: ${LOCATION_ID}`);
  console.log('');

  let renamed = 0;
  let skipped = 0;

  for (const [envKey, originalName] of Object.entries(CONTACT_FIELD_ENV_MAP)) {
    const fieldId = process.env[envKey];

    if (!fieldId) {
      console.warn(`  SKIP: ${envKey} not set in .env (field "${originalName}")`);
      skipped++;
      continue;
    }

    const newName = `DEPRECATED - ${originalName}`;
    const url = `${BASE_URL}/locations/${LOCATION_ID}/customFields/${fieldId}`;

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name: newName }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`  ERROR: Failed to rename "${originalName}" (${response.status}): ${body}`);
        skipped++;
        continue;
      }

      console.log(`  Renamed "${originalName}" -> "${newName}" (fieldId: ${fieldId})`);
      renamed++;
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log(`Done. Renamed: ${renamed}, Skipped: ${skipped}`);
  console.log('='.repeat(60));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Check for --deprecate-contact-fields flag (run deprecation and exit early)
  if (process.argv.includes('--deprecate-contact-fields')) {
    await deprecateContactFields();
    return;
  }

  // Parse --model CLI argument (default: 'contact' for backward compatibility)
  const modelArg = process.argv.find(a => a.startsWith('--model='));
  const model = modelArg ? modelArg.split('=')[1] : 'contact';
  const fieldDefs = model === 'opportunity' ? OPP_DOC_TRACKING_FIELD_DEFS : DOC_TRACKING_FIELD_DEFS;

  console.log(`Creating doc tracking custom fields in MyBrokerPro (model: ${model})...`);
  console.log(`Location: ${LOCATION_ID}`);

  // Resolve the parent group ID
  let parentId: string;
  if (model === 'opportunity') {
    parentId = await findOppFieldGroup();
  } else {
    parentId = FIELD_GROUP_ID;
  }

  console.log(`Field Group: ${parentId}${model === 'contact' ? ' (Finmo Integration)' : ` (${DOC_TRACKING_GROUP_NAME})`}`);
  console.log(`Fields to create: ${fieldDefs.length}`);
  console.log('');

  const results: Array<{ envKey: string; name: string; id: string }> = [];
  const skipped: string[] = [];

  for (const fieldDef of fieldDefs) {
    console.log(`Creating: ${fieldDef.name} (${fieldDef.dataType})...`);

    const payload: CreateFieldPayload = {
      name: fieldDef.name,
      dataType: fieldDef.dataType,
      model,
      parentId,
      ...('options' in fieldDef && fieldDef.options
        ? { options: [...fieldDef.options] }
        : {}),
    };

    const result = await createField(payload);

    if (result) {
      console.log(`  Created: ${result.name} -> ${result.id}`);
      results.push({ envKey: fieldDef.envKey, name: result.name, id: result.id });
    } else {
      skipped.push(fieldDef.name);
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Copy the following into your .env file:');
  console.log('='.repeat(60));
  console.log('');
  console.log(`# Doc Tracking Custom Field IDs (${model})`);

  for (const r of results) {
    console.log(`${r.envKey}=${r.id}`);
  }

  if (skipped.length > 0) {
    console.log('');
    console.log(`# Skipped (already exist or error): ${skipped.join(', ')}`);
    console.log('# To get IDs for skipped fields, run:');
    console.log(`#   curl -H "Authorization: Bearer $GHL_API_KEY" -H "Version: 2021-07-28" \\`);
    console.log(`#     "${BASE_URL}/locations/${LOCATION_ID}/customFields?model=${model}" | jq '.customFields[] | select(.parentId == "${parentId}")'`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log(`Done. Created: ${results.length}, Skipped: ${skipped.length}`);
  console.log('='.repeat(60));
}

main().catch((err: unknown) => {
  console.error('Script failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
