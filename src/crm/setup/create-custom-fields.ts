/**
 * One-time setup script: Create doc tracking custom fields in MyBrokerPro.
 *
 * Run with: npx tsx src/crm/setup/create-custom-fields.ts
 *
 * This creates 9 custom fields in the "Finmo Integration" field group
 * and prints the resulting field IDs in .env format for copy-paste.
 *
 * If a field already exists (422/409 error), the script prints a warning
 * and continues with the remaining fields.
 */

import 'dotenv/config';
import { DOC_TRACKING_FIELD_DEFS, FIELD_GROUP_ID } from '../types/index.js';

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
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Creating doc tracking custom fields in MyBrokerPro...');
  console.log(`Location: ${LOCATION_ID}`);
  console.log(`Field Group: ${FIELD_GROUP_ID} (Finmo Integration)`);
  console.log(`Fields to create: ${DOC_TRACKING_FIELD_DEFS.length}`);
  console.log('');

  const results: Array<{ envKey: string; name: string; id: string }> = [];
  const skipped: string[] = [];

  for (const fieldDef of DOC_TRACKING_FIELD_DEFS) {
    console.log(`Creating: ${fieldDef.name} (${fieldDef.dataType})...`);

    const payload: CreateFieldPayload = {
      name: fieldDef.name,
      dataType: fieldDef.dataType,
      model: 'contact',
      parentId: FIELD_GROUP_ID,
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
  console.log('# Doc Tracking Custom Field IDs');

  for (const r of results) {
    console.log(`${r.envKey}=${r.id}`);
  }

  if (skipped.length > 0) {
    console.log('');
    console.log(`# Skipped (already exist or error): ${skipped.join(', ')}`);
    console.log('# To get IDs for skipped fields, run:');
    console.log(`#   curl -H "Authorization: Bearer $GHL_API_KEY" -H "Version: 2021-07-28" \\`);
    console.log(`#     "${BASE_URL}/locations/${LOCATION_ID}/customFields?model=contact" | jq '.customFields[] | select(.parentId == "${FIELD_GROUP_ID}")'`);
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
