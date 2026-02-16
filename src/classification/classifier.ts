/**
 * Document Classifier — Claude API with Structured Output
 *
 * Sends a PDF document to Claude for classification. Returns a structured
 * ClassificationResult with document type, confidence, borrower info, and metadata.
 *
 * Features:
 * - Claude Haiku 4.5 with structured output (guaranteed valid JSON)
 * - Large PDF truncation (only first N pages sent for classification)
 * - Filename hint as secondary signal
 * - No PII in logs (only doc type + confidence logged)
 *
 * Consumers: classification-worker.ts (Phase 7 Plan 05)
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PDFDocument } from 'pdf-lib';
import { classificationConfig } from './config.js';
import { ClassificationResultSchema, DOCUMENT_TYPES } from './types.js';
import type { ClassificationResult } from './types.js';

// ---------------------------------------------------------------------------
// Anthropic Client (lazy singleton)
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic({ apiKey: classificationConfig.anthropicApiKey });
  return _client;
}

// ---------------------------------------------------------------------------
// PDF Truncation
// ---------------------------------------------------------------------------

/**
 * Truncate a PDF to the first `maxPages` pages.
 * Returns the original buffer if the PDF has fewer pages than the limit.
 */
export async function truncatePdf(pdfBuffer: Buffer, maxPages: number): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(new Uint8Array(pdfBuffer));
  const pageCount = srcDoc.getPageCount();

  if (pageCount <= maxPages) {
    return pdfBuffer;
  }

  // Create a new document with only the first maxPages pages
  const newDoc = await PDFDocument.create();
  const pages = srcDoc.getPages();
  const pagesToCopy = pages.slice(0, maxPages);
  const copiedPages = await newDoc.copyPages(srcDoc, pagesToCopy.map((_, i) => i));

  for (const page of copiedPages) {
    newDoc.addPage(page);
  }

  const truncatedBytes = await newDoc.save();
  return Buffer.from(truncatedBytes);
}

// ---------------------------------------------------------------------------
// Classification Prompt
// ---------------------------------------------------------------------------

function classificationPrompt(filenameHint?: string): string {
  const docTypes = DOCUMENT_TYPES.join(', ');

  const filenameSection = filenameHint
    ? `\n\nThe original filename was: "${filenameHint}" — use this as a secondary hint only. Always prioritize the document content over the filename.`
    : '';

  return `Classify this Canadian mortgage document. Identify the document type, who it belongs to, and extract key metadata.

Known document types: ${docTypes}

Instructions:
- Set documentType to the most specific match from the list above.
- Set confidence between 0.0 and 1.0. If you are uncertain, set it below 0.7.
- Extract the borrower's first and last name if visible on the document.
- Extract the tax year if this is a tax document (T4, T1, NOA, T5, etc.).
- Extract the dollar amount if clearly visible (use Cat's format: "$16k", "$5.2k", "$585").
- Extract the institution/employer name if visible.
- Set pageCount to the number of pages in the document.
- Use additionalNotes for any other relevant context.
- If the document does not match any specific type, use "other".${filenameSection}`;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify a PDF document using Claude API with structured output.
 *
 * @param pdfBuffer - The PDF file as a Buffer
 * @param filenameHint - Optional original filename (secondary classification signal)
 * @returns Validated ClassificationResult
 */
export async function classifyDocument(
  pdfBuffer: Buffer,
  filenameHint?: string,
): Promise<ClassificationResult> {
  // Truncate large PDFs to save tokens
  const truncatedBuffer = await truncatePdf(
    pdfBuffer,
    classificationConfig.maxClassificationPages,
  );

  const response = await getClient().messages.create({
    model: classificationConfig.model,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: truncatedBuffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text: classificationPrompt(filenameHint),
          },
        ],
      },
    ],
    output_config: {
      format: zodOutputFormat(ClassificationResultSchema),
    },
  });

  // Parse and validate the structured output
  const textBlock = response.content[0];
  const rawResult = JSON.parse((textBlock as { text: string }).text);
  const validated = ClassificationResultSchema.parse(rawResult);

  return validated;
}
