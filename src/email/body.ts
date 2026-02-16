/**
 * Email Body Generator — HTML
 *
 * Pure function that transforms a GeneratedChecklist into a formatted HTML
 * doc request email matching Cat's tone and structure.
 *
 * Structure:
 * 1. Greeting: "Hey [Names]!"
 * 2. Intro paragraph
 * 3. Per-borrower sections (underlined first name header, bold doc names)
 * 4. Per-property sections (underlined address header, bold doc names)
 * 5. "Other" section (shared items)
 * 6. Closing (send docs to inbox email + thanks)
 * 7. Signature (Cat Robert, Mortgage Agent)
 *
 * Max width 600px for email client compatibility.
 */

import type { GeneratedChecklist, ChecklistItem } from '../checklist/types/index.js';
import type { EmailContext } from './types.js';

// ---------------------------------------------------------------------------
// Template Constants
// ---------------------------------------------------------------------------

const INTRO_PARAGRAPH =
  "Thanks for filling out the application. As Taylor mentioned, I'll just collect some " +
  'supporting documents. We like to do the majority of document collection up front to ' +
  'ensure the accuracy of your pre-approval budget and it will also make the process ' +
  'easier down the line.';

const CLOSING_TEMPLATE =
  'You can send these documents directly to <a href="mailto:{docInboxEmail}">{docInboxEmail}</a> and if you have any questions let me know!';


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates an HTML email body from a GeneratedChecklist.
 *
 * @param checklist - The generated checklist from Phase 3
 * @param context - Email context with borrower names and doc inbox address
 * @returns HTML string for the email body
 */
export function generateEmailBody(
  checklist: GeneratedChecklist,
  context: EmailContext,
): string {
  const parts: string[] = [];

  // 1. Greeting
  parts.push(`<p>Hey ${esc(context.borrowerFirstNames.join(' and '))}!</p>`);

  // 2. Intro paragraph
  parts.push(`<p>${esc(INTRO_PARAGRAPH)}</p>`);

  // 3. Per-borrower sections
  for (const bc of checklist.borrowerChecklists) {
    const firstName = bc.borrowerName.split(' ')[0];
    const emailItems = bc.items.filter(i => i.forEmail);
    if (emailItems.length > 0) {
      parts.push(formatItemSection(firstName, emailItems));
    }
  }

  // 4. Per-property sections
  for (const pc of checklist.propertyChecklists) {
    const emailItems = pc.items.filter(i => i.forEmail);
    if (emailItems.length > 0) {
      parts.push(formatItemSection(`${pc.propertyDescription}:`, emailItems));
    }
  }

  // 5. Shared "Other" section
  const sharedEmailItems = checklist.sharedItems.filter(i => i.forEmail);
  if (sharedEmailItems.length > 0) {
    parts.push(formatItemSection('Other', sharedEmailItems));
  }

  // 6. Closing
  const closing = CLOSING_TEMPLATE
    .replace(/\{docInboxEmail\}/g, esc(context.docInboxEmail));
  parts.push(`<p>${closing}</p>`);
  parts.push('<p>Thanks!</p>');

  // Signature is handled by Gmail's auto-signature (Cat has hers configured)

  // Wrap in max-width container
  const body = parts.join('\n');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#333;max-width:600px;">\n${body}\n</div>`;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/** Escape HTML special characters */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formats a section with an underlined header and bulleted list.
 * Doc names are bold. Notes appear inline in normal weight.
 */
function formatItemSection(header: string, items: ChecklistItem[]): string {
  const listItems = items.map(item => {
    const docName = `<strong>${esc(item.displayName)}</strong>`;
    if (item.notes) {
      const note = ` (${esc(item.notes.charAt(0).toLowerCase())}${esc(item.notes.slice(1))})`;
      return `  <li>${docName}${note}</li>`;
    }
    return `  <li>${docName}</li>`;
  });

  return `<p style="margin-bottom:4px;"><u>${esc(header)}</u></p>\n<ul style="margin-top:0;padding-left:20px;">\n${listItems.join('\n')}\n</ul>`;
}
