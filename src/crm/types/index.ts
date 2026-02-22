// ============================================================================
// CRM Constants — Known Entity IDs
// ============================================================================

/** Existing custom fields already in MyBrokerPro (confirmed via API exploration) */
export const EXISTING_FIELDS = {
  FINMO_DEAL_ID: 'YoBlMiUV8N3MrvUYoxH0',
  FINMO_APPLICATION_ID: 'FmesbQomeEwegqIyAst4',
  FINMO_DEAL_LINK: 'NhJ3BGgSZcEtyccuYkOB',
  TRANSACTION_TYPE: 'no18IIHr4smgHvfpkMHm',
  CLOSING_DATE: 'JZdgo6e5kYorFubnSMzI',
} as const;

/** Custom field group ID for Finmo Integration fields */
export const FIELD_GROUP_ID = 'jlGAdTgblv5q2cWiw2Qc';

/** Pipeline IDs */
export const PIPELINE_IDS = {
  FINMO_LEADS: 'FK2LWevdQrcfHLHfjpDa',
  LIVE_DEALS: 'tkBeD1nIfgNphnh1oyDW',
} as const;

/** MyBrokerPro location ID */
export const LOCATION_ID = 'bzzWH2mLpCr7HHulO3bW';

// ============================================================================
// Doc Tracking Field Definitions — Schema for creation via setup script
// ============================================================================

/**
 * @deprecated Phase 10: Contact-level doc tracking fields are deprecated.
 * Use OPP_DOC_TRACKING_FIELD_DEFS for opportunity-scoped fields instead.
 * These definitions are retained only for the setup script's --deprecate-contact-fields flag.
 *
 * Definitions for the 9 custom fields needed for document tracking.
 * Used by the create-custom-fields setup script to provision fields in MyBrokerPro.
 * After creation, the returned IDs are stored in .env and loaded via crmConfig.fieldIds.
 */
export const DOC_TRACKING_FIELD_DEFS = [
  {
    envKey: 'GHL_FIELD_DOC_STATUS_ID',
    name: 'Doc Collection Status',
    dataType: 'SINGLE_OPTIONS' as const,
    options: ['Not Started', 'In Progress', 'PRE Complete', 'All Complete'],
  },
  {
    envKey: 'GHL_FIELD_DOC_REQUEST_SENT_ID',
    name: 'Doc Request Sent Date',
    dataType: 'DATE' as const,
  },
  {
    envKey: 'GHL_FIELD_MISSING_DOCS_ID',
    name: 'Missing Docs',
    dataType: 'LARGE_TEXT' as const,
  },
  {
    envKey: 'GHL_FIELD_RECEIVED_DOCS_ID',
    name: 'Received Docs',
    dataType: 'LARGE_TEXT' as const,
  },
  {
    envKey: 'GHL_FIELD_PRE_TOTAL_ID',
    name: 'PRE Docs Total',
    dataType: 'NUMERICAL' as const,
  },
  {
    envKey: 'GHL_FIELD_PRE_RECEIVED_ID',
    name: 'PRE Docs Received',
    dataType: 'NUMERICAL' as const,
  },
  {
    envKey: 'GHL_FIELD_FULL_TOTAL_ID',
    name: 'FULL Docs Total',
    dataType: 'NUMERICAL' as const,
  },
  {
    envKey: 'GHL_FIELD_FULL_RECEIVED_ID',
    name: 'FULL Docs Received',
    dataType: 'NUMERICAL' as const,
  },
  {
    envKey: 'GHL_FIELD_LAST_DOC_RECEIVED_ID',
    name: 'Last Doc Received Date',
    dataType: 'DATE' as const,
  },
] as const;

/** Type for a single doc tracking field definition */
export type DocTrackingFieldDef = (typeof DOC_TRACKING_FIELD_DEFS)[number];

// ============================================================================
// Drive Folder Linking Field Definitions — Standalone (not part of doc tracking)
// ============================================================================

/** Contact-level field for storing the client's Google Drive folder ID */
export const DRIVE_FOLDER_FIELD_DEF = {
  envKey: 'GHL_FIELD_DRIVE_FOLDER_ID',
  name: 'Drive Folder ID',
  dataType: 'TEXT' as const,
};

/** Opportunity-level field for storing the deal subfolder ID within the client's Drive folder */
export const OPP_DEAL_SUBFOLDER_FIELD_DEF = {
  envKey: 'GHL_OPP_FIELD_DEAL_SUBFOLDER_ID',
  name: 'Deal Subfolder ID',
  dataType: 'TEXT' as const,
};

// ============================================================================
// CRM Interfaces
// ============================================================================

