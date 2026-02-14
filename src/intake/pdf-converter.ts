/**
 * PDF Converter Module
 *
 * Pure-function module that converts image attachments (JPEG, PNG) to PDF
 * using pdf-lib, passes PDFs through unchanged, and flags Word documents
 * for manual review.
 *
 * No native dependencies -- uses pdf-lib (pure JavaScript).
 *
 * Consumers: intake-worker.ts (Phase 6 Plan 04)
 * Inputs: Buffer + MIME type string
 * Outputs: ConversionResult (pdfBuffer, converted flag, optional skippedReason)
 * Errors: ConversionError with typed code property
 */

import { PDFDocument } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a PDF conversion attempt */
export interface ConversionResult {
  /** The output PDF buffer (same as input for PDFs, converted for images) */
  pdfBuffer: Buffer;
  /** Whether conversion was performed */
  converted: boolean;
  /** If conversion was skipped, the reason */
  skippedReason?: string;
}

/** Error codes for conversion failures */
export type ConversionErrorCode =
  | 'WORD_MANUAL_REVIEW'
  | 'UNSUPPORTED_TYPE'
  | 'CONVERSION_FAILED';

/** Typed error for conversion failures */
export class ConversionError extends Error {
  readonly code: ConversionErrorCode;

  constructor(code: ConversionErrorCode, message: string) {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// MIME type sets
// ---------------------------------------------------------------------------

const WORD_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
]);

// ---------------------------------------------------------------------------
// Core conversion function
// ---------------------------------------------------------------------------

/**
 * Converts a buffer to PDF based on its MIME type.
 *
 * - JPEG/PNG images: embeds into a new PDF page matching image dimensions
 * - PDF: passes through unchanged
 * - Word documents: throws ConversionError (requires manual review)
 * - Unsupported types: throws ConversionError
 * - Empty/corrupt input: throws ConversionError
 *
 * @param buffer - The raw file bytes
 * @param mimeType - The MIME type of the file
 * @returns ConversionResult with the PDF buffer and metadata
 * @throws ConversionError for unsupported types, Word docs, or corrupt input
 */
export async function convertToPdf(
  buffer: Buffer,
  mimeType: string,
): Promise<ConversionResult> {
  // Word documents: flag for manual review
  if (WORD_MIME_TYPES.has(mimeType)) {
    throw new ConversionError(
      'WORD_MANUAL_REVIEW',
      'Word document requires manual review — convert to PDF manually before intake',
    );
  }

  // Unsupported MIME types
  if (mimeType !== 'application/pdf' && !IMAGE_MIME_TYPES.has(mimeType)) {
    throw new ConversionError(
      'UNSUPPORTED_TYPE',
      `Unsupported MIME type for PDF conversion: ${mimeType}`,
    );
  }

  // PDF passthrough
  if (mimeType === 'application/pdf') {
    return {
      pdfBuffer: buffer,
      converted: false,
    };
  }

  // Image to PDF conversion (JPEG or PNG)
  // Validate non-empty input before attempting conversion
  if (buffer.length === 0) {
    throw new ConversionError(
      'CONVERSION_FAILED',
      'Cannot convert empty buffer to PDF',
    );
  }

  try {
    const pdfDoc = await PDFDocument.create();

    // pdf-lib's internal parsers expect plain Uint8Array, not Node.js Buffer
    // (Buffer extends Uint8Array but its internal memory layout can confuse
    // pdf-lib's marker scanning on some Node.js versions)
    const imageData = new Uint8Array(buffer);

    const image = mimeType === 'image/png'
      ? await pdfDoc.embedPng(imageData)
      : await pdfDoc.embedJpg(imageData);

    const { width, height } = image.scale(1);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });

    const pdfBytes = await pdfDoc.save();
    return {
      pdfBuffer: Buffer.from(pdfBytes),
      converted: true,
    };
  } catch (err) {
    // Re-throw ConversionError as-is (e.g., from empty buffer check)
    if (err instanceof ConversionError) {
      throw err;
    }

    // Wrap pdf-lib errors into ConversionError
    const message = err instanceof Error ? err.message : String(err);
    throw new ConversionError(
      'CONVERSION_FAILED',
      `Failed to convert ${mimeType} to PDF: ${message}`,
    );
  }
}
