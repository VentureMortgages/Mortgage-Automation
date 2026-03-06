/**
 * E2E test: Drive Folder Linking (Phase 11)
 *
 * Runs a single real Finmo application through the webhook worker pipeline
 * and reports what happened with Drive folder linking.
 *
 * Run with: npx tsx src/e2e/test-drive-linking.ts
 *
 * What it does:
 *   1. Fetches a real Finmo application
 *   2. Runs processJob (full webhook pipeline)
 *   3. Reports: folder IDs, deal subfolder, CRM field values
 *
 * What it creates:
 *   - Client folder in Google Drive (if not exists)
 *   - Deal subfolder inside client folder
 *   - Gmail DRAFT (not sent) in dev@venturemortgages.com
 *   - Updates CRM contact + opportunity custom fields
 */

import 'dotenv/config';
import { processJob } from '../webhook/worker.js';
import { fetchFinmoApplication } from '../webhook/finmo-client.js';
import { findContactByEmail } from '../crm/contacts.js';
import { findOpportunityByFinmoId } from '../crm/opportunities.js';
import { crmConfig } from '../crm/config.js';
import { PIPELINE_IDS } from '../crm/types/index.js';
import type { Job } from 'bullmq';
import type { JobData } from '../webhook/types.js';

// Pick a real application with a CRM opportunity
const TEST_APP_ID = process.argv[2] ?? 'c278bd6a-bdd0-456d-b148-893622499212'; // Megan Fedak

async function main() {
  console.log('='.repeat(60));
  console.log('Phase 11 E2E: Drive Folder Linking');
  console.log('='.repeat(60));
  console.log(`Application ID: ${TEST_APP_ID}`);
  console.log('');

  // 1. Fetch the app first to show what we're working with
  console.log('1. Fetching Finmo application...');
  const app = await fetchFinmoApplication(TEST_APP_ID);
  const mainBorrower = app.borrowers.find(b => b.isMainBorrower);
  console.log(`   Borrower: ${mainBorrower?.firstName} ${mainBorrower?.lastName}`);
  console.log(`   Email: ${mainBorrower?.email}`);
  console.log(`   Goal: ${app.application.goal}`);
  console.log('');

  // 2. Run the full pipeline
  console.log('2. Running webhook pipeline (processJob)...');
  const fakeJob = {
    id: 'e2e-drive-linking-test',
    data: { applicationId: TEST_APP_ID } as JobData,
    attemptsMade: 0,
  } as Job<JobData>;

  const result = await processJob(fakeJob);
  console.log('');
  console.log('   Pipeline result:');
  console.log(`   - Checklist items: ${result.checklistItemCount}`);
  console.log(`   - CRM contact ID: ${result.contactId ?? 'N/A'}`);
  console.log(`   - Email draft ID: ${result.draftId ?? 'N/A'}`);
  console.log('');

  // 3. Check CRM for folder IDs
  console.log('3. Checking CRM for Drive folder fields...');
  if (mainBorrower?.email) {
    const contact = await findContactByEmail(mainBorrower.email);
    if (contact) {
      const folderField = contact.customFields?.find(
        (f: { id: string; value?: unknown }) => f.id === crmConfig.driveFolderIdFieldId
      );
      console.log(`   Contact ID: ${contact.id}`);
      console.log(`   Drive Folder ID field: ${folderField?.value ?? '(not set)'}`);

      // Check opportunity
      const opp = await findOpportunityByFinmoId(
        contact.id,
        PIPELINE_IDS.LIVE_DEALS,
        TEST_APP_ID,
      );
      if (opp) {
        console.log(`   Opportunity: ${opp.name} (${opp.id})`);
        const subfolderField = opp.customFields?.find(
          (f: { id: string; fieldValueString?: string }) => f.id === crmConfig.oppDealSubfolderIdFieldId
        );
        console.log(`   Deal Subfolder ID field: ${subfolderField?.fieldValueString ?? '(not set)'}`);
      } else {
        console.log('   Opportunity: not found (deal subfolder skipped)');
      }
    } else {
      console.log('   Contact not found in CRM');
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Done. Check:');
  console.log('  - Google Drive: look for client folder + deal subfolder');
  console.log('  - MBP: check contact "Drive Folder ID" field');
  console.log('  - MBP: check opportunity "Deal Subfolder ID" field');
  console.log('  - Gmail (dev@): draft email created');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
