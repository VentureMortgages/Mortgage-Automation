/**
 * Quick script to list real (non-test) Finmo applications for draft generation.
 * Run: npx tsx src/e2e/list-real-apps.ts
 */

import 'dotenv/config';

const FINMO_API_KEY = process.env.FINMO_API_KEY;
const FINMO_TEAM_ID = process.env.FINMO_TEAM_ID;

interface BorrowerName {
  firstName?: string;
  lastName?: string;
}

interface AppSummary {
  id: string;
  applicationStatus: string;
  goal: string | null;
  borrowerNames: BorrowerName[] | string | null;
  use: string | null;
  purchasePrice: number | null;
  downPayment: number | null;
}

async function main() {
  const res = await fetch(
    `https://app.finmo.ca/api/v1/applications?teamId=${FINMO_TEAM_ID}&page=1&pageSize=50`,
    { headers: { Authorization: `Bearer ${FINMO_API_KEY}` } },
  );

  if (!res.ok) {
    console.error('API error:', res.status, await res.text());
    return;
  }

  const data = (await res.json()) as AppSummary[];
  console.log(`Total applications: ${data.length}\n`);

  // Group by status
  const byStatus: Record<string, number> = {};
  for (const a of data) byStatus[a.applicationStatus] = (byStatus[a.applicationStatus] || 0) + 1;
  console.log('By status:', byStatus);

  // Group by goal
  const byGoal: Record<string, number> = {};
  for (const a of data) byGoal[a.goal || 'null'] = (byGoal[a.goal || 'null'] || 0) + 1;
  console.log('By goal:', byGoal);
  console.log('');

  // Filter: non-test, non-draft
  const getName = (a: AppSummary): string => {
    if (!a.borrowerNames) return '';
    if (typeof a.borrowerNames === 'string') return a.borrowerNames;
    if (Array.isArray(a.borrowerNames)) {
      return a.borrowerNames
        .map((b: BorrowerName) => `${b.firstName || ''} ${b.lastName || ''}`.trim())
        .join(', ');
    }
    return JSON.stringify(a.borrowerNames);
  };

  const real = data.filter((a) => {
    const name = getName(a).toLowerCase();
    return (
      name.length > 0 &&
      !name.includes('test') &&
      !name.includes('tester') &&
      a.applicationStatus !== 'draft' &&
      a.applicationStatus !== null
    );
  });

  console.log(`Non-test, non-draft apps: ${real.length}\n`);

  for (const a of real) {
    const pad = (s: string | null, n: number) => (s || 'n/a').padEnd(n);
    console.log(
      `${a.id} | ${pad(a.applicationStatus, 12)} | ${pad(a.goal, 12)} | ${pad(a.use, 18)} | ${getName(a)}`,
    );
  }
}

main().catch(console.error);
