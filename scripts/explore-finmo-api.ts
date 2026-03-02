/**
 * Finmo API Explorer — Research Spike
 *
 * Systematically probes the Finmo API for sync-related endpoints that
 * could eliminate the MBP timing gap (4-15 min delay after app submission).
 *
 * This is a research tool, not production code.
 * Run: npx tsx scripts/explore-finmo-api.ts
 *
 * Security: No PII is logged. Only endpoint metadata (URL, status, keys).
 */

import 'dotenv/config';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = process.env.FINMO_API_KEY;
const API_BASE = process.env.FINMO_API_BASE || 'https://app.finmo.ca/api/v1';
const TEST_APP_ID = '2f0b2c5f'; // Roger Brampton's test app

if (!API_KEY) {
  console.error('ERROR: FINMO_API_KEY not set in .env');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProbeResult {
  endpoint: string;
  method: string;
  status: number;
  verdict: 'exists' | 'not-found' | 'unauthorized' | 'error' | 'server-error';
  responseKeys: string[];
  bodyPreview: string;
}

// ---------------------------------------------------------------------------
// Probe function
// ---------------------------------------------------------------------------

async function probe(
  method: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<ProbeResult> {
  const endpoint = url.replace(API_KEY!, '[REDACTED]');

  try {
    const opts: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };

    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    const response = await fetch(url, opts);
    const status = response.status;

    let bodyText = '';
    let responseKeys: string[] = [];

    try {
      bodyText = await response.text();
      // Try to parse as JSON to extract keys
      const json = JSON.parse(bodyText);
      if (typeof json === 'object' && json !== null) {
        responseKeys = Array.isArray(json) ? ['[array]', `length:${json.length}`] : Object.keys(json);
      }
    } catch {
      // Not JSON, keep raw text
    }

    // Truncate body to 500 chars, redact potential PII patterns
    const preview = bodyText
      .slice(0, 500)
      .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');

    let verdict: ProbeResult['verdict'];
    if (status >= 200 && status < 300) verdict = 'exists';
    else if (status === 401) verdict = 'unauthorized';
    else if (status === 403) verdict = 'unauthorized';
    else if (status === 404) verdict = 'not-found';
    else if (status >= 500) verdict = 'server-error';
    else verdict = 'error';

    return { endpoint, method, status, verdict, responseKeys, bodyPreview: preview };
  } catch (err) {
    return {
      endpoint,
      method,
      status: 0,
      verdict: 'error',
      responseKeys: [],
      bodyPreview: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Endpoint probes
// ---------------------------------------------------------------------------

async function runProbes(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const base = API_BASE;
  const v2Base = API_BASE.replace('/api/v1', '/api/v2');
  const appId = TEST_APP_ID;

  // Define all endpoints to probe
  const probes: Array<{ method: string; url: string; body?: Record<string, unknown>; label: string }> = [
    // API discovery
    { method: 'GET', url: `${base}/`, label: 'API root (v1)' },
    { method: 'GET', url: `${v2Base}/`, label: 'API root (v2)' },

    // Integration / external system endpoints
    { method: 'GET', url: `${base}/integrations`, label: 'Integrations list' },
    { method: 'GET', url: `${base}/external-systems`, label: 'External systems' },
    { method: 'GET', url: `${base}/connectors`, label: 'Connectors' },

    // Application sync endpoints
    { method: 'GET', url: `${base}/applications/${appId}/sync`, label: 'App sync (GET)' },
    { method: 'POST', url: `${base}/applications/${appId}/sync`, body: {}, label: 'App sync (POST)' },
    { method: 'GET', url: `${base}/applications/${appId}/external-sync`, label: 'App external-sync (GET)' },
    { method: 'POST', url: `${base}/applications/${appId}/external-sync`, body: {}, label: 'App external-sync (POST)' },
    { method: 'POST', url: `${base}/applications/${appId}/trigger-sync`, body: {}, label: 'App trigger-sync (POST)' },
    { method: 'GET', url: `${base}/applications/${appId}/integrations`, label: 'App integrations' },
    { method: 'GET', url: `${base}/applications/${appId}/events`, label: 'App events' },
    { method: 'GET', url: `${base}/applications/${appId}/actions`, label: 'App actions' },
    { method: 'GET', url: `${base}/applications/${appId}/status`, label: 'App status' },

    // Webhook / resthook discovery
    { method: 'GET', url: `${base}/webhooks`, label: 'Webhooks list' },
    { method: 'GET', url: `${base}/resthooks`, label: 'Resthooks list' },
    { method: 'GET', url: `${base}/resthooks/subscriptions`, label: 'Resthook subscriptions' },

    // Team/settings
    { method: 'GET', url: `${base}/settings`, label: 'Settings' },
    { method: 'GET', url: `${base}/team`, label: 'Team info' },
    { method: 'GET', url: `${base}/team/settings`, label: 'Team settings' },
    { method: 'GET', url: `${base}/team/integrations`, label: 'Team integrations' },

    // CRM / pipeline sync
    { method: 'GET', url: `${base}/crm`, label: 'CRM endpoint' },
    { method: 'GET', url: `${base}/crm/sync`, label: 'CRM sync' },
    { method: 'GET', url: `${base}/pipeline`, label: 'Pipeline' },
    { method: 'GET', url: `${base}/pipeline/sync`, label: 'Pipeline sync' },

    // v2 variants of key endpoints
    { method: 'GET', url: `${v2Base}/integrations`, label: 'v2 Integrations' },
    { method: 'GET', url: `${v2Base}/applications/${appId}/sync`, label: 'v2 App sync' },
    { method: 'GET', url: `${v2Base}/webhooks`, label: 'v2 Webhooks' },
    { method: 'GET', url: `${v2Base}/resthooks`, label: 'v2 Resthooks' },
  ];

  console.log(`\n=== Finmo API Explorer ===`);
  console.log(`Base: ${base}`);
  console.log(`Test App ID: ${appId}`);
  console.log(`Probing ${probes.length} endpoints...\n`);

  for (const p of probes) {
    console.log(`  [${p.method}] ${p.label} ...`);
    const result = await probe(p.method, p.url, p.body);
    results.push(result);

    const icon = result.verdict === 'exists' ? 'FOUND' :
                 result.verdict === 'not-found' ? '404' :
                 result.verdict === 'unauthorized' ? 'AUTH' :
                 result.verdict === 'server-error' ? '5xx' : 'ERR';
    console.log(`    -> ${icon} (${result.status}) keys=[${result.responseKeys.join(', ')}]`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(results: ProbeResult[]): void {
  console.log('\n\n=== RESULTS SUMMARY ===\n');

  // Table header
  console.log('| Status | Method | Endpoint | Keys |');
  console.log('|--------|--------|----------|------|');

  for (const r of results) {
    const statusIcon = r.verdict === 'exists' ? 'FOUND' :
                       r.verdict === 'not-found' ? '404' :
                       r.verdict === 'unauthorized' ? 'AUTH' : 'ERR';
    // Shorten endpoint for display
    const shortEndpoint = r.endpoint
      .replace('https://app.finmo.ca', '')
      .replace('[REDACTED]', '');
    console.log(`| ${statusIcon.padEnd(6)} | ${r.method.padEnd(6)} | ${shortEndpoint.padEnd(50)} | ${r.responseKeys.join(', ')} |`);
  }

  // Highlight interesting findings
  const found = results.filter(r => r.verdict === 'exists');
  const authed = results.filter(r => r.verdict === 'unauthorized');

  console.log('\n--- ENDPOINTS THAT EXIST ---');
  if (found.length === 0) {
    console.log('  None found (besides known working endpoints)');
  } else {
    for (const r of found) {
      console.log(`  ${r.method} ${r.endpoint}`);
      console.log(`    Keys: ${r.responseKeys.join(', ')}`);
      console.log(`    Preview: ${r.bodyPreview.slice(0, 200)}`);
    }
  }

  console.log('\n--- AUTH-BLOCKED ENDPOINTS (may exist, need different permissions) ---');
  if (authed.length === 0) {
    console.log('  None');
  } else {
    for (const r of authed) {
      console.log(`  ${r.method} ${r.endpoint} (${r.status})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const results = await runProbes();
  printReport(results);

  console.log('\n=== Exploration complete ===\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
