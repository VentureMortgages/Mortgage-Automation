/**
 * Classification & Filing Type Definitions
 *
 * Types for the document classification pipeline (Phase 7):
 * - DOCUMENT_TYPES: all mortgage document types the classifier recognizes
 * - ClassificationResultSchema: Zod schema for Claude structured output
 * - SUBFOLDER_ROUTING: maps document type -> target subfolder in Drive
 * - DOC_TYPE_LABELS: human-readable labels for filenames
 * - FilingDecision: routing decision for a classified document
 * - ClassificationJobData: BullMQ queue job data (no PDF buffer -- temp file path only)
 * - ClassificationJobResult: outcome of a classification+filing job
 *
 * Consumers:
 * - Phase 7 Plans 02-05: classifier, naming, router, filer, worker
 * - Phase 6 intake-worker: enqueues ClassificationJobData
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Document Types
// ---------------------------------------------------------------------------

/** All document types the classifier recognizes */
export const DOCUMENT_TYPES = [
  // Base pack
  'photo_id', 'second_id', 'void_cheque',
  // Income - Employed
  'pay_stub', 'loe', 't4', 'noa',
  // Income - Self-employed
  't1', 't2', 'articles_of_incorporation', 'financial_statement',
  // Income - Other
  'pension_letter', 't4a', 'employment_contract',
  // Variable income
  'commission_statement', 'lease_agreement',
  // Down payment
  'bank_statement', 'rrsp_statement', 'tfsa_statement', 'fhsa_statement',
  'gift_letter',
  // Property
  'purchase_agreement', 'mls_listing', 'mortgage_statement', 'property_tax_bill',
  'home_insurance',
  // Tax
  't5', 'cra_statement_of_account', 't4rif',
  // Situations
  'separation_agreement', 'divorce_decree', 'discharge_certificate',
  // Residency
  'pr_card', 'passport', 'work_permit',
  // Catch-all
  'other',
] as const;

/** A recognized document type identifier */
export type DocumentType = typeof DOCUMENT_TYPES[number];

// ---------------------------------------------------------------------------
// Classification Result (Zod schema for Claude structured output)
// ---------------------------------------------------------------------------

/** Zod schema defining the structured output from Claude classification */
export const ClassificationResultSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  confidence: z.number().describe('Classification confidence 0.0-1.0'),
  borrowerFirstName: z.string().nullable().describe('First name of person doc belongs to'),
  borrowerLastName: z.string().nullable().describe('Last name'),
  taxYear: z.number().nullable().describe('Tax year if applicable'),
  amount: z.string().nullable().describe('Dollar amount if visible (e.g., "$16k", "$5.2k")'),
  institution: z.string().nullable().describe('Bank/employer name if visible'),
  pageCount: z.number().nullable().describe('Number of pages in the document'),
  additionalNotes: z.string().nullable().describe('Other relevant metadata'),
});

/** Structured classification result from Claude */
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

// ---------------------------------------------------------------------------
// Subfolder Routing
// ---------------------------------------------------------------------------

/** Target subfolder within a client's Drive folder */
export type SubfolderTarget =
  | 'person'
  | 'subject_property'
  | 'non_subject_property'
  | 'signed_docs'
  | 'down_payment'
  | 'root';

