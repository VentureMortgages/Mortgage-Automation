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
