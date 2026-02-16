/**
 * Spot-check: Run checklist engine against all 5 test fixtures
 * and print full output for manual review.
 *
 * Run with: npx tsx src/email/setup/spot-check.ts
 */

import { generateChecklist } from '../../checklist/engine/generate-checklist.js';
import { generateEmailBody } from '../body.js';
import type { FinmoApplicationResponse } from '../../checklist/types/index.js';

import employedPurchase from '../../checklist/__tests__/fixtures/employed-purchase.json' with { type: 'json' };
import selfEmployedRefi from '../../checklist/__tests__/fixtures/self-employed-refi.json' with { type: 'json' };
import retiredCondo from '../../checklist/__tests__/fixtures/retired-condo.json' with { type: 'json' };
import coBorrowerMixed from '../../checklist/__tests__/fixtures/co-borrower-mixed.json' with { type: 'json' };
import giftDownPayment from '../../checklist/__tests__/fixtures/gift-down-payment.json' with { type: 'json' };

interface Scenario {
  name: string;
  data: FinmoApplicationResponse;
}

const scenarios: Scenario[] = [
  { name: 'John (Employed Purchase)', data: employedPurchase as unknown as FinmoApplicationResponse },
  { name: 'Jane (Self-Employed Refinance)', data: selfEmployedRefi as unknown as FinmoApplicationResponse },
  { name: 'Bob (Retired Condo Refinance)', data: retiredCondo as unknown as FinmoApplicationResponse },
  { name: 'Alice & Bob (Co-Borrower Mixed)', data: coBorrowerMixed as unknown as FinmoApplicationResponse },
  { name: 'Carol (Gift Down Payment)', data: giftDownPayment as unknown as FinmoApplicationResponse },
];

const testDate = new Date('2026-02-15T12:00:00Z');

for (const scenario of scenarios) {
  const checklist = generateChecklist(scenario.data, undefined, testDate);
  const names = checklist.borrowerChecklists.map(bc => bc.borrowerName.split(' ')[0]);

  console.log('='.repeat(70));
  console.log(`SCENARIO: ${scenario.name}`);
  console.log(`Stats: ${checklist.stats.totalItems} items (${checklist.stats.preItems} PRE, ${checklist.stats.fullItems} FULL)`);
  console.log('='.repeat(70));

  for (const bc of checklist.borrowerChecklists) {
    const firstName = bc.borrowerName.split(' ')[0];
    const emailItems = bc.items.filter(i => i.forEmail);
    const internalItems = bc.items.filter(i => !i.forEmail);

    console.log(`\n--- ${firstName} (${emailItems.length} email items) ---`);
    for (const item of emailItems) {
      const note = item.notes ? `  --> ${item.notes}` : '';
      console.log(`  [${item.stage}] ${item.displayName}${note}`);
    }
    if (internalItems.length > 0) {
      console.log(`  [INTERNAL ONLY - ${internalItems.length} items]:`);
      for (const item of internalItems) {
        console.log(`    ${item.document}`);
      }
    }
  }

  for (const pc of checklist.propertyChecklists) {
    const emailItems = pc.items.filter(i => i.forEmail);
    if (emailItems.length > 0) {
      console.log(`\n--- Property: ${pc.propertyDescription} ---`);
      for (const item of emailItems) {
        const note = item.notes ? `  --> ${item.notes}` : '';
        console.log(`  [${item.stage}] ${item.displayName}${note}`);
      }
    }
  }

  const shared = checklist.sharedItems.filter(i => i.forEmail);
  if (shared.length > 0) {
    console.log(`\n--- Shared / Other (${shared.length} items) ---`);
    for (const item of shared) {
      const note = item.notes ? `  --> ${item.notes}` : '';
      console.log(`  [${item.stage}] ${item.displayName}${note}`);
    }
  }

  if (checklist.internalFlags.length > 0) {
    console.log(`\n--- Internal Flags (${checklist.internalFlags.length}, NOT emailed) ---`);
    for (const flag of checklist.internalFlags) {
      console.log(`  [${flag.type}] ${flag.description}${flag.checkNote ? ' --> ' + flag.checkNote : ''}`);
    }
  }

  if (checklist.warnings.length > 0) {
    console.log(`\n--- Warnings ---`);
    for (const w of checklist.warnings) {
      console.log(`  ⚠ ${w}`);
    }
  }

  console.log('\n--- EMAIL BODY ---');
  const body = generateEmailBody(checklist, {
    borrowerFirstNames: names,
    docInboxEmail: 'docs@venturemortgages.co',
  });
  for (const line of body.split('\n')) {
    console.log(`  | ${line}`);
  }

  console.log('\n\n');
}

console.log('Done! Review each scenario above for correctness.');
