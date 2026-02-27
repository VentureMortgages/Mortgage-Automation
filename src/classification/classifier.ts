/**
 * Document Classifier — Google Gemini with Structured Output
 *
 * Sends a PDF document to Gemini for classification. Returns a structured
 * ClassificationResult with document type, confidence, borrower info, and metadata.
 *
 * Features:
 * - Gemini 2.0 Flash with JSON schema-constrained output
 * - Large PDF truncation (only first N pages sent for classification)
 * - Filename hint as secondary signal
 * - No PII in logs (only doc type + confidence logged)
 * - Zod validation as belt-and-suspenders after Gemini's schema enforcement
 *
 * Consumers: classification-worker.ts (Phase 7 Plan 05)
 */

import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import { PDFDocument } from 'pdf-lib';
import { classificationConfig } from './config.js';
import { ClassificationResultSchema, DOCUMENT_TYPES } from './types.js';
import type { ClassificationResult } from './types.js';

// ---------------------------------------------------------------------------
// Gemini Client (lazy singleton)
// ---------------------------------------------------------------------------

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (_genAI) return _genAI;
  _genAI = new GoogleGenerativeAI(classificationConfig.geminiApiKey);
  return _genAI;
}

// ---------------------------------------------------------------------------
// Gemini Response Schema (matches ClassificationResultSchema)
// ---------------------------------------------------------------------------

const classificationResponseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    documentType: {
      type: SchemaType.STRING,
      description: 'The classified document type',
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: 'Confidence score between 0.0 and 1.0',
    },
    borrowerFirstName: {
      type: SchemaType.STRING,
      description: 'First name of the borrower visible on the document',
      nullable: true,
    },
    borrowerLastName: {
      type: SchemaType.STRING,
      description: 'Last name of the borrower visible on the document',
      nullable: true,
    },
    taxYear: {
      type: SchemaType.NUMBER,
      description: 'Tax year if this is a tax document',
      nullable: true,
    },
    amount: {
      type: SchemaType.STRING,
      description: 'Dollar amount in Cat format ($16k, $5.2k, $585)',
      nullable: true,
    },
    institution: {
      type: SchemaType.STRING,
      description: 'Institution or employer name visible on the document',
      nullable: true,
    },
    pageCount: {
      type: SchemaType.NUMBER,
      description: 'Number of pages in the document',
    },
    additionalNotes: {
      type: SchemaType.STRING,
      description: 'Any other relevant context about the document',
      nullable: true,
    },
  },
  required: ['documentType', 'confidence', 'pageCount'],
};

// ---------------------------------------------------------------------------
// PDF Truncation
// ---------------------------------------------------------------------------

/**
 * Truncate a PDF to the first `maxPages` pages.
 * Returns the original buffer if the PDF has fewer pages than the limit.
 */
export async function truncatePdf(pdfBuffer: Buffer, maxPages: number): Promise<Buffer> {
  try {
    const srcDoc = await PDFDocument.load(new Uint8Array(pdfBuffer), {
      ignoreEncryption: true,
    });
    const pageCount = srcDoc.getPageCount();

    if (pageCount <= maxPages) {
      return pdfBuffer;
    }

    const newDoc = await PDFDocument.create();
    const pages = srcDoc.getPages();
    const pagesToCopy = pages.slice(0, maxPages);
    const copiedPages = await newDoc.copyPages(srcDoc, pagesToCopy.map((_, i) => i));

    for (const page of copiedPages) {
      newDoc.addPage(page);
    }

    const truncatedBytes = await newDoc.save();
    return Buffer.from(truncatedBytes);
  } catch {
    // If truncation fails for any reason (encrypted, malformed, etc.),
    // skip truncation and send the full buffer to Gemini
    return pdfBuffer;
  }
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
- If the document does not match any specific type, use "other".

Classification guidance for commonly confused types:
- photo_id vs passport: If the document is any form of government-issued photo ID used for identity verification in a mortgage application (driver's license, passport, health card, PR card), classify it as "photo_id". Only use "passport" for full passport booklet pages showing travel stamps or visa information, not a passport used as ID.
- loe vs employment_contract: A Letter of Employment (LOE) is a brief letter from an employer confirming current employment status, position, salary, and start date. Classify these as "loe". Only use "employment_contract" for formal multi-page contracts with terms, clauses, termination conditions, and signatures.
- rrsp_statement vs bank_statement: If the account is labelled RRSP, RSP, or Registered Retirement Savings Plan, classify as "rrsp_statement" even if it looks like a bank statement. Similarly, TFSA accounts are "tfsa_statement" and FHSA accounts are "fhsa_statement".${filenameSection}`;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify a PDF document using Gemini API with structured output.
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

  const model = getGenAI().getGenerativeModel({
    model: classificationConfig.model,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: classificationResponseSchema,
    },
  });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'application/pdf',
        data: truncatedBuffer.toString('base64'),
      },
    },
    { text: classificationPrompt(filenameHint) },
  ]);

  const responseText = result.response.text();

  // Parse and validate with Zod (belt-and-suspenders)
  const rawResult = JSON.parse(responseText);
  const validated = ClassificationResultSchema.parse(rawResult);

  return validated;
}
