/**
 * Analyze draft checklists from real Finmo applications without creating drafts.
 * Prints detailed breakdown per borrower to spot issues.
 *
 * Run with: npx tsx src/email/setup/analyze-drafts.ts
 */

import 'dotenv/config';
import { generateChecklist } from '../../checklist/engine/generate-checklist.js';
import type { FinmoApplicationResponse } from '../../checklist/types/index.js';

const REAL_APPS = [
  { id: 'c278bd6a-bdd0-456d-b148-893622499212', label: 'Megan Fedak — single purchase, hourly' },
  { id: 'fffebfb6-465f-40cd-9636-245d3052033d', label: 'Angela Yurich — single purchase, hourly + CPP' },
  { id: '2114c189-ede0-4efc-9f54-8c87a4aeacbe', label: 'Depever/Jarman — couple purchase, hourly, gift' },
  { id: '13c71d64-2d98-4dcd-91b3-f484ccb81f4f', label: 'Zurstrom/Zurstrom — couple purchase, salaried + SE' },
  { id: '7a1f3d8e-26ed-43cb-8445-e820c97d9a86', label: 'Cameron/Taras — couple refi, salaried' },
  { id: '5ad0ea44-e83c-4827-b78a-b7eaffae7251', label: 'Gabelhouse — couple refi, SE + hourly' },
  { id: 'b5be54ae-ea9f-4268-a4f2-04d08b889774', label: 'Erin Sloan — single renewal, SE' },
  { id: '46a54d2b-d0b1-411c-8649-f04b70114e63', label: 'Pitre/Sinclair — investment purchase, SE + salaried' },
  { id: '170867c2-298e-440a-8ec2-7f81e7e7aba3', label: 'Trischuk/Calder — rental purchase, hourly+salaried, gift' },
  { id: 'cbc40cdd-a520-408c-853c-f83c939804e9', label: 'Farina family — 3-borrower investment refi' },
  { id: 'bd67aa5f-864e-4eaa-8cc4-444ad3f842ed', label: 'Steffie Pellerin — single refi, commission + salaried' },
];

async function fetchApp(id: string): Promise<FinmoApplicationResponse> {
  const apiKey = process.env.FINMO_API_KEY;
  if (!apiKey) throw new Error('FINMO_API_KEY not set');
  const res = await fetch(`https://app.finmo.ca/api/v1/applications/${id}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Finmo ${res.status}`);
  return (await res.json()) as FinmoApplicationResponse;
}

async function main() {
  for (const app of REAL_APPS) {
    console.log('\n' + '='.repeat(80));
    console.log(`  ${app.label}`);
    console.log('='.repeat(80));

    const data = await fetchApp(app.id);

    // Print raw income data
    console.log('\n  RAW INCOMES:');
    for (const inc of data.incomes ?? []) {
      const borrower = data.borrowers?.find(b => b.id === inc.borrowerId);
      const name = borrower ? `${borrower.firstName} ${borrower.lastName}` : inc.borrowerId;
      console.log(`    ${name}: source=${inc.source}, payType=${inc.payType ?? 'null'}, jobType=${inc.jobType ?? 'null'}, bonuses=${inc.bonuses}, business="${inc.business ?? 'n/a'}"`);
    }

    // Print asset/DP data
    console.log('\n  ASSETS/DOWN PAYMENT:');
    for (const asset of data.assets ?? []) {
      console.log(`    type=${asset.type}, value=$${asset.value}, dp=$${asset.downPayment ?? 0}, desc="${asset.description ?? 'n/a'}"`);
    }

    // Print property data
    console.log('\n  PROPERTIES:');
    for (const prop of data.properties ?? []) {
      console.log(`    type=${prop.type}, use=${prop.use}, rental=$${prop.rentalIncome ?? 0}, mortgaged=${prop.mortgaged}, selling=${prop.isSelling}`);
    }

    const checklist = generateChecklist(data);

    // Per-borrower items
    for (const bc of checklist.borrowerChecklists) {
      console.log(`\n  ${bc.borrowerName} (${bc.isMainBorrower ? 'MAIN' : 'CO-BORROWER'}):`);
      const grouped = new Map<string, typeof bc.items>();
      for (const item of bc.items) {
        if (!grouped.has(item.section)) grouped.set(item.section, []);
        grouped.get(item.section)!.push(item);
      }
      for (const [section, items] of grouped) {
        console.log(`    [${section}]`);
        for (const item of items) {
          const stage = item.stage === 'PRE' ? 'PRE ' : 'FULL';
          const email = item.forEmail ? '' : ' (NOT in email)';
          console.log(`      ${stage} ${item.displayName}${email}`);
        }
      }
    }

    // Shared items
    if (checklist.sharedItems.length > 0) {
      console.log('\n  SHARED ITEMS:');
      const grouped = new Map<string, typeof checklist.sharedItems>();
      for (const item of checklist.sharedItems) {
        if (!grouped.has(item.section)) grouped.set(item.section, []);
        grouped.get(item.section)!.push(item);
      }
      for (const [section, items] of grouped) {
        console.log(`    [${section}]`);
        for (const item of items) {
          const stage = item.stage === 'PRE' ? 'PRE ' : 'FULL';
          const email = item.forEmail ? '' : ' (NOT in email)';
          console.log(`      ${stage} ${item.displayName}${email}`);
        }
      }
    }

    // Property checklists
    if (checklist.propertyChecklists.length > 0) {
      console.log('\n  PROPERTY-SPECIFIC:');
      for (const pc of checklist.propertyChecklists) {
        console.log(`    Property: ${pc.propertyDescription}`);
        for (const item of pc.items) {
          const stage = item.stage === 'PRE' ? 'PRE ' : 'FULL';
          console.log(`      ${stage} ${item.displayName}`);
        }
      }
    }

    // Internal flags
    if (checklist.internalFlags.length > 0) {
      console.log('\n  INTERNAL FLAGS (not in email):');
      for (const flag of checklist.internalFlags) {
        console.log(`    ${flag.ruleId}: ${flag.checkNote ?? flag.description}`);
      }
    }

    // Warnings
    if (checklist.warnings.length > 0) {
      console.log('\n  WARNINGS:');
      for (const w of checklist.warnings) {
        console.log(`    ${w}`);
      }
    }

    console.log(`\n  STATS: ${checklist.stats.totalItems} items (${checklist.stats.preItems} PRE, ${checklist.stats.fullItems} FULL)`);
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
