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
