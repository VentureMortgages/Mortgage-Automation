/**
 * Find all tab gids by brute-force export.
 * Run: npx tsx src/e2e/find-tabs.ts
 */

import 'dotenv/config';
import { OAuth2Client } from 'google-auth-library';

const TEMPLATE_ID = '1BlqpDhYHuKY0Cgz7GnDzpcTNvMUWyrzpS24A6njzqwo';

async function main() {
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const { token } = await oauth2.getAccessToken();

  // Google Sheets gids are typically: 0, then sequentially assigned numbers.
  // Try known gid plus a range of common values.
  const gidsToTry = [
    0, 128943964,
    // Common sequential patterns
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    // Sometimes large numbers
    100, 200, 300, 400, 500,
    1000, 2000,
    // Try other common patterns
    1234567890, 987654321,
    // Near the known gid
    128943963, 128943965, 128943966, 128943967, 128943968, 128943969, 128943970,
  ];

  console.log(`Testing ${gidsToTry.length} gid values...\n`);

  const found: Array<{ gid: number; header: string; rows: number }> = [];

  for (const gid of gidsToTry) {
    try {
      const url = `https://docs.google.com/spreadsheets/d/${TEMPLATE_ID}/export?format=csv&gid=${gid}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'follow',
      });

      if (res.ok) {
        const csv = await res.text();
        const lines = csv.split('\n');
        const header = lines[0]?.substring(0, 80) || '(empty)';
        found.push({ gid, header, rows: lines.length });
        console.log(`FOUND gid=${gid}: "${header}" (${lines.length} rows)`);
      }
    } catch (err) {
      // skip
    }
  }

  console.log(`\nFound ${found.length} tabs total.`);

  // Now read each found tab fully
  for (const tab of found) {
    console.log('\n' + '='.repeat(70));
    console.log(`TAB gid=${tab.gid}: "${tab.header}"`);
    console.log('='.repeat(70));

    const url = `https://docs.google.com/spreadsheets/d/${TEMPLATE_ID}/export?format=csv&gid=${tab.gid}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const csv = await res.text();
    const lines = csv.split('\n');
    for (const line of lines.slice(0, 50)) {
      console.log(line);
    }
    if (lines.length > 50) {
      console.log(`... (${lines.length - 50} more rows)`);
    }
  }
}

main().catch(console.error);
