/**
 * Diff Analyzer — Uses Gemini to compare original vs sent email
 *
 * Sends both HTML versions to Gemini 2.0 Flash with structured JSON output
 * to extract what Cat changed. Uses the same @google/generative-ai package
 * and pattern as src/classification/classifier.ts.
 *
 * Consumers: capture.ts
 */

import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import { classificationConfig } from '../classification/config.js';
import type { EmailEdits } from './types.js';

// ---------------------------------------------------------------------------
// Gemini Client (lazy singleton — shared API key with classifier)
// ---------------------------------------------------------------------------

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (_genAI) return _genAI;
  _genAI = new GoogleGenerativeAI(classificationConfig.geminiApiKey);
  return _genAI;
}

// ---------------------------------------------------------------------------
// Response Schema (matches EmailEdits)
// ---------------------------------------------------------------------------

const editsResponseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    itemsRemoved: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Document names that were removed from the email',
    },
    itemsAdded: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Document names that were added to the email',
    },
    itemsReworded: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          original: { type: SchemaType.STRING, description: 'Original wording' },
          modified: { type: SchemaType.STRING, description: 'Modified wording' },
        },
        required: ['original', 'modified'],
      },
      description: 'Documents whose wording was changed',
    },
    sectionsReordered: {
      type: SchemaType.BOOLEAN,
      description: 'Whether sections were reordered',
    },
    otherChanges: {
      type: SchemaType.STRING,
      description: 'Any other changes not covered above',
      nullable: true,
    },
    noChanges: {
      type: SchemaType.BOOLEAN,
      description: 'True if no meaningful changes were made',
    },
  },
  required: ['itemsRemoved', 'itemsAdded', 'itemsReworded', 'sectionsReordered', 'noChanges'],
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const DIFF_PROMPT = `You are analyzing two versions of a mortgage document request email.

ORIGINAL is the auto-generated email draft.
SENT is the version that was manually edited and sent by the assistant.

Compare the two and extract structured changes:
- itemsRemoved: document names that were in the ORIGINAL but removed in SENT
- itemsAdded: document names that are in SENT but were NOT in ORIGINAL
- itemsReworded: documents whose description/wording was changed (provide both versions)
- sectionsReordered: true if the order of sections changed
- otherChanges: any other notable changes (greeting, closing, formatting) — null if none
- noChanges: true ONLY if the emails are essentially identical (ignore whitespace/formatting)

Focus on the document checklist items (bulleted lists). Ignore minor whitespace, HTML formatting, or signature differences.`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze the diff between original and sent email HTML using Gemini.
 *
 * @param originalHtml - The auto-generated email HTML
 * @param sentHtml - The email HTML as sent by Cat (after her edits)
 * @returns Structured EmailEdits describing the changes
 */
export async function analyzeEdits(
  originalHtml: string,
  sentHtml: string,
): Promise<EmailEdits> {
  const model = getGenAI().getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: editsResponseSchema,
    },
  });

  const result = await model.generateContent([
    { text: DIFF_PROMPT },
    { text: `ORIGINAL:\n${originalHtml}` },
    { text: `SENT:\n${sentHtml}` },
  ]);

  const responseText = result.response.text();
  return JSON.parse(responseText) as EmailEdits;
}
