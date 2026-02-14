/**
 * TDD Tests for PDF Converter Module
 *
 * Tests convertToPdf function for all supported MIME types:
 * - JPEG -> PDF conversion
 * - PNG -> PDF conversion
 * - PDF passthrough (unchanged)
 * - Word documents -> ConversionError (manual review)
 * - Unsupported MIME types -> ConversionError
 * - Empty/corrupt input -> ConversionError
 */

import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { convertToPdf, ConversionError } from '../pdf-converter.js';

// ---------------------------------------------------------------------------
// Test Fixtures: Minimal Valid Image Buffers
// ---------------------------------------------------------------------------

/**
 * Minimal valid JPEG: 1x1 white pixel (333 bytes).
 * Contains all required JPEG segments: SOI, APP0 (JFIF), DQT, SOF0, DHT (DC+AC), SOS, EOI.
 * Validated against pdf-lib's embedJpg parser.
 */
const MINIMAL_JPEG_HEX =
  'ffd8ffe000104a46494600010100000100010000' +
  'ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c' +
  '20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432' +
  'ffc0000b080001000101011100' +
  'ffc4001f0000010501010101010100000000000000000102030405060708090a0b' +
  'ffc400b5100002010303020403050504040000017d01020300041105122131410613516107' +
  '227114328191a1082342b1c11552d1f024336272820' +
  '90a161718191a25262728292a3435363738393a434445464748494a535455565758595a' +
  '636465666768696a737475767778797a838485868788898a92939495969798999a' +
  'a2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9ca' +
  'd2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9fa' +
  'ffda0008010100003f007b401bffd9';

/**
 * Minimal valid PNG: 1x1 white pixel (69 bytes).
 * Contains: PNG signature, IHDR (1x1 RGB 8-bit), IDAT (zlib-compressed), IEND.
 * Validated against pdf-lib's embedPng parser.
 */
const MINIMAL_PNG_HEX =
  '89504e470d0a1a0a' +
  '0000000d4948445200000001000000010802000000907753de' +
  '0000000c49444154789c63f8ffff3f0005fe02fe0def46b8' +
  '0000000049454e44ae426082';

const validJpegBuffer = Buffer.from(MINIMAL_JPEG_HEX, 'hex');
const validPngBuffer = Buffer.from(MINIMAL_PNG_HEX, 'hex');

