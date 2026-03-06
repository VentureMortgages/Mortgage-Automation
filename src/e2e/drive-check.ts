/**
 * Investigate what happened with Cat's Srimal/Carolyn forwarded email.
 * Run: npx tsx src/e2e/drive-check.ts
 */
import 'dotenv/config';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const PROD_DRIVE_ROOT = '1g6UIKA5hk1oNSotiTA89z2m65yNIBTn0';

function getAuth(subject = 'docs@venturemortgages.com') {
  const saKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!saKey) throw new Error('Set GOOGLE_SERVICE_ACCOUNT_KEY env var');
  const key = JSON.parse(Buffer.from(saKey, 'base64').toString('utf-8'));
  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
    subject,
  });
}

async function main() {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const gmail = google.gmail({ version: 'v1', auth });

  // 1. Search entire drive for anything with Ranasinghe or Srimal
  console.log('=== DRIVE SEARCH: Ranasinghe / Srimal ===');
  const driveRes = await drive.files.list({
    q: "name contains 'Ranasinghe' or name contains 'Srimal'",
    fields: 'files(id, name, createdTime, parents, mimeType)',
    orderBy: 'createdTime desc',
    pageSize: 50
  });

  if (!driveRes.data.files || driveRes.data.files.length === 0) {
    console.log('No files found with Srimal or Ranasinghe');
  } else {
    console.log(`Found ${driveRes.data.files.length} files:`);
    for (const f of driveRes.data.files) {
      const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
      console.log(`  ${isFolder ? 'FOLDER' : 'FILE'} ${f.name} | created=${f.createdTime} | parent=${f.parents?.[0]}`);
    }
  }

  // Also search for Wong
  console.log('\n=== DRIVE SEARCH: Wong ===');
  const wongRes = await drive.files.list({
    q: "name contains 'Wong'",
    fields: 'files(id, name, createdTime, parents, mimeType)',
    orderBy: 'createdTime desc',
    pageSize: 20
  });
  if (wongRes.data.files && wongRes.data.files.length > 0) {
    for (const f of wongRes.data.files) {
      const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
      console.log(`  ${isFolder ? 'FOLDER' : 'FILE'} ${f.name} | created=${f.createdTime} | parent=${f.parents?.[0]}`);
    }
  } else {
    console.log('No files found with Wong');
  }

  // 2. List recent folders created in production root (last 7 days)
  console.log('\n=== RECENTLY CREATED FOLDERS IN PROD ROOT ===');
  const recentDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentRes = await drive.files.list({
    q: `'${PROD_DRIVE_ROOT}' in parents and mimeType='application/vnd.google-apps.folder' and createdTime > '${recentDate}'`,
    fields: 'files(id, name, createdTime)',
    orderBy: 'createdTime desc',
    pageSize: 20
  });
  if (recentRes.data.files && recentRes.data.files.length > 0) {
    for (const f of recentRes.data.files) {
      console.log(`  FOLDER ${f.name} | created=${f.createdTime} | id=${f.id}`);
    }
  } else {
    console.log('No folders created in prod root in the last 7 days');
  }

  // 3. Check recent docs@ inbox messages
  console.log('\n=== RECENT docs@ INBOX (last 15 messages) ===');
  const msgRes = await gmail.users.messages.list({
    userId: 'docs@venturemortgages.com',
    maxResults: 15,
  });

  if (!msgRes.data.messages) {
    console.log('No messages in docs@ inbox');
  } else {
    for (const msg of msgRes.data.messages) {
      const full = await gmail.users.messages.get({
        userId: 'docs@venturemortgages.com',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date']
      });
      const headers = full.data.payload?.headers || [];
      const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)';
      const from = headers.find((h: any) => h.name === 'From')?.value || '(unknown)';
      const date = headers.find((h: any) => h.name === 'Date')?.value || '';
      const labels = full.data.labelIds?.join(', ') || '';
      console.log(`  ${date} | ${from?.substring(0, 40)} | ${subject?.substring(0, 60)} | labels: ${labels}`);
    }
  }

  // 4. Search for Srimal/Ranasinghe specific emails
  console.log('\n=== docs@ SEARCH: Ranasinghe / Srimal ===');
  const searchRes = await gmail.users.messages.list({
    userId: 'docs@venturemortgages.com',
    maxResults: 10,
    q: 'Srimal OR Ranasinghe OR Wong-Ranasinghe'
  });

  if (!searchRes.data.messages) {
    console.log('No matching emails found');
  } else {
    for (const msg of searchRes.data.messages) {
      const full = await gmail.users.messages.get({
        userId: 'docs@venturemortgages.com',
        id: msg.id!,
        format: 'full'
      });
      const headers = full.data.payload?.headers || [];
      const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)';
      const from = headers.find((h: any) => h.name === 'From')?.value || '(unknown)';
      const date = headers.find((h: any) => h.name === 'Date')?.value || '';

      // Count attachments
      const parts = full.data.payload?.parts || [];
      const attachments = parts.filter((p: any) => p.filename && p.filename.length > 0);

      // Try to get forwarding note (text before forward delimiter)
      let notePreview = '';
      const findPlainText = (part: any): string | null => {
        if (part.mimeType === 'text/plain' && part.body?.data && !part.filename) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        if (part.parts) {
          for (const sub of part.parts) {
            const result = findPlainText(sub);
            if (result) return result;
          }
        }
        return null;
      };

      const plainText = findPlainText(full.data.payload);
      if (plainText) {
        const fwdIdx = plainText.indexOf('---------- Forwarded message');
        if (fwdIdx > 0) {
          notePreview = plainText.substring(0, fwdIdx).trim().substring(0, 300);
        } else {
          notePreview = plainText.substring(0, 300).trim();
        }
      }

      console.log(`  MSG ID: ${msg.id}`);
      console.log(`  Date: ${date}`);
      console.log(`  From: ${from}`);
      console.log(`  Subject: ${subject}`);
      console.log(`  Attachments: ${attachments.length} (${attachments.map((a: any) => a.filename).join(', ')})`);
      console.log(`  Note: "${notePreview}"`);
      console.log(`  Labels: ${full.data.labelIds?.join(', ')}`);
      console.log('  ---');
    }
  }
}
main().catch(err => {
  console.error('Fatal error:', err.message);
  console.error(err.stack);
});
