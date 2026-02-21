/**
 * Playwright script to fill out Finmo mortgage applications with test data.
 * Each form step is explicitly handled based on Finmo's actual form structure.
 *
 * Usage:
 *   FINMO_TEST_NUM=5 npx tsx src/e2e/finmo-apply.ts
 *   FINMO_TEST_NUM=6 npx tsx src/e2e/finmo-apply.ts --profile=2
 *
 * See: memory/finmo-form-rules.md for form structure notes.
 */

import { chromium, type Page, type Locator } from 'playwright';

const BASE_URL = 'https://venture-mortgages.mtg-app.com';
const SCREENSHOT_DIR = 'C:/Users/lucac/projects/taylor_atkinson/screenshots';

// ---------------------------------------------------------------------------
// Test Profiles — FAKE DATA ONLY (no real PII)
// ---------------------------------------------------------------------------

interface TestProfile {
  id: number;
  label: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  // Personal details
  firstTimeBuyer: boolean;
  maritalStatus: string;
  dob: { month: string; day: string; year: string };
  dependents: string;
  // Address + living history (manual entry fields)
  address: {
    streetNumber: string;
    streetName: string;
    streetType: string; // 'Road' | 'Street' | 'Avenue' | 'Drive' | etc.
    city: string;
    province: string;
    postalCode: string;
  };
  livingSituation: string; // 'Renting' | 'Owner' | 'Live with Parents'
  moveInDate: { month: string; day: string; year: string };
  // Goal (Step 1)
  goal: 'Purchase' | 'Renew' | 'Refinance';
  goalProvince: string;
  purchasePrice: string;
  downPayment: string;
  intendedUse: string;
  whenBuying: string;
}

// Auto-increment: read counter from file, bump it, save back
import * as fs from 'fs';
const COUNTER_FILE = `${SCREENSHOT_DIR}/../.finmo-test-counter`;
function getNextEmailNum(): number {
  if (process.env.FINMO_TEST_NUM) return parseInt(process.env.FINMO_TEST_NUM, 10);
  let n = 10; // start after known used numbers (1-7)
  try { n = parseInt(fs.readFileSync(COUNTER_FILE, 'utf8').trim(), 10) + 1; } catch {}
  fs.writeFileSync(COUNTER_FILE, String(n));
  return n;
}
let emailNum = getNextEmailNum();

