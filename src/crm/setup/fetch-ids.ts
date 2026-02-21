/**
 * One-time setup script: Fetch user IDs, pipeline stage IDs, and custom field IDs from MyBrokerPro.
 *
 * Run with: npx tsx src/crm/setup/fetch-ids.ts
 *
 * Output: .env-formatted lines for copy-paste into your .env file.
 * This script does NOT modify any data in the CRM.
 *
 * Lists:
 *   - Pipeline stage IDs (Finmo Leads + Live Deals)
 *   - User IDs (Taylor + Cat)
 *   - Opportunity doc tracking custom field IDs (GHL_OPP_FIELD_*)
 */

import 'dotenv/config';
import { PIPELINE_IDS, OPP_DOC_TRACKING_FIELD_DEFS } from '../types/index.js';

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
// Fetch Pipelines + Stages
// ---------------------------------------------------------------------------

interface PipelineStage {
  id: string;
  name: string;
  position?: number;
}

interface Pipeline {
  id: string;
  name: string;
  stages: PipelineStage[];
}

interface PipelinesResponse {
  pipelines: Pipeline[];
}

async function fetchPipelines(): Promise<Pipeline[]> {
  const url = `${BASE_URL}/opportunities/pipelines?locationId=${LOCATION_ID}`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch pipelines (${response.status}): ${body}`);
  }

  const data = (await response.json()) as PipelinesResponse;
  return data.pipelines ?? [];
}

function findStage(pipeline: Pipeline, stageName: string): PipelineStage | undefined {
  // GHL stage names may have a leading '*' prefix — strip it for comparison
  return pipeline.stages.find(
    (s) => s.name.replace(/^\*/, '').trim().toLowerCase() === stageName.toLowerCase()
  );
}

// ---------------------------------------------------------------------------
// Fetch Users
// ---------------------------------------------------------------------------

interface GhlUser {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  deleted?: boolean;
}

interface UsersResponse {
  users: GhlUser[];
}

async function fetchUsers(): Promise<GhlUser[]> {
  const url = `${BASE_URL}/users/?locationId=${LOCATION_ID}`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch users (${response.status}): ${body}`);
  }

  const data = (await response.json()) as UsersResponse;
  return data.users ?? [];
}

// ---------------------------------------------------------------------------
// Fetch Custom Fields (Opportunity)
// ---------------------------------------------------------------------------

interface CustomField {
  id: string;
  name: string;
  dataType: string;
  parentId?: string;
}

interface CustomFieldsResponse {
  customFields: CustomField[];
}

