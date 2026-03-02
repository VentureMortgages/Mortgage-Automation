/**
 * Agent Tools — Gemini function-calling tool definitions for the matching agent
 *
 * Defines the tools available to the Gemini matching agent:
 * - search_contact_by_email: CRM email lookup
 * - search_contact_by_name: CRM name lookup
 * - search_contact_by_phone: CRM phone lookup (FOLD-02)
 * - get_contact_details: Full contact record with Drive folder
 * - search_opportunities: Active deals for a contact
 * - lookup_co_borrowers: Finmo borrower list for co-borrower routing (FOLD-03)
 *
 * Each tool returns JSON string results. Errors are caught and returned
 * as error objects so the agent can retry.
 *
 * IMPORTANT: Tool results should NOT include PII in logs.
 * Only return data the agent needs for matching decisions.
 *
 * Consumers: matching agent (src/matching/agent.ts)
 */

import { findContactByEmail, findContactByName, findContactByPhone, getContact } from '../crm/contacts.js';
import { searchOpportunities, getOpportunityFieldValue } from '../crm/opportunities.js';
import { fetchFinmoApplication } from '../webhook/finmo-client.js';
import { crmConfig } from '../crm/config.js';
import { PIPELINE_IDS, EXISTING_OPP_FIELDS } from '../crm/types/index.js';

// ---------------------------------------------------------------------------
// Tool Declarations (Gemini FunctionDeclaration format)
// ---------------------------------------------------------------------------

export const MATCHING_TOOLS = [
  {
    name: 'search_contact_by_email',
    description: 'Search for a CRM contact by email address. Returns contactId if found.',
    parameters: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email address to search for' },
      },
      required: ['email'],
    },
  },
  {
    name: 'search_contact_by_name',
    description: 'Search for a CRM contact by first and last name. Returns contactId if exactly one match.',
    parameters: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: 'First name' },
        lastName: { type: 'string', description: 'Last name' },
      },
      required: ['firstName', 'lastName'],
    },
  },
  {
    name: 'search_contact_by_phone',
    description: 'Search for a CRM contact by phone number. Normalizes to last 10 digits. Returns contactId if exactly one match.',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Phone number to search for' },
      },
      required: ['phone'],
    },
  },
  {
    name: 'get_contact_details',
    description: 'Get full details for a CRM contact including name, email, phone, Drive folder ID, and tags.',
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'CRM contact ID' },
      },
      required: ['contactId'],
    },
  },
  {
    name: 'search_opportunities',
    description: 'Search for active opportunities (deals) for a CRM contact in the Live Deals pipeline.',
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'CRM contact ID' },
      },
      required: ['contactId'],
    },
  },
  {
    name: 'lookup_co_borrowers',
    description: 'Look up all borrowers on a Finmo application associated with a contact. Use this to check if the sender is a co-borrower and find the primary borrower for routing.',
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'CRM contact ID whose deals to check for Finmo applications' },
      },
      required: ['contactId'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool Execution Dispatch
// ---------------------------------------------------------------------------

/**
 * Executes a tool call from the Gemini agent and returns a JSON string result.
 *
 * All calls are wrapped in try/catch so the agent receives an error message
 * instead of crashing (it can decide to retry or use alternative tools).
 *
 * @param toolName - The tool name from the Gemini function call
 * @param args - The parsed arguments from the function call
 * @returns JSON string with the tool result or error
 */
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    switch (toolName) {
      case 'search_contact_by_email': {
        const contactId = await findContactByEmail(args.email as string);
        if (!contactId) return JSON.stringify({ contactId: null, found: false });
        return JSON.stringify({ contactId, found: true });
      }

      case 'search_contact_by_name': {
        const contactId = await findContactByName(
          args.firstName as string,
          args.lastName as string,
        );
        if (!contactId) return JSON.stringify({ contactId: null, found: false });
        return JSON.stringify({ contactId, found: true });
      }

      case 'search_contact_by_phone': {
        const contactId = await findContactByPhone(args.phone as string);
        if (!contactId) return JSON.stringify({ contactId: null, found: false });
        return JSON.stringify({ contactId, found: true });
      }

      case 'get_contact_details': {
        const contact = await getContact(args.contactId as string);
        // Extract Drive folder ID from custom fields
        const driveFolderField = contact.customFields.find(
          (f) => f.id === crmConfig.driveFolderIdFieldId,
        );
        const driveFolderId = driveFolderField?.value ?? null;

        return JSON.stringify({
          contactId: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          driveFolderId,
        });
      }

      case 'search_opportunities': {
        const opportunities = await searchOpportunities(
          args.contactId as string,
          PIPELINE_IDS.LIVE_DEALS,
        );
        return JSON.stringify({
          opportunities: opportunities.map((opp) => ({
            opportunityId: opp.id,
            name: opp.name,
            pipelineStageId: opp.pipelineStageId,
            status: opp.status,
          })),
        });
      }

      case 'lookup_co_borrowers': {
        // Find the contact's active deals to get Finmo application IDs
        const opps = await searchOpportunities(
          args.contactId as string,
          PIPELINE_IDS.LIVE_DEALS,
        );

        const allBorrowers: Array<{
          firstName: string;
          lastName: string;
          email: string;
          phone: string | null;
          isMainBorrower: boolean;
        }> = [];

        for (const opp of opps) {
          const finmoAppId = getOpportunityFieldValue(
            opp,
            EXISTING_OPP_FIELDS.FINMO_APPLICATION_ID,
          );
          if (!finmoAppId || typeof finmoAppId !== 'string') continue;

          const app = await fetchFinmoApplication(finmoAppId);
          if (app.borrowers) {
            for (const b of app.borrowers) {
              allBorrowers.push({
                firstName: b.firstName,
                lastName: b.lastName,
                email: b.email,
                phone: b.phone,
                isMainBorrower: b.isMainBorrower,
              });
            }
          }
        }

        return JSON.stringify({ borrowers: allBorrowers });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: message });
  }
}
