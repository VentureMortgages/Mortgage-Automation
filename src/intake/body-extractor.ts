/**
 * Body Extractor — Forwarding Notes Parser
 *
 * When Cat forwards an email to docs@, she can type a note above the
 * forwarded content to tell the system who a doc belongs to:
 *   "John Smith"            → clientName
 *   "John Smith - paystub"  → clientName + docTypeHint
 *   "john@example.com"      → clientEmail
 *   "john@example.com - T4" → clientEmail + docTypeHint
 *
 * This module extracts and parses those notes from the Gmail MIME payload.
 *
 * Consumers: intake-worker.ts (Phase 23)
 */

import type { gmail_v1 } from 'googleapis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForwardingNotes {
  clientName?: string;
  clientEmail?: string;
  docTypeHint?: string;
  rawNote: string;
}

// ---------------------------------------------------------------------------
// MIME Body Extraction
// ---------------------------------------------------------------------------

/** Gmail forward delimiter (standard format) */
const FORWARD_DELIMITERS = [
  '---------- Forwarded message ---------',
  '---------- Forwarded message ----------',
  '-----Original Message-----',
  '-------- Original Message --------',
];

const EMAIL_PATTERN = /(\S+@\S+\.\S+)/;
const SEPARATOR_PATTERN = /\s+[-—–]\s+/;

/**
 * Walk MIME parts to find the text/plain body (no attachment).
 * Returns the decoded text, or null if not found.
 */
function findPlainTextBody(payload: gmail_v1.Schema$MessagePart): string | null {
  // Direct body on this part
  if (
    payload.mimeType === 'text/plain' &&
    !payload.filename &&
    payload.body?.data
  ) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  // Recurse into nested parts
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = findPlainTextBody(part);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Extract and parse forwarding notes from a Gmail message payload.
 *
 * @param payload - The Gmail message payload (from format: 'full')
 * @returns Parsed forwarding notes, or null if no forward delimiter found
 */
export function extractForwardingNotes(
  payload: gmail_v1.Schema$MessagePart | undefined,
): ForwardingNotes | null {
  if (!payload) return null;

  const bodyText = findPlainTextBody(payload);
  if (!bodyText) return null;

  // Find the forward delimiter
  let noteText: string | null = null;
  for (const delimiter of FORWARD_DELIMITERS) {
    const idx = bodyText.indexOf(delimiter);
    if (idx !== -1) {
      noteText = bodyText.substring(0, idx).trim();
      break;
    }
  }

  // No forward delimiter found — not a forwarded message
  if (noteText === null || noteText.length === 0) return null;

  // Clean up: remove signature lines, blank lines, etc.
  const lines = noteText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return null;

  // Use the first non-empty line as the note (Cat's annotation)
  const note = lines[0];

  return parseForwardingNote(note);
}

/**
 * Parse a single-line forwarding note into structured fields.
 *
 * Patterns:
 *   "john@example.com"          → { clientEmail }
 *   "john@example.com - T4"     → { clientEmail, docTypeHint }
 *   "John Smith"                → { clientName }
 *   "John Smith - paystub"      → { clientName, docTypeHint }
 */
export function parseForwardingNote(note: string): ForwardingNotes {
  const result: ForwardingNotes = { rawNote: note };

  // Check if there's a separator (dash/em dash)
  const sepMatch = note.match(SEPARATOR_PATTERN);
  let identifierPart: string;
  let hintPart: string | undefined;

  if (sepMatch && sepMatch.index !== undefined) {
    identifierPart = note.substring(0, sepMatch.index).trim();
    hintPart = note.substring(sepMatch.index + sepMatch[0].length).trim();
    if (hintPart) {
      result.docTypeHint = hintPart;
    }
  } else {
    identifierPart = note.trim();
  }

  // Check if identifier is an email
  const emailMatch = identifierPart.match(EMAIL_PATTERN);
  if (emailMatch) {
    result.clientEmail = emailMatch[1];
  } else if (identifierPart.length >= 2) {
    result.clientName = identifierPart;
  }

  return result;
}