async function fetchCustomFields(model: string): Promise<CustomField[]> {
  const url = `${BASE_URL}/locations/${LOCATION_ID}/customFields?model=${model}`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch ${model} custom fields (${response.status}): ${body}`);
  }

  const data = (await response.json()) as CustomFieldsResponse;
  return data.customFields ?? [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Fetching pipeline, user, and custom field data from MyBrokerPro...\n');

  // -- Pipelines --
  const pipelines = await fetchPipelines();

  const leadsPipeline = pipelines.find((p) => p.id === PIPELINE_IDS.FINMO_LEADS);
  const liveDeals = pipelines.find((p) => p.id === PIPELINE_IDS.LIVE_DEALS);

  let appReceivedId = '';
  let collectingDocsId = '';
  let allDocsReceivedId = '';

  if (leadsPipeline) {
    const appReceived = findStage(leadsPipeline, 'Application Received');
    if (appReceived) {
      appReceivedId = appReceived.id;
    } else {
      console.error('WARNING: Stage "Application Received" not found in Finmo - Leads pipeline.');
      console.error('Available stages:');
      leadsPipeline.stages.forEach((s) => console.error(`  - "${s.name}" (${s.id})`));
    }
  } else {
    console.error(`WARNING: Pipeline "Finmo - Leads" (${PIPELINE_IDS.FINMO_LEADS}) not found.`);
  }

  if (liveDeals) {
    const collectingDocs = findStage(liveDeals, 'Collecting Documents');
    const allDocs = findStage(liveDeals, 'All Docs Received');

    if (collectingDocs) {
      collectingDocsId = collectingDocs.id;
    } else {
      console.error('WARNING: Stage "Collecting Documents" not found in Finmo - Live Deals pipeline.');
      console.error('Available stages:');
      liveDeals.stages.forEach((s) => console.error(`  - "${s.name}" (${s.id})`));
    }

    if (allDocs) {
      allDocsReceivedId = allDocs.id;
    } else {
      console.error('WARNING: Stage "All Docs Received" not found in Finmo - Live Deals pipeline.');
      if (!collectingDocs) {
        // Already printed stages above
      } else {
        console.error('Available stages:');
        liveDeals.stages.forEach((s) => console.error(`  - "${s.name}" (${s.id})`));
      }
    }
  } else {
    console.error(`WARNING: Pipeline "Finmo - Live Deals" (${PIPELINE_IDS.LIVE_DEALS}) not found.`);
  }

  // -- Users --
  const users = await fetchUsers();

  console.log('='.repeat(60));
  console.log('Copy the following into your .env file:');
  console.log('='.repeat(60));
  console.log('');
  console.log('# Pipeline Stage IDs');
  console.log(`GHL_STAGE_APP_RECEIVED_ID=${appReceivedId}`);
  console.log(`GHL_STAGE_COLLECTING_DOCS_ID=${collectingDocsId}`);
  console.log(`GHL_STAGE_ALL_DOCS_RECEIVED_ID=${allDocsReceivedId}`);
  console.log('');
  console.log('# User IDs (identify Cat and Taylor from list below)');

  if (users.length === 0) {
    console.log('# No users found. Check API key permissions.');
  } else {
    for (const user of users) {
      const displayName = user.name ?? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
      const email = user.email ? ` (${user.email})` : '';
      const deleted = user.deleted ? ' [DELETED]' : '';
      console.log(`# ${displayName}${email}${deleted} - ${user.id}`);
    }
  }

  console.log('GHL_USER_CAT_ID=');
  console.log('GHL_USER_TAYLOR_ID=');
  console.log('');

  // -- Opportunity Custom Fields (Doc Tracking) --
  const oppDocFieldNames: ReadonlySet<string> = new Set(OPP_DOC_TRACKING_FIELD_DEFS.map((d) => d.name));

  try {
    const oppFields = await fetchCustomFields('opportunity');
    const docTrackingFields = oppFields.filter((f) => oppDocFieldNames.has(f.name));

    console.log('# Opportunity Doc Tracking Custom Field IDs');

    if (docTrackingFields.length === 0) {
      console.log('# No opportunity doc tracking fields found.');
      console.log('# Run: npx tsx src/crm/setup/create-custom-fields.ts --model=opportunity');
    } else {
      // Map found fields to the correct env key from OPP_DOC_TRACKING_FIELD_DEFS
      for (const def of OPP_DOC_TRACKING_FIELD_DEFS) {
        const found = docTrackingFields.find((f) => f.name === def.name);
        if (found) {
          console.log(`${def.envKey}=${found.id}`);
        } else {
          console.log(`# ${def.envKey}= (not found: "${def.name}")`);
        }
      }
    }

    // Also print the group ID if we can identify it
    const docTrackingGroup = oppFields.find(
      (f) => f.dataType === 'GROUP' && f.name === 'Doc Tracking'
    );
    if (docTrackingGroup) {
      console.log(`GHL_OPP_FIELD_GROUP_ID=${docTrackingGroup.id}`);
    }
  } catch (err: unknown) {
    console.error(`WARNING: Could not fetch opportunity custom fields: ${err instanceof Error ? err.message : err}`);
    console.log('# Opportunity doc tracking field IDs could not be fetched.');
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Done. Paste the values above into your .env file.');
  console.log('='.repeat(60));
}

main().catch((err: unknown) => {
  console.error('Script failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