/** Payload for updating a single custom field on a contact */
export interface CrmCustomFieldUpdate {
  id: string;
  field_value: string | number;
}

/** Input for creating or upserting a CRM contact */
export interface CrmContactUpsertInput {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  customFields?: CrmCustomFieldUpdate[];
}

/** Input for creating a CRM task */
export interface CrmTaskInput {
  contactId: string;
  title: string;
  body?: string;
  assignedTo: string;
  dueDate: string; // ISO date string
}

/** Input for creating or upserting a CRM opportunity */
export interface CrmOpportunityInput {
  contactId: string;
  pipelineId: string;
  stageId: string;
  name: string;
}

/** CRM contact record returned by GET /contacts/:contactId */
export interface CrmContact {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  customFields: Array<{ id: string; value: unknown }>;
}

/** Structured entry for missingDocs/receivedDocs CRM fields (includes stage for counter tracking) */
export interface MissingDocEntry {
  name: string;
  stage: 'PRE' | 'FULL' | 'LATER' | 'CONDITIONAL' | 'LENDER_CONDITION';
}

/** Input for creating an audit note on a CRM contact */
export interface CrmNoteInput {
  documentType: string;
  source: string;
  driveFileId: string;
}

// ============================================================================
// Opportunity Types — Opportunity-scoped custom fields have a different format
// ============================================================================

/** Custom field on an opportunity (response format differs from contacts) */
export interface CrmOpportunityCustomField {
  id: string;
  fieldValueString?: string;
  fieldValueNumber?: number;
  fieldValueDate?: number;
  type?: string;
}

/** CRM opportunity record returned by GET /opportunities/:id or search */
export interface CrmOpportunity {
  id: string;
  name?: string;
  contactId?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: string;
  customFields?: CrmOpportunityCustomField[];
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// Opportunity Constants — Known field IDs on opportunities
// ============================================================================

/**
 * Existing custom fields on opportunities created by Finmo.
 * IMPORTANT: These IDs are DIFFERENT from the contact-level EXISTING_FIELDS.
 * Same field names, different IDs because they are scoped to the opportunity model.
 */
export const EXISTING_OPP_FIELDS = {
  FINMO_APPLICATION_ID: 'ezhN6WKQLzY7MvqIKSY9',
  FINMO_DEAL_ID: 'oQacgWtfN4YntLChYcvn',
  FINMO_DEAL_LINK: 'lp7dunT6sJY0ZmXAIasi',
  TRANSACTION_TYPE: 'tuUFgUp9pAPeOoorOrrn',
} as const;

/** Custom field group ID for doc tracking fields on opportunities. Populated after running setup script. */
export const OPP_FIELD_GROUP_ID = '';  // Populated after running setup script

/**
 * Definitions for the 9 custom fields needed for document tracking on opportunities.
 * Same structure as DOC_TRACKING_FIELD_DEFS but with OPP_ prefixed envKey names.
 * Used by the create-custom-fields setup script with model='opportunity'.
 */
export const OPP_DOC_TRACKING_FIELD_DEFS = [
  { envKey: 'GHL_OPP_FIELD_DOC_STATUS_ID', name: 'Doc Collection Status', dataType: 'SINGLE_OPTIONS' as const, options: ['Not Started', 'In Progress', 'PRE Complete', 'All Complete'] },
  { envKey: 'GHL_OPP_FIELD_DOC_REQUEST_SENT_ID', name: 'Doc Request Sent Date', dataType: 'DATE' as const },
  { envKey: 'GHL_OPP_FIELD_MISSING_DOCS_ID', name: 'Missing Docs', dataType: 'LARGE_TEXT' as const },
  { envKey: 'GHL_OPP_FIELD_RECEIVED_DOCS_ID', name: 'Received Docs', dataType: 'LARGE_TEXT' as const },
  { envKey: 'GHL_OPP_FIELD_PRE_TOTAL_ID', name: 'PRE Docs Total', dataType: 'NUMERICAL' as const },
  { envKey: 'GHL_OPP_FIELD_PRE_RECEIVED_ID', name: 'PRE Docs Received', dataType: 'NUMERICAL' as const },
  { envKey: 'GHL_OPP_FIELD_FULL_TOTAL_ID', name: 'FULL Docs Total', dataType: 'NUMERICAL' as const },
  { envKey: 'GHL_OPP_FIELD_FULL_RECEIVED_ID', name: 'FULL Docs Received', dataType: 'NUMERICAL' as const },
  { envKey: 'GHL_OPP_FIELD_LAST_DOC_RECEIVED_ID', name: 'Last Doc Received Date', dataType: 'DATE' as const },
] as const;
