/**
 * Check contents of all Wong/Ranasinghe folders
 * Run: npx tsx src/e2e/investigate-srimal-2.ts
 */
import 'dotenv/config';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

async function main() {
  const saKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const key = JSON.parse(Buffer.from(saKey!, 'base64').toString('utf-8'));
  const auth = new JWT({
    email: key.client_email, key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: 'admin@venturemortgages.com',
  });
  const drive = google.drive({ version: 'v3', auth });

  const folders = [
    { name: 'RANASINGHE, SRIMAL (auto-created today)', id: '1Ui6b5Sn9NVkysjqtGvIUtXhFwEDFQ28z' },
    { name: 'WONG-RANASINGHE, Carolyn (auto-created today)', id: '1AWjW_0i_VeyycixgXdgIVz8ghHYlIzni' },
    { name: 'WONG, CAROLYN (auto-created today)', id: '1Y8rZkCW7mhC8LDymZGSHgWNqExz25YmK' },
    { name: 'Wong-Ranasinghe, Carolyn/Srimal (original Mar 2)', id: '1IESaMxZKcqe1PN63--PhKc39S9HYqVkf' },
    { name: 'Srimal (original Mar 2)', id: '1dKrmdWe4ZwzhVEF0VkbBZ5BIbxS80lyJ' },
  ];

  for (const folder of folders) {
    console.log('=== ' + folder.name + ' ===');
    console.log('    id=' + folder.id);
    await listRecursive(drive, folder.id, 1);
    console.log('');
  }

  // Also check the root-level 1. Originals folder created today
  console.log('=== 1. Originals (root level, created today) ===');
  await listRecursive(drive, '17hvgMzGaX4ybnyDZb1BCk_GOrKE39jQP', 1);
}

async function listRecursive(drive: any, parentId: string, depth: number) {
  const indent = '  '.repeat(depth);
  const res = await drive.files.list({
    q: "'" + parentId + "' in parents and trashed=false",
    fields: 'files(id, name, createdTime, mimeType)',
    orderBy: 'name',
  });
  if (!res.data.files || res.data.files.length === 0) {
    console.log(indent + '(empty)');
    return;
  }
  for (const f of res.data.files) {
    const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
    console.log(indent + (isFolder ? 'FOLDER ' : 'FILE   ') + f.name + ' | ' + f.createdTime);
    if (isFolder && depth < 3) {
      await listRecursive(drive, f.id!, depth + 1);
    }
  }
}

main().catch(e => { console.error('Error:', e.message); console.error(e.stack); });