/** Create a valid PDF buffer using pdf-lib for passthrough tests */
async function createValidPdfBuffer(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('convertToPdf', () => {
  // -------------------------------------------------------------------------
  // JPEG -> PDF
  // -------------------------------------------------------------------------
  describe('JPEG to PDF conversion', () => {
    it('converts a JPEG image to a valid PDF buffer', async () => {
      const result = await convertToPdf(validJpegBuffer, 'image/jpeg');

      expect(result.converted).toBe(true);
      expect(result.skippedReason).toBeUndefined();
      expect(result.pdfBuffer).toBeInstanceOf(Buffer);
      // PDF magic bytes
      expect(result.pdfBuffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    });

    it('produces a PDF parseable by PDFDocument.load', async () => {
      const result = await convertToPdf(validJpegBuffer, 'image/jpeg');
      const loaded = await PDFDocument.load(result.pdfBuffer);
      expect(loaded.getPageCount()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // PNG -> PDF
  // -------------------------------------------------------------------------
  describe('PNG to PDF conversion', () => {
    it('converts a PNG image to a valid PDF buffer', async () => {
      const result = await convertToPdf(validPngBuffer, 'image/png');

      expect(result.converted).toBe(true);
      expect(result.skippedReason).toBeUndefined();
      expect(result.pdfBuffer).toBeInstanceOf(Buffer);
      expect(result.pdfBuffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    });

    it('produces a PDF parseable by PDFDocument.load', async () => {
      const result = await convertToPdf(validPngBuffer, 'image/png');
      const loaded = await PDFDocument.load(result.pdfBuffer);
      expect(loaded.getPageCount()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // PDF passthrough
  // -------------------------------------------------------------------------
  describe('PDF passthrough', () => {
    it('returns the input PDF buffer unchanged', async () => {
      const pdfBuffer = await createValidPdfBuffer();
      const result = await convertToPdf(pdfBuffer, 'application/pdf');

      expect(result.converted).toBe(false);
      expect(result.pdfBuffer).toBe(pdfBuffer); // Same reference, not a copy
    });
  });

  // -------------------------------------------------------------------------
  // Word documents -> ConversionError (manual review)
  // -------------------------------------------------------------------------
  describe('Word document rejection', () => {
    it('throws ConversionError for .docx files with WORD_MANUAL_REVIEW code', async () => {
      const docxBuffer = Buffer.from('PK\x03\x04fake-docx-content');
      const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      await expect(convertToPdf(docxBuffer, mimeType)).rejects.toThrow(ConversionError);

      try {
        await convertToPdf(docxBuffer, mimeType);
      } catch (err) {
        expect(err).toBeInstanceOf(ConversionError);
        expect((err as ConversionError).code).toBe('WORD_MANUAL_REVIEW');
        expect((err as ConversionError).message).toMatch(/manual review/i);
        expect((err as ConversionError).message).toMatch(/word/i);
      }
    });

    it('throws ConversionError for .doc files with WORD_MANUAL_REVIEW code', async () => {
      const docBuffer = Buffer.from('\xd0\xcf\x11\xe0fake-doc-content');

      await expect(convertToPdf(docBuffer, 'application/msword')).rejects.toThrow(ConversionError);

      try {
        await convertToPdf(docBuffer, 'application/msword');
      } catch (err) {
        expect(err).toBeInstanceOf(ConversionError);
        expect((err as ConversionError).code).toBe('WORD_MANUAL_REVIEW');
        expect((err as ConversionError).message).toMatch(/manual review/i);
        expect((err as ConversionError).message).toMatch(/word/i);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Unsupported MIME types
  // -------------------------------------------------------------------------
  describe('unsupported MIME type rejection', () => {
    it('throws ConversionError with UNSUPPORTED_TYPE code for video/mp4', async () => {
      const buffer = Buffer.from('fake-video-content');

      await expect(convertToPdf(buffer, 'video/mp4')).rejects.toThrow(ConversionError);

      try {
        await convertToPdf(buffer, 'video/mp4');
      } catch (err) {
        expect(err).toBeInstanceOf(ConversionError);
        expect((err as ConversionError).code).toBe('UNSUPPORTED_TYPE');
        expect((err as ConversionError).message).toMatch(/unsupported/i);
      }
    });

    it('throws ConversionError with UNSUPPORTED_TYPE code for text/plain', async () => {
      const buffer = Buffer.from('plain text content');

      await expect(convertToPdf(buffer, 'text/plain')).rejects.toThrow(ConversionError);

      try {
        await convertToPdf(buffer, 'text/plain');
      } catch (err) {
        expect(err).toBeInstanceOf(ConversionError);
        expect((err as ConversionError).code).toBe('UNSUPPORTED_TYPE');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Empty / corrupt input
  // -------------------------------------------------------------------------
  describe('empty and corrupt input', () => {
    it('throws ConversionError with CONVERSION_FAILED code for empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);

      await expect(convertToPdf(emptyBuffer, 'image/jpeg')).rejects.toThrow(ConversionError);

      try {
        await convertToPdf(emptyBuffer, 'image/jpeg');
      } catch (err) {
        expect(err).toBeInstanceOf(ConversionError);
        expect((err as ConversionError).code).toBe('CONVERSION_FAILED');
      }
    });

    it('throws ConversionError with CONVERSION_FAILED code for corrupt JPEG data', async () => {
      const corruptBuffer = Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00]);

      await expect(convertToPdf(corruptBuffer, 'image/jpeg')).rejects.toThrow(ConversionError);

      try {
        await convertToPdf(corruptBuffer, 'image/jpeg');
      } catch (err) {
        expect(err).toBeInstanceOf(ConversionError);
        expect((err as ConversionError).code).toBe('CONVERSION_FAILED');
      }
    });

    it('throws ConversionError with CONVERSION_FAILED code for corrupt PNG data', async () => {
      const corruptBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);

      await expect(convertToPdf(corruptBuffer, 'image/png')).rejects.toThrow(ConversionError);

      try {
        await convertToPdf(corruptBuffer, 'image/png');
      } catch (err) {
        expect(err).toBeInstanceOf(ConversionError);
        expect((err as ConversionError).code).toBe('CONVERSION_FAILED');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// ConversionError
// ---------------------------------------------------------------------------

describe('ConversionError', () => {
  it('extends Error', () => {
    const err = new ConversionError('UNSUPPORTED_TYPE', 'test message');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConversionError);
  });

  it('has a code property', () => {
    const err = new ConversionError('WORD_MANUAL_REVIEW', 'Word doc needs manual review');
    expect(err.code).toBe('WORD_MANUAL_REVIEW');
    expect(err.message).toBe('Word doc needs manual review');
  });

  it('has correct name', () => {
    const err = new ConversionError('CONVERSION_FAILED', 'bad data');
    expect(err.name).toBe('ConversionError');
  });
});
