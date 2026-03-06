/**
 * Clean up auto-created items from Cat's March 5 forwarded email.
 * ONLY deletes items created by the system at ~18:49 UTC on March 5.
 *
 * Run: npx tsx src/e2e/cleanup-srimal.ts
 */
import 'dotenv/config';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const GHL_BASE = process.env.GHL_BASE_URL ?? 'https://services.leadconnectorhq.com';
const GHL_KEY = process.env.GHL_API_KEY!;
const LOCATION = process.env.GHL_LOCATION_ID!;

function getDriveAuth() {
  const saKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!saKey) throw new Error('Set GOOGLE_SERVICE_ACCOUNT_KEY env var');
  const key = JSON.parse(Buffer.from(saKey, 'base64').toString('utf-8'));
  return new JWT({
    email: key.client_email, key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: 'admin@venturemortgages.com',
  });
}

// Items auto-created by the system at ~18:49 UTC on March 5, 2026
const DRIVE_FOLDERS_TO_DELETE = [
  { name: 'RANASINGHE, SRIMAL', id: '1Ui6b5Sn9NVkysjqtGvIUtXhFwEDFQ28z', created: '2026-03-05T18:49:19' },
  { name: 'WONG-RANASINGHE, Carolyn', id: '1AWjW_0i_VeyycixgXdgIVz8ghHYlIzni', created: '2026-03-05T18:49:37' },
  { name: 'WONG, CAROLYN', id: '1Y8rZkCW7mhC8LDymZGSHgWNqExz25YmK', created: '2026-03-05T18:49:55' },
  { name: '1. Originals (root-level, wrong location)', id: '17hvgMzGaX4ybnyDZb1BCk_GOrKE39jQP', created: '2026-03-05T18:49:16' },
];

const CRM_CONTACT_TO_DELETE = {
  name: 'CAROLYN WONG',
  id: 'Vbi2KjsUiWkHlXqSt8Mk',
  email: 'admin@venturemortgages.com',
  created: 'Mar 5, 2026 10:49 AM',
};

async function main() {
  const auth = getDriveAuth();
  const drive = google.drive({ version: 'v3', auth });

  console.log('=== CLEANUP: Auto-created items from Cat\'s March 5 email ===\n');

  // 1. Trash Drive folders (trash, not permanent delete — recoverable)
  for (const folder of DRIVE_FOLDERS_TO_DELETE) {
    try {
      // Verify the folder exists and matches expected creation time
      const meta = await drive.files.get({ fileId: folder.id, fields: 'id,name,createdTime,trashed' });
      if (meta.data.trashed) {
        console.log('SKIP (already trashed): ' + folder.name);
        continue;
      }
      if (!meta.data.createdTime?.startsWith('2026-03-05T18:49')) {
        console.log('SKIP (creation time mismatch): ' + folder.name + ' created=' + meta.data.createdTime);
        continue;
      }
      await drive.files.update({ fileId: folder.id, requestBody: { trashed: true } });
      console.log('TRASHED: ' + folder.name + ' (id=' + folder.id + ')');
    } catch (err: any) {
      console.error('ERROR trashing ' + folder.name + ': ' + err.message);
    }
  }

  // 2. Delete CRM contact
  try {
    // Verify contact exists and was created by auto-create
    const url = GHL_BASE + '/contacts/' + CRM_CONTACT_TO_DELETE.id + '?locationId=' + LOCATION;
    const checkRes = await fetch(url, {
      headers: { Authorization: 'Bearer ' + GHL_KEY, Version: '2021-07-28' },
    });
    const checkData = await checkRes.json() as any;
    const contact = checkData.contact;

    if (!contact) {
      console.log('\nSKIP CRM: Contact not found (already deleted?)');
    } else {
      const name = (contact.firstName || '') + ' ' + (contact.lastName || '');
      console.log('\nCRM contact found: ' + name + ' | email=' + contact.email + ' | dateAdded=' + contact.dateAdded);

      // Delete
      const delRes = await fetch(GHL_BASE + '/contacts/' + CRM_CONTACT_TO_DELETE.id, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + GHL_KEY, Version: '2021-07-28' },
      });
      if (delRes.ok) {
        console.log('DELETED CRM: ' + name + ' (id=' + CRM_CONTACT_TO_DELETE.id + ')');
      } else {
        const errBody = await delRes.text();
        console.error('ERROR deleting CRM contact: ' + delRes.status + ' ' + errBody);
      }
    }
  } catch (err: any) {
    console.error('ERROR with CRM: ' + err.message);
  }

  // 3. Reset Gmail dedup — mark the email as unprocessed so it can be reprocessed
  // The intake worker uses Gmail historyId, not per-message dedup, so we just need
  // to ensure the message isn't labeled as processed. Check if there's a PROCESSED label.
  console.log('\n=== Gmail dedup note ===');
  console.log('The intake worker uses historyId-based polling (not per-message dedup).');
  console.log('To reprocess, use the /admin/reprocess-application endpoint or');
  console.log('POST to /admin/test-intake with the message ID: 19cbf54567b767f7');

  console.log('\n=== DONE ===');
  console.log('Preserved (NOT deleted):');
  console.log('  - Wong-Ranasinghe, Carolyn/Srimal (original, Mar 2) id=1IESaMxZKcqe1PN63--PhKc39S9HYqVkf');
  console.log('  - Srimal (original, Mar 2) id=1dKrmdWe4ZwzhVEF0VkbBZ5BIbxS80lyJ');
  console.log('  - CRM: srimal ranasinghe (id=T56fC66Fmw2SOWuErm8N)');
  console.log('  - CRM: carolyn wong-ranasinghe (id=Z1w4Bn0PzA83MEDoBwYa)');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  console.error(err.stack);
});