/** Maps every document type to the subfolder it should be filed in */
export const SUBFOLDER_ROUTING: Record<DocumentType, SubfolderTarget> = {
  // Person subfolder (income, ID, tax docs)
  photo_id: 'person',
  second_id: 'person',
  pay_stub: 'person',
  loe: 'person',
  t4: 'person',
  t4a: 'person',
  noa: 'person',
  t1: 'person',
  t5: 'person',
  t4rif: 'person',
  pension_letter: 'person',
  employment_contract: 'person',
  commission_statement: 'person',
  cra_statement_of_account: 'person',

  // Business docs (person subfolder)
  t2: 'person',
  articles_of_incorporation: 'person',
  financial_statement: 'person',

  // Situations (person subfolder)
  separation_agreement: 'person',
  divorce_decree: 'person',
  discharge_certificate: 'person',

  // Residency (person subfolder)
  pr_card: 'person',
  passport: 'person',
  work_permit: 'person',

  // Subject property subfolder
  purchase_agreement: 'subject_property',
  mls_listing: 'subject_property',
  property_tax_bill: 'subject_property',
  home_insurance: 'subject_property',

  // Non-subject property
  lease_agreement: 'non_subject_property',
  mortgage_statement: 'non_subject_property',

  // Down payment subfolder
  bank_statement: 'down_payment',
  rrsp_statement: 'down_payment',
  tfsa_statement: 'down_payment',
  fhsa_statement: 'down_payment',
  gift_letter: 'down_payment',

  // Shared / root level
  void_cheque: 'root',
  other: 'root',
};

// ---------------------------------------------------------------------------
// Document Type Labels (for filenames)
// ---------------------------------------------------------------------------

/** Human-readable labels for document types, used in generated filenames */
export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  photo_id: 'ID',
  second_id: 'Second ID',
  pay_stub: 'Pay Stub',
  loe: 'LOE',
  t4: 'T4',
  t4a: 'T4A',
  noa: 'NOA',
  t1: 'T1',
  t5: 'T5',
  t4rif: 'T4RIF',
  t2: 'T2',
  bank_statement: 'Bank Statement',
  rrsp_statement: 'RRSP Statement',
  tfsa_statement: 'TFSA Statement',
  fhsa_statement: 'FHSA Statement',
  gift_letter: 'Gift Letter',
  void_cheque: 'Void Cheque',
  purchase_agreement: 'Purchase Agreement',
  mls_listing: 'MLS',
  mortgage_statement: 'Mortgage Statement',
  property_tax_bill: 'Property Tax',
  home_insurance: 'Home Insurance',
  pension_letter: 'Pension Letter',
  employment_contract: 'Employment Contract',
  commission_statement: 'Commission Statement',
  lease_agreement: 'Lease Agreement',
  articles_of_incorporation: 'Articles of Incorporation',
  financial_statement: 'Financial Statement',
  separation_agreement: 'Separation Agreement',
  divorce_decree: 'Divorce Decree',
  discharge_certificate: 'Discharge Certificate',
  pr_card: 'PR Card',
  passport: 'Passport',
  work_permit: 'Work Permit',
  cra_statement_of_account: 'CRA Statement',
  other: 'Document',
};

// ---------------------------------------------------------------------------
// Filing Decision
// ---------------------------------------------------------------------------

/** Routing decision for a classified document, ready to be filed in Drive */
export interface FilingDecision {
  classification: ClassificationResult;
  filename: string;
  subfolderTarget: SubfolderTarget;
  /** Resolved Google Drive folder ID for the target subfolder */
  targetFolderId: string;
  /** If an existing file was found, its Drive file ID (for update/replace) */
  existingFileId: string | null;
}

// ---------------------------------------------------------------------------
// Classification Queue Types
// ---------------------------------------------------------------------------

/** BullMQ job data for the classification queue (no PDF buffer -- temp file path only) */
export interface ClassificationJobData {
  /** Unique intake document ID for dedup (e.g., gmail-{messageId}-{index}) */
  intakeDocumentId: string;
  /** Temp file path where pdfBuffer is saved (NOT in Redis) */
  tempFilePath: string;
  /** Original filename (hint for classifier) */
  originalFilename: string;
  /** Sender email (for CRM contact matching) */
  senderEmail: string | null;
  /** Finmo application ID (if from Finmo source) */
  applicationId: string | null;
  /** Source of the document */
  source: 'gmail' | 'finmo';
  /** ISO timestamp */
  receivedAt: string;
}

/** Outcome of a classification + filing job */
export interface ClassificationJobResult {
  intakeDocumentId: string;
  classification: ClassificationResult | null;
  filed: boolean;
  driveFileId: string | null;
  manualReview: boolean;
  error: string | null;
}
