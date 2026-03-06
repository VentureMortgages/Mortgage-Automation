/**
 * One-time Data Fix: Link Wong-Ranasinghe Drive Folder to CRM Contacts
 *
 * Links the existing Drive folder "Wong-Ranasinghe, Carolyn/Srimal"
 * (ID: 1IESaMxZKcqe1PN63--PhKc39S9HYqVkf) to both CRM contacts:
 *   - Srimal Ranasinghe (T56fC66Fmw2SOWuErm8N)
 *   - Carolyn Wong-Ranasinghe (Z1w4Bn0PzA83MEDoBwYa)
 *
 * This prevents the system from creating duplicate Drive folders when
 * docs are forwarded for this co-borrower pair.
 *
 * Usage: npx tsx src/admin/link-wong-ranasinghe.ts
 */

import 'dotenv/config';
import { upsertContact } from '../crm/contacts.js';
import { crmConfig } from '../crm/config.js';

const WONG_RANASINGHE_FOLDER_ID = '1IESaMxZKcqe1PN63--PhKc39S9HYqVkf';

const contacts = [
  {
    contactId: 'T56fC66Fmw2SOWuErm8N',
    firstName: 'Srimal',
    lastName: 'Ranasinghe',
    email: '', // Will be looked up by contact ID
    label: 'Srimal Ranasinghe',
  },
  {
    contactId: 'Z1w4Bn0PzA83MEDoBwYa',
    firstName: 'Carolyn',
    lastName: 'Wong-Ranasinghe',
    email: '', // Will be looked up by contact ID
    label: 'Carolyn Wong-Ranasinghe',
  },
];

async function main() {
  console.log('=== Wong-Ranasinghe Drive Folder Link ===');
  console.log(`Folder ID: ${WONG_RANASINGHE_FOLDER_ID}`);
  console.log(`Drive folder field: ${crmConfig.driveFolderIdFieldId}`);
  console.log();

  if (!crmConfig.driveFolderIdFieldId) {
    console.error('ERROR: GHL_FIELD_DRIVE_FOLDER_ID not configured in .env');
    process.exit(1);
  }

  for (const contact of contacts) {
    try {
      console.log(`Linking folder to ${contact.label} (${contact.contactId})...`);

      // Use upsertContact to update the custom field
      // upsertContact needs an email for dedup, but we can use the contact's existing email
      // For this one-time fix, we'll use the GHL API directly since upsertContact requires email
      const response = await fetch(
        `${crmConfig.baseUrl}/contacts/${contact.contactId}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${crmConfig.apiKey}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28',
          },
          body: JSON.stringify({
            customFields: [
              {
                id: crmConfig.driveFolderIdFieldId,
                field_value: WONG_RANASINGHE_FOLDER_ID,
              },
            ],
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`  FAILED: ${response.status} ${response.statusText} — ${errorText}`);
        continue;
      }

      const result = await response.json();
      console.log(`  OK: ${contact.label} linked to folder ${WONG_RANASINGHE_FOLDER_ID}`);
    } catch (err) {
      console.error(`  FAILED: ${contact.label} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
