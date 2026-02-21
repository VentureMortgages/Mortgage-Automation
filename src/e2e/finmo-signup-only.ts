/**
 * Just opens Finmo signup and fills the first page. User takes over from there.
 * Auto-increments email number to avoid collisions.
 */
import { chromium } from 'playwright';
import * as fs from 'fs';

const BASE_URL = 'https://venture-mortgages.mtg-app.com';
const COUNTER_FILE = 'C:/Users/lucac/projects/taylor_atkinson/.finmo-test-counter';

// Auto-increment email counter
let num = 10;
try { num = parseInt(fs.readFileSync(COUNTER_FILE, 'utf8').trim(), 10) + 1; } catch {}
fs.writeFileSync(COUNTER_FILE, String(num));

const email = `dev+test${num}@venturemortgages.com`;

async function main() {
  console.log(`\nEmail: ${email}\n`);

  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(`${BASE_URL}/signup`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  await page.fill('input[name="firstName"]', 'TestEmp');
  await page.fill('input[name="lastName"]', 'Borrower');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="phoneNumber"]', '6045551001');
  await page.fill('input[name="password"]', 'TestPass123!');

  console.log('Signup form filled — take it from here!');
  console.log('Browser will stay open for 10 minutes.\n');
  await page.waitForTimeout(600000);
  await browser.close();
}

main().catch(console.error);
