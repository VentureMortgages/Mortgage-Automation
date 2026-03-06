/**
 * Investigate what happened with Cat's Srimal/Carolyn forwarded email.
 * Run: npx tsx src/e2e/investigate-srimal.ts
 */
import 'dotenv/config';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const PROD_DRIVE_ROOT = '1g6UIKA5hk1oNSotiTA89z2m65yNIBTn0';
const PROD_NEEDS_REVIEW = '1muPREPE69ruWhSIXxkvhcFbSljDElm4I';
const GHL_BASE = process.env.GHL_BASE_URL ?? 'https://services.leadconnectorhq.com';
const GHL_KEY = process.env.GHL_API_KEY!;
const LOCATION = process.env.GHL_LOCATION_ID!;

function getDriveAuth() {
  const saKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!saKey) throw new Error('Set GOOGLE_SERVICE_ACCOUNT_KEY env var');
  const key = JSON.parse(Buffer.from(saKey, 'base64').toString('utf-8'));
  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: 'admin@venturemortgages.com',
  });
}

async function searchCRM(name: string): Promise<any[]> {
  const url = GHL_BASE + '/contacts/?locationId=' + LOCATION + '&query=' + encodeURIComponent(name) + '&limit=10';
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + GHL_KEY, Version: '2021-07-28' }
  });
  const data = await res.json() as any;
  return data.contacts || [];
}

async function main() {
  const auth = getDriveAuth();
  const drive = google.drive({ version: 'v3', auth });

  // --- CRM SEARCHES ---
  console.log('=== CRM Search: Srimal ===');
  const srimal = await searchCRM('Srimal');
  for (const c of srimal) {
    const driveField = c.customFields?.find((cf: any) => cf.value && String(cf.value).includes('drive.google'));
    console.log('  ' + c.firstName + ' ' + c.lastName + ' | id=' + c.id + ' | email=' + c.email);
    if (driveField) console.log('    Drive folder field: ' + driveField.value);
    if (!driveField) {
      const allCf = c.customFields?.filter((cf: any) => cf.value).map((cf: any) => cf.id + '=' + String(cf.value).substring(0, 60));
      if (allCf?.length) console.log('    Custom fields: ' + allCf.join(', '));
    }
  }

  console.log('\n=== CRM Search: Carolyn ===');
  const carolyn = await searchCRM('Carolyn');
  for (const c of carolyn) {
    const driveField = c.customFields?.find((cf: any) => cf.value && String(cf.value).includes('drive.google'));
    console.log('  ' + c.firstName + ' ' + c.lastName + ' | id=' + c.id + ' | email=' + c.email);
    if (driveField) console.log('    Drive folder field: ' + driveField.value);
  }

  console.log('\n=== CRM Search: Wong ===');
  const wong = await searchCRM('Wong');
  for (const c of wong) {
    const driveField = c.customFields?.find((cf: any) => cf.value && String(cf.value).includes('drive.google'));
    console.log('  ' + c.firstName + ' ' + c.lastName + ' | id=' + c.id + ' | email=' + c.email);
    if (driveField) console.log('    Drive folder field: ' + driveField.value);
  }

  console.log('\n=== CRM Search: Ranasinghe ===');
  const rana = await searchCRM('Ranasinghe');
  for (const c of rana) {
    const driveField = c.customFields?.find((cf: any) => cf.value && String(cf.value).includes('drive.google'));
    console.log('  ' + c.firstName + ' ' + c.lastName + ' | id=' + c.id + ' | email=' + c.email);
    if (driveField) console.log('    Drive folder field: ' + driveField.value);
  }

  // --- DRIVE SEARCHES ---
  console.log('\n=== DRIVE: All folders in prod root ===');
  const rootRes = await drive.files.list({
    q: "'" + PROD_DRIVE_ROOT + "' in parents and mimeType='application/vnd.google-apps.folder'",
    fields: 'files(id, name, createdTime)',
    orderBy: 'name',
    pageSize: 100
  });
  if (rootRes.data.files) {
    for (const f of rootRes.data.files) {
      const highlight = (f.name || '').toLowerCase().includes('wong') || (f.name || '').toLowerCase().includes('rana') || (f.name || '').toLowerCase().includes('srimal') ? ' <<<' : '';
      console.log('  ' + f.name + ' | created=' + f.createdTime + ' | id=' + f.id + highlight);
    }
    console.log('  Total: ' + rootRes.data.files.length + ' folders');
  }

  // Search anywhere in drive for Wong/Ranasinghe
  console.log('\n=== DRIVE: Search all for Ranasinghe ===');
  const driveRes = await drive.files.list({
    q: "name contains 'Ranasinghe' or name contains 'Ranasignhe'",
    fields: 'files(id, name, createdTime, parents, mimeType)',
    orderBy: 'createdTime desc',
    pageSize: 30
  });
  if (driveRes.data.files && driveRes.data.files.length > 0) {
    for (const f of driveRes.data.files) {
      const type = f.mimeType === 'application/vnd.google-apps.folder' ? 'FOLDER' : 'FILE';
      console.log('  ' + type + ' ' + f.name + ' | parent=' + (f.parents?.[0] || 'none') + ' | created=' + f.createdTime);
    }
  } else {
    console.log('  No results');
  }

  console.log('\n=== DRIVE: Search all for Wong ===');
  const wongRes = await drive.files.list({
    q: "name contains 'Wong'",
    fields: 'files(id, name, createdTime, parents, mimeType)',
    orderBy: 'createdTime desc',
    pageSize: 30
  });
  if (wongRes.data.files && wongRes.data.files.length > 0) {
    for (const f of wongRes.data.files) {
      const type = f.mimeType === 'application/vnd.google-apps.folder' ? 'FOLDER' : 'FILE';
      console.log('  ' + type + ' ' + f.name + ' | parent=' + (f.parents?.[0] || 'none') + ' | created=' + f.createdTime);
    }
  } else {
    console.log('  No results');
  }

  // --- NEEDS REVIEW FOLDER ---
  console.log('\n=== NEEDS REVIEW FOLDER ===');
  const nrRes = await drive.files.list({
    q: "'" + PROD_NEEDS_REVIEW + "' in parents",
    fields: 'files(id, name, createdTime, mimeType)',
    orderBy: 'createdTime desc',
    pageSize: 20
  });
  if (nrRes.data.files && nrRes.data.files.length > 0) {
    for (const f of nrRes.data.files) {
      const type = f.mimeType === 'application/vnd.google-apps.folder' ? 'FOLDER' : 'FILE';
      console.log('  ' + type + ' ' + f.name + ' | created=' + f.createdTime);
    }
  } else {
    console.log('  Empty');
  }

  // --- RECENTLY CREATED FOLDERS ANYWHERE ---
  console.log('\n=== RECENTLY CREATED FOLDERS (last 7 days, anywhere) ===');
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentRes = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.folder' and createdTime > '" + sevenDaysAgo + "'",
    fields: 'files(id, name, createdTime, parents)',
    orderBy: 'createdTime desc',
    pageSize: 30
  });
  if (recentRes.data.files && recentRes.data.files.length > 0) {
    for (const f of recentRes.data.files) {
      console.log('  ' + f.name + ' | parent=' + (f.parents?.[0] || 'none') + ' | created=' + f.createdTime);
    }
  } else {
    console.log('  No recently created folders');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
