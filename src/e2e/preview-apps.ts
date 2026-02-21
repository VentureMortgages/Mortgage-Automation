/**
 * Quick preview of selected Finmo applications — check data completeness.
 * Run: npx tsx src/e2e/preview-apps.ts
 */

import 'dotenv/config';
import type { FinmoApplicationResponse } from '../checklist/types/index.js';

const FINMO_API_KEY = process.env.FINMO_API_KEY;

const CANDIDATES = [
  // Single, purchase, owner occupied
  { id: 'c278bd6a-bdd0-456d-b148-893622499212', label: 'Single purchase (Megan Fedak)' },
  { id: 'fffebfb6-465f-40cd-9636-245d3052033d', label: 'Single purchase (Angela Yurich)' },
  // Couple, purchase, owner occupied
  { id: '2114c189-ede0-4efc-9f54-8c87a4aeacbe', label: 'Couple purchase (Depever/Jarman)' },
  { id: '13c71d64-2d98-4dcd-91b3-f484ccb81f4f', label: 'Couple purchase (Zurstrom/Zurstrom)' },
  // Couple, refinance
  { id: '7a1f3d8e-26ed-43cb-8445-e820c97d9a86', label: 'Couple refinance (Cameron/Taras)' },
  { id: '5ad0ea44-e83c-4827-b78a-b7eaffae7251', label: 'Couple refinance (Gabelhouse)' },
  // Renewal
  { id: 'b5be54ae-ea9f-4268-a4f2-04d08b889774', label: 'Renewal (Erin Sloan)' },
  // Investment/Rental purchase
  { id: '46a54d2b-d0b1-411c-8649-f04b70114e63', label: 'Investment purchase (Pitre/Sinclair)' },
  { id: '170867c2-298e-440a-8ec2-7f81e7e7aba3', label: 'Rental purchase (Trischuk/Calder)' },
  // 3+ borrowers
  { id: 'cbc40cdd-a520-408c-853c-f83c939804e9', label: '3 borrower refi (Farina family)' },
  // Single refinance
  { id: 'bd67aa5f-864e-4eaa-8cc4-444ad3f842ed', label: 'Single refinance (Pellerin)' },
];

async function fetchApp(appId: string): Promise<FinmoApplicationResponse> {
  const res = await fetch(`https://app.finmo.ca/api/v1/applications/${appId}`, {
    headers: { Authorization: `Bearer ${FINMO_API_KEY}` },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()) as FinmoApplicationResponse;
}

async function main() {
  for (const c of CANDIDATES) {
    try {
      const data = await fetchApp(c.id);
      const borrowers = data.borrowers?.map(b => `${b.firstName} ${b.lastName}`).join(', ') || 'none';
      const incomes = data.incomes?.map(i => `${i.source}/${i.payType || 'n/a'}`).join(', ') || 'none';
      const assets = data.assets?.map(a => a.type).join(', ') || 'none';
      const props = data.properties?.length || 0;

      console.log(`${c.label}`);
      console.log(`  ID: ${c.id}`);
      console.log(`  Goal: ${data.application?.goal} | Use: ${data.application?.use || 'n/a'} | Status: ${data.application?.applicationStatus}`);
      console.log(`  Borrowers: ${borrowers}`);
      console.log(`  Incomes: ${incomes}`);
      console.log(`  Assets: ${assets}`);
      console.log(`  Properties: ${props}`);
      console.log('');
    } catch (err) {
      console.log(`${c.label} — ERROR: ${err instanceof Error ? err.message : err}`);
      console.log('');
    }
  }
}

main().catch(console.error);
