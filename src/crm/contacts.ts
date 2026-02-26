// ============================================================================
// CRM Contacts Service — Contact upsert and lookup operations
// ============================================================================

import { crmConfig, devPrefix } from './config.js';
import { EXISTING_FIELDS } from './types/index.js';
import type { CrmCustomFieldUpdate, CrmContact } from './types/index.js';
import { CrmApiError, CrmAuthError, CrmRateLimitError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

export interface UpsertContactInput {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  source?: string;
  customFields?: CrmCustomFieldUpdate[];
}

export interface UpsertContactResult {
  contactId: string;
  /** true if a new contact was created, false if an existing one was updated */
  isNew: boolean;
}

export interface ResolveContactResult {
  contactId: string | null;
  resolvedVia: 'email' | 'name' | null;
}

// ============================================================================
// Constants — Finmo-managed field IDs that must NEVER be overwritten
// ============================================================================

const FINMO_MANAGED_FIELD_IDS: ReadonlySet<string> = new Set([
  EXISTING_FIELDS.FINMO_DEAL_ID,
  EXISTING_FIELDS.FINMO_APPLICATION_ID,
  EXISTING_FIELDS.FINMO_DEAL_LINK,
]);

// ============================================================================
// Functions
// ============================================================================

/**
 * Creates or updates a contact in MyBrokerPro by email (dedup key).
 *
 * In dev mode, the firstName is prefixed with [TEST] so test contacts
 * are visually distinct and filterable in the CRM UI.
 *
 * CRITICAL: Finmo-managed fields (Deal ID, Application ID, Deal Link)
 * are stripped from customFields before the API call to prevent overwriting
 * values managed by Finmo's own sync.
 *
 * NOTE (Phase 10): Doc tracking fields are now stored on opportunities,
 * not contacts. Contact upsert should only receive borrower details
 * (name, email, phone) and non-doc-tracking custom fields.
 */
export async function upsertContact(input: UpsertContactInput): Promise<UpsertContactResult> {
  // Strip any Finmo-managed fields from the custom fields array
  const safeCustomFields = (input.customFields ?? []).filter(
    (field) => !FINMO_MANAGED_FIELD_IDS.has(field.id),
  );

  const body = {
    locationId: crmConfig.locationId,
    email: input.email,
    firstName: devPrefix(input.firstName),
    lastName: input.lastName,
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.source ? { source: input.source } : {}),
    customFields: safeCustomFields,
  };

  const response = await crmFetch('/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as {
    contact: { id: string };
    new: boolean;
  };

  return {
    contactId: data.contact.id,
    isNew: data.new,
  };
}

/**
 * Searches for an existing contact by email address.
 * Returns the contact ID if found, null otherwise.
 *
 * Uses POST /contacts/search (v2 search endpoint).
 */
export async function findContactByEmail(email: string): Promise<string | null> {
  const body = {
    locationId: crmConfig.locationId,
    query: email,
    pageLimit: 1,
  };

  const response = await crmFetch('/contacts/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as {
    contacts: Array<{ id: string; email?: string }>;
  };

  if (!data.contacts || data.contacts.length === 0) {
    return null;
  }

  // Return the first matching contact's ID
  return data.contacts[0].id;
}

/**
 * Searches for a contact by first + last name.
 *
 * Uses POST /contacts/search with "firstName lastName" as query.
 * GHL search is fuzzy, so we exact-match filter (case-insensitive) after.
 * Returns null if 0 matches or 2+ matches (ambiguity guard → manual review).
 */
export async function findContactByName(
  firstName: string,
  lastName: string,
): Promise<string | null> {
  const body = {
    locationId: crmConfig.locationId,
    query: `${firstName} ${lastName}`,
    pageLimit: 5,
  };

  const response = await crmFetch('/contacts/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as {
    contacts: Array<{ id: string; firstName?: string; lastName?: string }>;
  };

  if (!data.contacts || data.contacts.length === 0) {
    return null;
  }

  // Exact-match filter (case-insensitive) — GHL may return fuzzy results
  const exactMatches = data.contacts.filter(
    (c) =>
      c.firstName?.toLowerCase() === firstName.toLowerCase() &&
      c.lastName?.toLowerCase() === lastName.toLowerCase(),
  );

  // Ambiguity guard: 2+ exact matches → return null (manual review)
  if (exactMatches.length !== 1) {
    return null;
  }

  return exactMatches[0].id;
}

/**
 * Resolves a CRM contact ID using email first, then name as fallback.
 *
 * Used by the classification worker to find the borrower's CRM contact
 * even when the email sender is not the borrower (e.g., Cat forwarding).
 */
