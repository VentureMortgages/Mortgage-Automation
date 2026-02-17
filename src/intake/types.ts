/**
 * Document Intake Type Definitions
 *
 * Types for the document intake pipeline (Phase 6):
 * - IntakeDocument: a document extracted from an intake source, ready for Phase 7 classification
 * - GmailMessageMeta: metadata about a Gmail message (not the full content)
 * - AttachmentInfo: attachment metadata extracted from a Gmail message part
 * - IntakeJobData / IntakeResult: BullMQ queue job types
 *
 * Consumers:
 * - Phase 6 Plans 02-04: gmail-monitor, attachment-extractor, pdf-converter, intake-worker
 * - Phase 7: Classification & Filing (receives IntakeDocument)
 */

// ---------------------------------------------------------------------------
// Source & Conversion
// ---------------------------------------------------------------------------

/** Where the document came from */
export type IntakeSource = 'gmail' | 'finmo';

/** Conversion strategy for a MIME type */
export type ConversionStrategy = 'pdf' | 'image-to-pdf' | 'word-to-pdf' | 'unsupported';

// ---------------------------------------------------------------------------
// Gmail Message Types
// ---------------------------------------------------------------------------

/** Metadata about a Gmail message (not the full message content) */
export interface GmailMessageMeta {
  messageId: string;
  threadId: string | null;
  from: string;
  subject: string;
  date: string;
  historyId: string;
  /** Custom X-Venture-* headers (for outbound BCC detection) */
  ventureType?: string;
  ventureContactId?: string;
}

/** Attachment info extracted from a Gmail message part */
export interface AttachmentInfo {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Intake Document (output of Phase 6, input to Phase 7)
// ---------------------------------------------------------------------------

/** A document extracted from an intake source, ready for Phase 7 classification */
export interface IntakeDocument {
  /** Unique ID for deduplication (e.g., gmail-{messageId}-{attachmentIndex} or finmo-{docRequestId}) */
  id: string;
  /** Raw PDF bytes (already converted if needed) */
  pdfBuffer: Buffer;
  /** Original filename from email attachment or Finmo */
  originalFilename: string;
  /** Original MIME type before conversion */
  originalMimeType: string;
  /** Where the document came from */
  source: IntakeSource;
  /** Email address of the sender (for client matching in Phase 7) */
  senderEmail: string | null;
  /** Associated Finmo application ID (if from Finmo portal) */
  applicationId: string | null;
  /** Gmail message ID (for dedup and audit trail) */
  gmailMessageId: string | null;
  /** Timestamp of intake */
  receivedAt: string;
}

// ---------------------------------------------------------------------------
// BullMQ Queue Types
// ---------------------------------------------------------------------------

/** Job data for the intake BullMQ queue */
export interface IntakeJobData {
  source: IntakeSource;
  /** Gmail message ID (for gmail source) */
  gmailMessageId?: string;
  /** Finmo application ID (for finmo source) */
  applicationId?: string;
  /** Finmo document request ID (for finmo source) */
  documentRequestId?: string;
  receivedAt: string;
}

/** Result from processing an intake job */
export interface IntakeResult {
  documentsProcessed: number;
  documentIds: string[];
  errors: string[];
}
