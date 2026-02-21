/**
 * One-time setup script: Create doc tracking custom fields in MyBrokerPro.
 *
 * Create contact fields (existing behavior):
 *   npx tsx src/crm/setup/create-custom-fields.ts
 * Create opportunity fields (Phase 10):
 *   npx tsx src/crm/setup/create-custom-fields.ts --model=opportunity
 *
 * This creates 9 custom fields in a "Doc Tracking" (opportunity) or
 * "Finmo Integration" (contact) field group and prints the resulting
 * field IDs in .env format for copy-paste.
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
    parentId: payload.parentId,
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

async function findOrCreateOppFieldGroup(): Promise<string> {
  // Check if a "Doc Tracking" group already exists on opportunities
  const listUrl = `${BASE_URL}/locations/${LOCATION_ID}/customFields?model=opportunity`;
  const listResponse = await fetch(listUrl, { headers });

  if (!listResponse.ok) {
    const body = await listResponse.text();
    throw new Error(`Failed to list opportunity custom fields (${listResponse.status}): ${body}`);
  }

  const listData = (await listResponse.json()) as CustomFieldsListResponse;

  // Groups are custom fields with dataType === 'GROUP'
  const existingGroup = listData.customFields.find(
    (f) => f.dataType === 'GROUP' && f.name === DOC_TRACKING_GROUP_NAME
  );

  if (existingGroup) {
    console.log(`Found existing "${DOC_TRACKING_GROUP_NAME}" group: ${existingGroup.id}`);
    return existingGroup.id;
  }

  // Create a new group
  console.log(`Creating "${DOC_TRACKING_GROUP_NAME}" field group on opportunities...`);
  const createUrl = `${BASE_URL}/locations/${LOCATION_ID}/customFields`;
  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: DOC_TRACKING_GROUP_NAME,
      dataType: 'GROUP',
      model: 'opportunity',
    }),
  });

  if (!createResponse.ok) {
    const body = await createResponse.text();
    throw new Error(
      `Failed to create "${DOC_TRACKING_GROUP_NAME}" group (${createResponse.status}): ${body}`
    );
  }

  const createData = (await createResponse.json()) as CreateFieldResponse;
  console.log(`Created "${DOC_TRACKING_GROUP_NAME}" group: ${createData.customField.id}`);
  return createData.customField.id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Parse --model CLI argument (default: 'contact' for backward compatibility)
  const modelArg = process.argv.find(a => a.startsWith('--model='));
  const model = modelArg ? modelArg.split('=')[1] : 'contact';
  const fieldDefs = model === 'opportunity' ? OPP_DOC_TRACKING_FIELD_DEFS : DOC_TRACKING_FIELD_DEFS;

  console.log(`Creating doc tracking custom fields in MyBrokerPro (model: ${model})...`);
  console.log(`Location: ${LOCATION_ID}`);

  // Resolve the parent group ID
  let parentId: string;
  if (model === 'opportunity') {
    parentId = await findOrCreateOppFieldGroup();
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