const profiles: TestProfile[] = [
  {
    id: 1,
    label: 'Employed Purchase',
    firstName: 'TestEmp',
    lastName: 'Borrower',
    email: `dev+test${emailNum}@venturemortgages.com`,
    phone: '6045551001',
    password: 'TestPass123!',
    firstTimeBuyer: true,
    maritalStatus: 'Single',
    dob: { month: 'March', day: '15', year: '1990' },
    dependents: '0',
    address: {
      streetNumber: '1660',
      streetName: 'Old Ferry Wharf',
      streetType: 'Road',
      city: 'West Kelowna',
      province: 'British Columbia',
      postalCode: 'V1Z 0C4',
    },
    livingSituation: 'Renting',
    moveInDate: { month: 'January', day: '1', year: '2020' },
    goal: 'Purchase',
    goalProvince: 'British Columbia',
    purchasePrice: '500000',
    downPayment: '100000',
    intendedUse: 'Owner Occupied',
    whenBuying: 'Within the next 3 months',
  },
  {
    id: 2,
    label: 'Self-Employed Refi',
    firstName: 'TestSelf',
    lastName: 'Employed',
    email: `dev+test${emailNum}@venturemortgages.com`,
    phone: '6045551002',
    password: 'TestPass123!',
    firstTimeBuyer: false,
    maritalStatus: 'Married',
    dob: { month: 'July', day: '22', year: '1985' },
    dependents: '2',
    address: {
      streetNumber: '100',
      streetName: 'Queen',
      streetType: 'Street',
      city: 'Toronto',
      province: 'Ontario',
      postalCode: 'M5H 2N2',
    },
    livingSituation: 'Owner',
    moveInDate: { month: 'June', day: '15', year: '2018' },
    goal: 'Refinance',
    goalProvince: 'Ontario',
    purchasePrice: '750000',
    downPayment: '150000',
    intendedUse: 'Owner Occupied',
    whenBuying: 'As soon as possible',
  },
  {
    id: 3,
    label: 'Co-Borrower Purchase',
    firstName: 'TestCo',
    lastName: 'Borrower',
    email: `dev+test${emailNum}@venturemortgages.com`,
    phone: '6045551003',
    password: 'TestPass123!',
    firstTimeBuyer: true,
    maritalStatus: 'Single',
    dob: { month: 'November', day: '8', year: '1992' },
    dependents: '0',
    address: {
      streetNumber: '1055',
      streetName: 'Dunsmuir',
      streetType: 'Street',
      city: 'Vancouver',
      province: 'British Columbia',
      postalCode: 'V7X 1L3',
    },
    livingSituation: 'Renting',
    moveInDate: { month: 'March', day: '1', year: '2021' },
    goal: 'Purchase',
    goalProvince: 'British Columbia',
    purchasePrice: '600000',
    downPayment: '120000',
    intendedUse: 'Owner Occupied',
    whenBuying: 'Within the next 3 months',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let screenshotCounter = 0;

async function ss(page: Page, label: string) {
  screenshotCounter++;
  const num = String(screenshotCounter).padStart(2, '0');
  const path = `${SCREENSHOT_DIR}/${num}-${label}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`  [ss] ${num}-${label}`);
}

async function settle(page: Page, ms = 2000) {
  await page.waitForTimeout(ms);
}

async function logUrl(page: Page) {
  console.log(`  [url] ${page.url()}`);
}

/** Dismiss the cookie consent banner if visible */
async function dismissCookies(page: Page) {
  try {
    const acceptBtn = page.locator('button:has-text("Accept all")');
    if (await acceptBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await acceptBtn.click();
      console.log('  [cookies] Dismissed cookie banner');
      await settle(page, 500);
    }
  } catch {
    // No cookie banner — fine
  }
}

/**
 * Scan all visible <select> elements on the page and categorize them
 * by their option content. Returns named references for each dropdown.
 */
async function categorizeSelects(page: Page) {
  const allSelects = await page.locator('select:visible').all();
  const monthSelects: Locator[] = [];
  const daySelects: Locator[] = [];
  const yearSelects: Locator[] = [];
  let countrySelect: Locator | null = null;
  let maritalSelect: Locator | null = null;
  let dependentsSelect: Locator | null = null;
  let provinceSelect: Locator | null = null;

  for (const sel of allSelects) {
    const options = await sel.locator('option').allTextContents();
    const optText = options.join(' ');

    // Skip street type/direction dropdowns (Road, Avenue, etc. / N, S, E, W)
    if (options.some(o => o === 'Road') && options.some(o => o === 'Avenue')) {
      continue; // Street type — handled separately
    }
    if (options.some(o => o === 'N') && options.some(o => o === 'S') && options.some(o => o === 'E')) {
      continue; // Street direction — skip
    }

    if (optText.includes('Canada') || optText.includes('United States')) {
      countrySelect = sel;
    } else if (optText.includes('Single') || optText.includes('Married') || optText.includes('marital')) {
      maritalSelect = sel;
    } else if (optText.includes('British Columbia') || optText.includes('Alberta') || optText.includes('Ontario')) {
      provinceSelect = sel;
    } else if (optText.includes('January') || optText.includes('February')) {
      monthSelects.push(sel);
    } else if (options.includes('15') && options.includes('28') && options.length < 35) {
      daySelects.push(sel);
    } else if (optText.includes('1990') || optText.includes('1985') || optText.includes('2000')) {
      yearSelects.push(sel);
    } else if (options.length <= 12 && options.some(o => o.trim() === '0')) {
      dependentsSelect = sel;
    }
  }

  return {
    dob: {
      month: monthSelects[0] ?? null,
      day: daySelects[0] ?? null,
      year: yearSelects[0] ?? null,
    },
    moveIn: {
      month: monthSelects[1] ?? null,
      day: daySelects[1] ?? null,
      year: yearSelects[1] ?? null,
    },
    country: countrySelect,
    maritalStatus: maritalSelect,
    dependents: dependentsSelect,
    province: provinceSelect,
  };
}

/** Safely select a native <select> option by label */
async function safeSelect(sel: Locator | null, label: string, fieldName: string) {
  if (!sel) {
    console.log(`  [warn] ${fieldName}: select not found`);
    return false;
  }
  try {
    await sel.selectOption({ label });
    console.log(`  [select] ${fieldName}: ${label}`);
    return true;
  } catch (err) {
    console.log(`  [warn] ${fieldName}: failed to select "${label}" — ${err}`);
    return false;
  }
}

/** Safely click an element matching text */
async function safeClick(page: Page, text: string, fieldName: string) {
  try {
    const el = page.locator(`text="${text}"`).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click();
      console.log(`  [click] ${fieldName}: "${text}"`);
      return true;
    }
    console.log(`  [warn] ${fieldName}: "${text}" not visible`);
    return false;
  } catch {
    console.log(`  [warn] ${fieldName}: "${text}" not found`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Step 1: Signup
// ---------------------------------------------------------------------------

async function doSignup(page: Page, profile: TestProfile) {
  console.log('\n=== Step 1: Signup ===');

  // Retry with incrementing email if "already been created"
  for (let attempt = 0; attempt < 5; attempt++) {
    const email = `dev+test${emailNum}@venturemortgages.com`;
    console.log(`  Trying email: ${email}`);

    await page.goto(`${BASE_URL}/signup`, { waitUntil: 'networkidle', timeout: 30000 });
    await settle(page, 3000);

    await page.fill('input[name="firstName"]', profile.firstName);
    await page.fill('input[name="lastName"]', profile.lastName);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="phoneNumber"]', profile.phone);
    await page.fill('input[name="password"]', profile.password);

    await page.click('button:has-text("Sign up")');
    console.log('  Clicked Sign up');
    await settle(page, 5000);

    const bodyText = (await page.locator('body').textContent()) ?? '';
    if (bodyText.includes('already been created')) {
      console.log(`  [warn] Email ${email} already used — trying next`);
      emailNum++;
      fs.writeFileSync(COUNTER_FILE, String(emailNum));
      continue;
    }

    // Success — update profile email and save counter
    profile.email = email;
    fs.writeFileSync(COUNTER_FILE, String(emailNum));
    await ss(page, 'after-signup');
    await logUrl(page);
    return;
  }

  throw new Error('Failed to sign up after 5 attempts — all emails taken');
}

// ---------------------------------------------------------------------------
// Step 2: Home → Go to application
// ---------------------------------------------------------------------------

async function goToApplication(page: Page) {
  console.log('\n=== Step 2: Go to Application ===');
  await dismissCookies(page);

  const goBtn = page.locator('text=Go to application').first();
  const createBtn = page.locator('text=Create new application').first();

  if (await goBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await goBtn.click();
    console.log('  Clicked "Go to application"');
  } else if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await createBtn.click();
    console.log('  Clicked "Create new application"');
  } else {
    console.log('  [warn] No application button found — trying Application nav link');
    await page.click('text=Application');
  }

  await settle(page, 3000);
  await ss(page, 'application-page');
  await logUrl(page);
}

// ---------------------------------------------------------------------------
// Step 3: Goal (Step 1 of 8)
// ---------------------------------------------------------------------------

async function fillGoal(page: Page, profile: TestProfile) {
  console.log('\n=== Step 3: Goal (Step 1 of 8) ===');
  await dismissCookies(page);
  await settle(page, 1000);

  // Verify we're on the Goal page
  const goalHeading = page.locator('text=What\'s your mortgage goal?');
  if (!await goalHeading.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('  [warn] Not on Goal page — checking current page');
    await ss(page, 'goal-check');
    return;
  }

  // Goal type — Purchase / Renew / Refinance
  await safeClick(page, profile.goal, 'Goal type');
  await settle(page, 500);

  // "Actively searching for a home" should already be checked, but click if not
  const activelySearching = page.locator('text=Actively searching for a home');
  if (await activelySearching.isVisible().catch(() => false)) {
    // Check if it's already selected by looking at the checkbox state
    console.log('  [info] "Actively searching" visible');
  }

  // Province dropdown
  const provinceSelect = page.locator('select:visible').first();
  if (provinceSelect) {
    await safeSelect(provinceSelect, profile.goalProvince, 'Goal province');
  }

  // Purchase price — clear $0 and type the value
  try {
    const priceInputs = await page.locator('input:visible').all();
    for (const input of priceInputs) {
      const val = await input.inputValue();
      if (val === '$0' || val === '0') {
        const placeholder = await input.getAttribute('placeholder');
        const name = await input.getAttribute('name');
        // First $0 input = purchase price, second = down payment amount
        await input.click({ clickCount: 3 }); // select all
        await input.fill(profile.purchasePrice);
        console.log(`  [fill] Price input (name=${name}, ph=${placeholder}): ${profile.purchasePrice}`);
        break;
      }
    }
  } catch (err) {
    console.log(`  [warn] Purchase price: ${err}`);
  }

  // Down payment amount
  try {
    const inputs = await page.locator('input:visible').all();
    let foundPrice = false;
    for (const input of inputs) {
      const val = await input.inputValue();
      if (val === '$0' || val === '0') {
        if (!foundPrice) {
          // This might be the down payment if purchase price was already set
        }
        await input.click({ clickCount: 3 });
        await input.fill(profile.downPayment);
        console.log(`  [fill] Down payment: ${profile.downPayment}`);
        break;
      }
    }
  } catch (err) {
    console.log(`  [warn] Down payment: ${err}`);
  }

  // Intended use
  await safeClick(page, profile.intendedUse, 'Intended use');
  await settle(page, 300);

  // When buying
  await safeClick(page, profile.whenBuying, 'When buying');
  await settle(page, 300);

  await ss(page, 'goal-filled');

  // Save & continue
  const saveBtn = page.locator('button:has-text("Save & continue")');
  if (await saveBtn.isVisible().catch(() => false)) {
    await saveBtn.click();
    console.log('  Clicked "Save & continue"');
    await settle(page, 3000);
  } else {
    // Try alternative button text
    const altBtn = page.locator('button:has-text("Save")').first();
    if (await altBtn.isVisible().catch(() => false)) {
      await altBtn.click();
      console.log('  Clicked "Save" button');
      await settle(page, 3000);
    }
  }

  await ss(page, 'goal-saved');
  await logUrl(page);
}

// ---------------------------------------------------------------------------
// Step 4: Borrowers (Step 2 of 8) — Fill borrower form
// ---------------------------------------------------------------------------

async function fillBorrowerForm(page: Page, profile: TestProfile) {
  console.log('\n=== Step 4: Borrower Form (Step 2 of 8) ===');
  await dismissCookies(page);
  await settle(page, 2000);

  // Check if we're on the borrower form (has "Save Borrower" button)
  const saveBorrowerBtn = page.locator('button:has-text("Save Borrower")');
  if (!await saveBorrowerBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    // Maybe we're on the borrower summary page — check for "Edit details" or "Add a borrower"
    const editBtn = page.locator('text=Edit details');
    if (await editBtn.isVisible().catch(() => false)) {
      console.log('  [info] On borrower summary — borrower already exists');
      // Click edit to fix incomplete fields
      await editBtn.click();
      console.log('  Clicked "Edit details"');
      await settle(page, 2000);
    } else {
      console.log('  [warn] Not on borrower form, taking screenshot');
      await ss(page, 'borrower-unexpected');
      return;
    }
  }

  await ss(page, 'borrower-form-start');

  // --- Personal Details ---

  // First time buyer: Yes / No
  const ftbText = profile.firstTimeBuyer ? 'Yes' : 'No';
  await safeClick(page, ftbText, 'First time buyer');
  await settle(page, 300);

  // --- Scan and categorize all dropdowns BEFORE clicking manual address ---
  // (Country dropdown should be visible now)
  console.log('  --- Categorizing dropdowns (pre-manual-address) ---');
  let selects = await categorizeSelects(page);

  // Marital status
  await safeSelect(selects.maritalStatus, profile.maritalStatus, 'Marital status');
  await settle(page, 300);

  // Date of birth
  await safeSelect(selects.dob.month, profile.dob.month, 'DOB Month');
  await settle(page, 200);
  await safeSelect(selects.dob.day, profile.dob.day, 'DOB Day');
  await settle(page, 200);
  await safeSelect(selects.dob.year, profile.dob.year, 'DOB Year');
  await settle(page, 200);

  // Number of dependents
  await safeSelect(selects.dependents, profile.dependents, 'Dependents');
  await settle(page, 300);

  // --- Living History ---

  // Country
  await safeSelect(selects.country, 'Canada', 'Country');
  await settle(page, 500);

  // Click "Or enter address manually" to get individual address fields
  const manualLink = page.locator('text=enter address manually');
  if (await manualLink.isVisible().catch(() => false)) {
    await manualLink.click();
    console.log('  Clicked "Or enter address manually"');
    await settle(page, 1000);
  }

  // Fill manual address fields — Finmo uses separate fields:
  // Street number, Street name, Street type (dropdown), Street direction (dropdown),
  // Unit, City, Province (dropdown), Country (dropdown), Postal code
  console.log('  --- Filling address fields ---');
  const inputs = await page.locator('input:visible').all();
  for (const input of inputs) {
    const name = ((await input.getAttribute('name')) ?? '').toLowerCase();
    const ph = ((await input.getAttribute('placeholder')) ?? '').toLowerCase();
    const label = ((await input.getAttribute('aria-label')) ?? '').toLowerCase();
    const combined = `${name} ${ph} ${label}`;

    // Log all address-area inputs for debugging
    if (combined.includes('street') || combined.includes('city') || combined.includes('postal')
        || combined.includes('unit') || combined.includes('number') || combined.includes('address')) {
      console.log(`  [debug] input name="${name}" ph="${ph}" label="${label}"`);
    }

    // Street number field
    if (combined.includes('streetnumber') || combined.includes('street number')
        || (name.includes('number') && !name.includes('phone') && !name.includes('sin') && !name.includes('dependant'))) {
      const current = await input.inputValue();
      if (!current || current === profile.address.streetNumber) {
        await input.fill(profile.address.streetNumber);
        console.log(`  [fill] Street number (${name}): ${profile.address.streetNumber}`);
      }
    }
    // Street name field
    else if (combined.includes('streetname') || combined.includes('street name')
             || (name === 'streetname' || name === 'street_name' || name === 'name' && combined.includes('street'))) {
      await input.fill(profile.address.streetName);
      console.log(`  [fill] Street name (${name}): ${profile.address.streetName}`);
    }
    // City field
    else if (combined.includes('city') || combined.includes('town')) {
      await input.fill(profile.address.city);
      console.log(`  [fill] City (${name}): ${profile.address.city}`);
    }
    // Postal code field
    else if (combined.includes('postal') || combined.includes('zip')) {
      await input.fill(profile.address.postalCode);
      console.log(`  [fill] Postal code (${name}): ${profile.address.postalCode}`);
    }
    // Skip unit field (optional)
  }

  // Street type and Province — just select by label
  await settle(page, 500);
  try {
    const streetType = page.getByLabel('Street type');
    await streetType.selectOption({ label: profile.address.streetType });
    console.log(`  [select] Street type: ${profile.address.streetType}`);
  } catch (err) {
    console.log(`  [warn] Street type: ${err}`);
  }
  try {
    const province = page.getByLabel('Province');
    await province.selectOption({ label: profile.address.province });
    console.log(`  [select] Province: ${profile.address.province}`);
  } catch (err) {
    console.log(`  [warn] Province: ${err}`);
  }

  // Living situation
  await safeClick(page, profile.livingSituation, 'Living situation');
  await settle(page, 300);

  // Move in date — re-categorize to pick up the second set of Month/Day/Year
  await safeSelect(selects.moveIn.month, profile.moveInDate.month, 'Move-in Month');
  await settle(page, 200);
  await safeSelect(selects.moveIn.day, profile.moveInDate.day, 'Move-in Day');
  await settle(page, 200);
  await safeSelect(selects.moveIn.year, profile.moveInDate.year, 'Move-in Year');
  await settle(page, 300);

  await ss(page, 'borrower-form-filled');

  // --- Save Borrower ---
  console.log('  --- Saving borrower ---');
  const saveBtn = page.locator('button:has-text("Save Borrower")').first();
  await saveBtn.click();
  console.log('  Clicked "Save Borrower"');
  await settle(page, 3000);
  await ss(page, 'borrower-saved');

  // Check for validation errors
  const bodyText = (await page.locator('body').textContent()) ?? '';
  if (bodyText.includes('Please address the following errors')) {
    console.log('  [ERROR] Validation errors after save!');
    // Log the errors
    const errorList = await page.locator('li').allTextContents();
    for (const err of errorList.slice(0, 5)) {
      console.log(`    - ${err}`);
    }
    await ss(page, 'borrower-errors');
    return;
  }

  console.log('  Borrower saved successfully');
}

// ---------------------------------------------------------------------------
// Step 5: Borrower summary → Finish adding borrowers
// ---------------------------------------------------------------------------

async function finishBorrowers(page: Page) {
  console.log('\n=== Step 5: Finish Adding Borrowers ===');
  await settle(page, 1000);

  // Check we're on the summary page
  const finishBtn = page.locator('button:has-text("Finish adding borrowers")');
  if (await finishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    // Log borrower status
    const bodyText = (await page.locator('body').textContent()) ?? '';
    if (bodyText.includes('Incomplete')) {
      console.log('  [warn] DOB or living history still incomplete');
    }
    if (bodyText.includes('needs 3 years')) {
      console.log('  [warn] Living history needs 3 years');
    }

    await finishBtn.click();
    console.log('  Clicked "Finish adding borrowers"');
    await settle(page, 3000);
    await ss(page, 'borrowers-finished');
    await logUrl(page);
  } else {
    console.log('  [warn] "Finish adding borrowers" not found');
    await ss(page, 'borrowers-check');
  }
}

// ---------------------------------------------------------------------------
// Steps 6+: Income, Assets, Properties, Professionals, Consent, etc.
// ---------------------------------------------------------------------------

async function fillRemainingSteps(page: Page) {
  console.log('\n=== Steps 6+: Remaining Form Sections ===');

  for (let step = 1; step <= 30; step++) {
    await settle(page, 2000);
    await dismissCookies(page);

    const bodyText = (await page.locator('body').textContent()) ?? '';
    const url = page.url();
    console.log(`\n--- Remaining step ${step} ---`);
    console.log(`  [url] ${url}`);
    const pagePreview = bodyText.replace(/\s+/g, ' ').trim().slice(0, 200);
    console.log(`  [text] ${pagePreview}`);

    // Check if done
    if (bodyText.includes('Thank you') || bodyText.includes('Application submitted') || bodyText.includes('Congratulations')) {
      console.log('\n=== Application submitted! ===');
      await ss(page, 'submitted');
      break;
    }

    // Check if we hit "Review and submit"
    if (bodyText.includes('Review and submit') && bodyText.includes('Submit application')) {
      console.log('  [info] On Review page');
      const submitBtn = page.locator('button:has-text("Submit application")');
      if (await submitBtn.isVisible().catch(() => false)) {
        await ss(page, 'review-page');
        await submitBtn.click();
        console.log('  Clicked "Submit application"');
        await settle(page, 5000);
        await ss(page, 'after-submit');
        break;
      }
    }

    await ss(page, `remaining-${step}`);

    // Log visible form fields for debugging
    const fields = await page.locator('input:visible, select:visible, textarea:visible').all();
    for (const field of fields.slice(0, 8)) {
      const tag = await field.evaluate(el => el.tagName.toLowerCase());
      const name = await field.getAttribute('name');
      const ph = await field.getAttribute('placeholder');
      const type = await field.getAttribute('type');
      console.log(`  [field] ${tag} name=${name} type=${type} ph=${ph}`);
    }

    // Log visible buttons
    const buttons = await page.locator('button:visible').all();
    for (const btn of buttons.slice(0, 5)) {
      const text = (await btn.textContent())?.trim();
      if (text && text.length < 50) {
        console.log(`  [button] "${text}"`);
      }
    }

    // Try clicking progress buttons in priority order
    const btnSelectors = [
      'button:visible:has-text("Save & continue")',
      'button:visible:has-text("Finish adding")',
      'button:visible:has-text("Next")',
      'button:visible:has-text("Continue")',
      'button:visible:has-text("Save")',
      'button:visible:has-text("Skip")',
    ];

    let clicked = false;
    for (const sel of btnSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        const text = (await btn.textContent())?.trim();
        // Skip "Cancel" or "Save Borrower" if they appear
        if (text?.includes('Cancel')) continue;
        console.log(`  [click] "${text}"`);
        await btn.click();
        clicked = true;
        await settle(page, 2000);
        break;
      }
    }

    if (!clicked) {
      console.log('  [info] No progress button found — stopping');
      await ss(page, 'stuck');
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const profileArg = process.argv.find(a => a.startsWith('--profile='));
  const profileId = profileArg ? parseInt(profileArg.split('=')[1], 10) : 1;
  const profile = profiles.find(p => p.id === profileId) ?? profiles[0];

  console.log(`\n========================================`);
  console.log(`Finmo Application — ${profile.label}`);
  console.log(`Email: ${profile.email}`);
  console.log(`Profile: ${profileId}`);
  console.log(`========================================\n`);

  // Clean screenshots directory
  const files = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
  for (const f of files) {
    fs.unlinkSync(`${SCREENSHOT_DIR}/${f}`);
  }
  console.log(`Cleaned ${files.length} old screenshots\n`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await doSignup(page, profile);
    await goToApplication(page);
    await fillGoal(page, profile);
    await fillBorrowerForm(page, profile);
    await finishBorrowers(page);
    await fillRemainingSteps(page);
  } catch (err) {
    console.error('\n[ERROR]', err);
    await ss(page, 'error');
  }

  console.log('\nDone! Browser stays open for 120s...');
  await page.waitForTimeout(120000);
  await browser.close();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
