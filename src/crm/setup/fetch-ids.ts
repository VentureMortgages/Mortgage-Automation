/**
 * One-time setup script: Fetch user IDs and pipeline stage IDs from MyBrokerPro.
 *
 * Run with: npx tsx src/crm/setup/fetch-ids.ts
 *
 * Output: .env-formatted lines for copy-paste into your .env file.
 * This script does NOT modify any data in the CRM.
 */

import 'dotenv/config';
import { PIPELINE_IDS } from '../types/index.js';

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
  return pipeline.stages.find(
    (s) => s.name.toLowerCase() === stageName.toLowerCase()
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
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Fetching pipeline and user data from MyBrokerPro...\n');

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
  console.log('='.repeat(60));
  console.log('Done. Paste the values above into your .env file.');
  console.log('='.repeat(60));
}

main().catch((err: unknown) => {
  console.error('Script failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
