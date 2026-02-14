/**
 * Email Body Generator
 *
 * Pure function that transforms a GeneratedChecklist into a formatted,
 * personalized doc request email matching Cat's exact tone and structure
 * from EMAIL_TEMPLATE_REFERENCE.md.
 *
 * Structure:
 * 1. Greeting: "Hey [Names]!"
 * 2. Intro paragraph (standard explanation of upfront doc collection)
 * 3. Per-borrower sections (first name as header, forEmail items listed)
 * 4. Per-property sections (address as header, forEmail items listed)
 * 5. "Other" section (shared forEmail items)
 * 6. Closing (send docs to inbox email + thanks)
 *
 * Uses \n for line breaks (MIME encoder handles CRLF conversion).
 */

import type { GeneratedChecklist, ChecklistItem } from '../checklist/types/index.js';
import type { EmailContext } from './types.js';

// ---------------------------------------------------------------------------
// Template Constants (easy to edit without changing logic)
// ---------------------------------------------------------------------------

/** Standard intro paragraph matching Cat's tone */
const INTRO_PARAGRAPH =
  "Thanks for filling out the application. As Taylor mentioned, I'll just collect some " +
  'supporting documents. We like to do the majority of document collection up front to ' +
  'ensure the accuracy of your pre-approval budget and it will also make the process ' +
  'easier down the line.';

/** Closing line template — {docInboxEmail} is replaced at runtime */
const CLOSING_TEMPLATE =
  'You can send these documents directly to {docInboxEmail} and if you have any questions let me know!';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates the email body text from a GeneratedChecklist.
 * Matches Cat's tone and structure from EMAIL_TEMPLATE_REFERENCE.md.
 *
 * @param checklist - The generated checklist from Phase 3
 * @param context - Email context with borrower names and doc inbox address
 * @returns Formatted plain text email body
 */
export function generateEmailBody(
  checklist: GeneratedChecklist,
  context: EmailContext,
): string {
  const sections: string[] = [];

  // 1. Greeting
  sections.push(`Hey ${context.borrowerFirstNames.join(' and ')}!`);

  // 2. Intro paragraph
  sections.push(INTRO_PARAGRAPH);

  // 3. Per-borrower sections
  for (const bc of checklist.borrowerChecklists) {
    const firstName = bc.borrowerName.split(' ')[0];
    const emailItems = bc.items.filter(i => i.forEmail);
    if (emailItems.length > 0) {
      sections.push(formatItemSection(firstName, emailItems));
    }
  }

  // 4. Per-property sections
  for (const pc of checklist.propertyChecklists) {
    const emailItems = pc.items.filter(i => i.forEmail);
    if (emailItems.length > 0) {
      sections.push(formatItemSection(`${pc.propertyDescription}:`, emailItems));
    }
  }

  // 5. Shared "Other" section
  const sharedEmailItems = checklist.sharedItems.filter(i => i.forEmail);
  if (sharedEmailItems.length > 0) {
    sections.push(formatItemSection('Other', sharedEmailItems));
  }

  // 6. Closing
  const closing = CLOSING_TEMPLATE.replace('{docInboxEmail}', context.docInboxEmail);
  sections.push(`${closing}\n\nThanks!`);

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a section with a header and item list.
 * Each item is on its own line. Items with notes have the note indented below.
 */
function formatItemSection(header: string, items: ChecklistItem[]): string {
  const lines: string[] = [header];
  for (const item of items) {
    lines.push(item.displayName);
    if (item.notes) {
      lines.push(`  ${item.notes}`);
    }
  }
  return lines.join('\n');
}
