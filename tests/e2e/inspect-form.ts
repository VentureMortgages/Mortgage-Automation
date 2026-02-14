/**
 * Quick script to inspect the Finmo application form structure.
 * Run: npx tsx tests/e2e/inspect-form.ts
 */
import { chromium } from 'playwright';

async function inspectForm() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Loading form...');
  await page.goto('https://venture-mortgages.mtg-app.com/signup', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Wait for the form to render
  await page.waitForTimeout(3000);

  // Take a screenshot
  await page.screenshot({ path: 'tests/e2e/form-screenshot.png', fullPage: true });
  console.log('Screenshot saved to tests/e2e/form-screenshot.png');

  // Get all visible text content
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('\n=== PAGE TEXT ===');
  console.log(pageText);

  // Get all form elements
  const formElements = await page.evaluate(() => {
    const elements: Array<{
      tag: string;
      type?: string;
      name?: string;
      id?: string;
      placeholder?: string;
      label?: string;
      options?: string[];
      required?: boolean;
      visible: boolean;
    }> = [];

    // Find all inputs, selects, textareas
    const inputs = document.querySelectorAll('input, select, textarea, [role="combobox"], [role="listbox"], [role="radio"], [role="checkbox"]');
    inputs.forEach((el) => {
      const htmlEl = el as HTMLInputElement;
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0;

      // Try to find associated label
      let label = '';
      const labelEl = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
      if (labelEl) label = labelEl.textContent?.trim() || '';

      // For parent containers with label text
      if (!label) {
        const parent = el.parentElement;
        if (parent) {
          const siblingLabel = parent.querySelector('label, .label, [class*="label"]');
          if (siblingLabel) label = siblingLabel.textContent?.trim() || '';
        }
      }

      const item: any = {
        tag: el.tagName.toLowerCase(),
        type: htmlEl.type || undefined,
        name: htmlEl.name || undefined,
        id: el.id || undefined,
        placeholder: htmlEl.placeholder || undefined,
        label: label || undefined,
        required: htmlEl.required || undefined,
        visible: isVisible,
      };

      // Get select options
      if (el.tagName === 'SELECT') {
        const selectEl = el as HTMLSelectElement;
        item.options = Array.from(selectEl.options).map(o => `${o.value}: ${o.text}`);
      }

      elements.push(item);
    });

    return elements;
  });

  console.log('\n=== FORM ELEMENTS ===');
  console.log(JSON.stringify(formElements.filter(e => e.visible), null, 2));

  // Also get all buttons
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        text: el.textContent?.trim(),
        type: (el as HTMLButtonElement).type,
        visible: el.getBoundingClientRect().width > 0,
      }))
      .filter(b => b.visible);
  });

  console.log('\n=== BUTTONS ===');
  console.log(JSON.stringify(buttons, null, 2));

  // Look for any step indicators
  const steps = await page.evaluate(() => {
    const stepElements = document.querySelectorAll('[class*="step"], [class*="progress"], [class*="wizard"], [class*="tab"]');
    return Array.from(stepElements).map(el => ({
      class: el.className,
      text: el.textContent?.trim().substring(0, 100),
    }));
  });

  if (steps.length > 0) {
    console.log('\n=== STEP INDICATORS ===');
    console.log(JSON.stringify(steps, null, 2));
  }

  await browser.close();
  console.log('\nDone!');
}

inspectForm().catch(console.error);