export async function resolveContactId(input: {
  senderEmail: string | null;
  borrowerFirstName: string | null;
  borrowerLastName: string | null;
}): Promise<ResolveContactResult> {
  // Try email lookup first
  if (input.senderEmail) {
    const contactId = await findContactByEmail(input.senderEmail);
    if (contactId) {
      return { contactId, resolvedVia: 'email' };
    }
  }

  // Fallback: name-based lookup
  if (input.borrowerFirstName && input.borrowerLastName) {
    const contactId = await findContactByName(
      input.borrowerFirstName,
      input.borrowerLastName,
    );
    if (contactId) {
      return { contactId, resolvedVia: 'name' };
    }
  }

  return { contactId: null, resolvedVia: null };
}

/**
 * Retrieves a contact's full record including custom field values.
 *
 * Used by Phase 8 (Tracking Integration) to read current custom field state
 * before the read-modify-write update cycle.
 *
 * @param contactId - The CRM contact ID to retrieve
 * @returns The contact record with customFields array
 */
export async function getContact(contactId: string): Promise<CrmContact> {
  const response = await crmFetch(`/contacts/${contactId}`, { method: 'GET' });
  const data = (await response.json()) as { contact: CrmContact };
  return data.contact;
}

// ============================================================================
// Drive Folder Helpers
// ============================================================================

/**
 * Extracts a Google Drive folder ID from either a raw ID or a full Drive URL.
 *
 * The CRM may store folder references as:
 * - Raw IDs: "1abc123def456"
 * - Full URLs: "https://drive.google.com/drive/folders/1abc123def456"
 *
 * This function normalizes both to a raw folder ID.
 */
export function extractDriveFolderId(value: string): string {
  const match = value.match(/\/folders\/([^/?#]+)/);
  return match ? match[1] : value;
}

/**
 * Reads the Drive folder ID from a contact's custom fields.
 *
 * Pure function: takes the contact record and field ID as parameters,
 * following the same pattern as parseContactTrackingFields in tracking-sync.ts.
 *
 * @param contact - The CRM contact record with customFields
 * @param fieldId - The custom field ID for Drive Folder ID (from crmConfig.driveFolderIdFieldId)
 * @returns The Google Drive folder ID string, or null if not set
 */
export function getContactDriveFolderId(
  contact: CrmContact,
  fieldId: string,
): string | null {
  const field = contact.customFields.find((f) => f.id === fieldId);
  if (!field || !field.value || typeof field.value !== 'string') {
    return null;
  }
  return extractDriveFolderId(field.value);
}

// ============================================================================
// Professional Contact Type Assignment
// ============================================================================

/**
 * Sets the contact type tag on a professional contact in MBP.
 *
 * Finmo pushes professional contacts (realtor, lawyer) to MBP but does
 * NOT set the contact type. This function finds the contact by email
 * and adds a tag matching the professional's role.
 *
 * Non-fatal: logs errors but never throws (Cat can tag manually).
 *
 * @param email - The professional's email address
 * @param fullName - The professional's full name (for upsert)
 * @param professionalType - The role from Finmo (e.g., "realtor", "lawyer")
 */
export async function assignContactType(
  email: string,
  fullName: string,
  professionalType: string,
): Promise<void> {
  try {
    // Parse name: "First Last" → firstName, lastName
    const parts = fullName.trim().split(/\s+/);
    const firstName = parts[0] || fullName;
    const lastName = parts.slice(1).join(' ') || '';

    // Normalize type for tag (lowercase, trimmed)
    const tag = professionalType.toLowerCase().trim();

    // Upsert contact with tag — GHL merges tags additively
    const body = {
      locationId: crmConfig.locationId,
      email,
      firstName,
      lastName,
      tags: [tag],
    };

    await crmFetch('/contacts/upsert', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    console.log('[contacts] Professional contact type assigned', {
      email,
      type: tag,
    });
  } catch (err) {
    console.error('[contacts] Failed to assign contact type (non-fatal)', {
      email,
      type: professionalType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// Internal — HTTP helper with error classification
// ============================================================================

/**
 * Makes an authenticated request to the GHL API with standard headers.
 * Classifies HTTP errors into typed error classes.
 * NEVER includes PII in error messages.
 */
async function crmFetch(path: string, init: RequestInit): Promise<Response> {
  const url = `${crmConfig.baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${crmConfig.apiKey}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });

    if (!response.ok) {
      const responseBody = await response.text();

      if (response.status === 429) {
        throw new CrmRateLimitError(responseBody);
      }
      if (response.status === 401) {
        throw new CrmAuthError(responseBody);
      }

      throw new CrmApiError(
        `CRM API error: ${response.status} ${response.statusText}`,
        response.status,
        responseBody,
      );
    }

    return response;
  } catch (error) {
    // Re-throw our typed errors as-is
    if (error instanceof CrmApiError) {
      throw error;
    }

    // Wrap unexpected errors (network failures, etc.)
    throw new CrmApiError(
      `CRM API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      0,
      '',
    );
  }
}
