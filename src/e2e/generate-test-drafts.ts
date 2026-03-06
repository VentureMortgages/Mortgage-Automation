/**
 * Generate 5 diverse test draft checklists for Cat's review.
 * Triggers the pipeline via POST /admin/process-deal (force=true).
 * Run: npx tsx src/e2e/generate-test-drafts.ts
 */

import 'dotenv/config';

const BASE = process.env.RAILWAY_URL || 'https://doc-automation-production.up.railway.app';

const APPS = [
  { id: 'c278bd6a-bdd0-456d-b148-893622499212', label: 'Solo purchase — Megan Fedak (hourly, gift DP)' },
  { id: '170867c2-298e-440a-8ec2-7f81e7e7aba3', label: 'Joint purchase rental — Trischuk/Calder (2 borrowers, 5 incomes)' },
  { id: 'bd67aa5f-864e-4eaa-8cc4-444ad3f842ed', label: 'Solo refinance — Pellerin (commission + salaried)' },
  { id: 'b5be54ae-ea9f-4268-a4f2-04d08b889774', label: 'Renewal — Erin Sloan (self-employed, HNW $409K)' },
  { id: 'cbc40cdd-a520-408c-853c-f83c939804e9', label: '3-borrower investment refi — Farina (HNW $497K)' },
];

async function pollJob(jobId: string): Promise<any> {
  const maxWait = 120_000; // 2 min
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await fetch(`${BASE}/admin/job-status/${encodeURIComponent(jobId)}`);
    if (!res.ok) {
      console.log('  Poll error:', res.status);
      continue;
    }
    const data = await res.json() as any;
    const step = data.progress?.step || 'waiting';
    const pct = data.progress?.pct || 0;
    process.stdout.write(`\r  ${step} (${pct}%)   `);
    if (data.state === 'completed') {
      console.log('\n  DONE:', JSON.stringify(data.result, null, 2));
      return data.result;
    }
    if (data.state === 'failed') {
      console.log('\n  FAILED:', data.error);
      return null;
    }
  }
  console.log('\n  TIMEOUT');
  return null;
}

async function main() {
  console.log('Generating 5 test draft checklists...\n');
  console.log('Production URL:', BASE, '\n');

  const results: any[] = [];

  for (const app of APPS) {
    console.log(`Processing: ${app.label}`);
    console.log(`  App ID: ${app.id}`);

    const res = await fetch(`${BASE}/admin/process-deal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: app.id, force: true }),
    });

    const data = await res.json() as any;

    if (!res.ok) {
      console.log(`  ERROR ${res.status}: ${data.error || JSON.stringify(data)}`);
      results.push({ ...app, error: data.error });
      continue;
    }

    console.log(`  Job: ${data.jobId} (${data.inputType})`);
    const result = await pollJob(data.jobId);
    results.push({ ...app, result });
    console.log('');
  }

  console.log('\n=== SUMMARY ===\n');
  for (const r of results) {
    const status = r.result ? 'OK' : 'FAILED';
    const draftId = r.result?.draftId || 'n/a';
    const contactId = r.result?.contactId || 'n/a';
    console.log(`${status} | ${r.label}`);
    console.log(`     Draft: ${draftId} | Contact: ${contactId}`);
    if (r.result?.warnings?.length) console.log(`     Warnings: ${r.result.warnings.join(', ')}`);
    console.log('');
  }
}

main().catch(console.error);
