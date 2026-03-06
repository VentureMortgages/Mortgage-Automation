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
 * Phase 25: AI-powered parser handles multi-client notes:
 *   "Srimal and Carolyn Wong-Ranasinghe ID's and Srimal's Statement of Account"
 *   → clients: [Srimal, Carolyn], docs: [{Srimal, ID}, {Carolyn, ID}, {Srimal, SOA}]
 *
 * Falls back to regex parser if AI call fails.
 *
 * Consumers: intake-worker.ts (Phase 23, Phase 25)
 */

import type { gmail_v1 } from 'googleapis';
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import { classificationConfig } from '../classification/config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForwardingNoteDoc {
  client: string;
  type: string;
}

export interface ForwardingNotes {
  // Legacy single-client fields (backward-compatible)
  clientName?: string;
  clientEmail?: string;
  docTypeHint?: string;
  rawNote: string;
  // New multi-client fields (Phase 25)
  clients?: string[];
  docs?: ForwardingNoteDoc[];
}

// ---------------------------------------------------------------------------
// AI Parser — Gemini Structured Output (Phase 25)
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /(\S+@\S+\.\S+)/;

/** Gemini response schema for forwarding note parsing */
const forwardingNoteSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    clients: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Client names or email addresses mentioned in the note',
    },
    docs: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          client: {
            type: SchemaType.STRING,
            description: 'The client this document belongs to',
          },
          type: {
            type: SchemaType.STRING,
            description: 'The document type (e.g., ID, paystub, T4, Statement of Account)',
          },
        },
        required: ['client', 'type'],
      },
      description: 'Per-client document type assignments',
    },
    rawNote: {
      type: SchemaType.STRING,
      description: 'The original forwarding note text',
    },
  },
  required: ['clients', 'docs', 'rawNote'],
};

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (_genAI) return _genAI;
  _genAI = new GoogleGenerativeAI(classificationConfig.geminiApiKey);
  return _genAI;
}

/**
 * Parse a forwarding note using Gemini Flash structured output.
 *
 * Extracts client names and per-document type assignments from natural
 * language notes like "Srimal and Carolyn's IDs and Srimal's SOA".
 *
 * @param noteText - The forwarding note text (above the forward delimiter)
 * @returns Parsed ForwardingNotes with multi-client support, or null on failure
 */
export async function parseForwardingNoteAI(noteText: string): Promise<ForwardingNotes | null> {
  try {
    const model = getGenAI().getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: forwardingNoteSchema,
      },
    });

    const result = await model.generateContent([
      {
        text: `Parse this forwarding note from a mortgage broker's assistant. Extract client names and document type assignments. If a doc type is mentioned for a specific client, assign it to that client. If docs are mentioned generally (e.g., "IDs"), assign to all clients mentioned. Return the original note text as rawNote.

Note text: "${noteText}"`,
      },
    ]);

    const responseText = result.response.text();
    const parsed = JSON.parse(responseText) as {
      clients: string[];
      docs: Array<{ client: string; type: string }>;
      rawNote: string;
    };

    // Build the expanded ForwardingNotes
    const notes: ForwardingNotes = {
      rawNote: noteText,
      clients: parsed.clients,
      docs: parsed.docs,
    };

    // Populate legacy fields for backward compatibility
    if (parsed.clients.length > 0) {
      const firstClient = parsed.clients[0];
      const emailMatch = firstClient.match(EMAIL_PATTERN);
      if (emailMatch) {
        notes.clientEmail = emailMatch[1];
      } else {
        notes.clientName = firstClient;
      }
    }

    if (parsed.docs.length > 0) {
      notes.docTypeHint = parsed.docs[0].type;
    }

    return notes;
  } catch (err) {
    console.warn('[body-extractor] AI parser failed, will fall back to regex:', err instanceof Error ? err.message : String(err));
    return null;
  }
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

const SEPARATOR_PATTERN = /\s+[-—–]\s+/;

/**
 * Walk MIME parts to find the text/plain body (no attachment).
 * Returns the decoded text, or null if not found.
 */
export function findPlainTextBody(payload: gmail_v1.Schema$MessagePart): string | null {
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
 * Phase 25: Now async — calls AI parser first, falls back to regex.
 *
 * @param payload - The Gmail message payload (from format: 'full')
 * @returns Parsed forwarding notes, or null if no forward delimiter found
 */
export async function extractForwardingNotes(
  payload: gmail_v1.Schema$MessagePart | undefined,
): Promise<ForwardingNotes | null> {
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

  // Phase 25: Try AI parser first, fall back to regex on failure
  const aiResult = await parseForwardingNoteAI(note);
  if (aiResult) return aiResult;

  // Fallback: regex parser (Phase 23 — unchanged)
  return parseForwardingNote(note);
}

/**
 * Parse a single-line forwarding note into structured fields.
 * This is the regex-based fallback parser (Phase 23).
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
