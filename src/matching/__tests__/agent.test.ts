/**
 * Tests for the Matching Agent — Gemini agentic loop
 *
 * Tests cover:
 * - Thread match: auto_filed with thread_match signal (MATCH-01)
 * - Sender match + single opp: auto_filed
 * - Third-party sender: agent uses doc content name to find match (MATCH-02)
 * - Conflicting signals: conflict outcome (MATCH-05)
 * - No match: auto_created outcome
 * - Multiple opportunities: picks Collecting Documents stage (MATCH-05)
 * - Co-borrower routing: routes to primary borrower (FOLD-03)
 * - Phone fallback: matches via phone when email fails (FOLD-02)
 * - Max iterations: needs_review
 * - Disabled: falls back to legacy resolveContactId
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const mockRedisSet = vi.hoisted(() => vi.fn());
const mockRedisGet = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => ({
  Redis: class MockIORedis {
    set = mockRedisSet;
    get = mockRedisGet;
    constructor() { /* no-op */ }
  },
}));

vi.mock('../../webhook/queue.js', () => ({
  createRedisConnection: vi.fn(() => ({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  })),
}));

// ---------------------------------------------------------------------------
// Mock CRM functions
// ---------------------------------------------------------------------------

const mockFindContactByEmail = vi.hoisted(() => vi.fn());
const mockFindContactByName = vi.hoisted(() => vi.fn());
const mockFindContactByPhone = vi.hoisted(() => vi.fn());
const mockGetContact = vi.hoisted(() => vi.fn());
const mockSearchOpportunities = vi.hoisted(() => vi.fn());
const mockGetOpportunityFieldValue = vi.hoisted(() => vi.fn());
const mockResolveContactId = vi.hoisted(() => vi.fn());

vi.mock('../../crm/contacts.js', () => ({
  findContactByEmail: mockFindContactByEmail,
  findContactByName: mockFindContactByName,
  findContactByPhone: mockFindContactByPhone,
  getContact: mockGetContact,
  resolveContactId: mockResolveContactId,
}));

vi.mock('../../crm/opportunities.js', () => ({
  searchOpportunities: mockSearchOpportunities,
  getOpportunityFieldValue: mockGetOpportunityFieldValue,
}));

// ---------------------------------------------------------------------------
// Mock Finmo client
// ---------------------------------------------------------------------------

const mockFetchFinmoApplication = vi.hoisted(() => vi.fn());

vi.mock('../../webhook/finmo-client.js', () => ({
  fetchFinmoApplication: mockFetchFinmoApplication,
}));

// ---------------------------------------------------------------------------
// Mock CRM config
// ---------------------------------------------------------------------------

vi.mock('../../crm/config.js', () => ({
  crmConfig: {
    locationId: 'loc-123',
    driveFolderIdFieldId: 'drive-folder-field-id',
    oppDealSubfolderIdFieldId: 'deal-subfolder-field-id',
    stageIds: {
      collectingDocuments: 'stage-collecting-docs',
    },
  },
  devPrefix: (s: string) => s,
}));

vi.mock('../../crm/types/index.js', () => ({
  PIPELINE_IDS: { LIVE_DEALS: 'pipeline-live', FINMO_LEADS: 'pipeline-leads' },
  EXISTING_OPP_FIELDS: { FINMO_APPLICATION_ID: 'finmo-app-field', FINMO_DEAL_ID: 'finmo-deal-field' },
}));

// ---------------------------------------------------------------------------
// Mock matching config — override enabled/disabled per test
// ---------------------------------------------------------------------------

const mockMatchingConfig = vi.hoisted(() => ({
  autoFileThreshold: 0.8,
  maxAgentIterations: 5,
  decisionLogTtlSeconds: 90 * 24 * 60 * 60,
  threadMappingTtlSeconds: 30 * 24 * 60 * 60,
  model: 'gemini-2.0-flash',
  enabled: true,
}));

vi.mock('../config.js', () => ({
  matchingConfig: mockMatchingConfig,
}));

// ---------------------------------------------------------------------------
// Mock Gemini API
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.hoisted(() => vi.fn());

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class MockGoogleGenerativeAI {
    constructor() { /* no-op */ }
    getGenerativeModel() {
      return {
        generateContent: mockGenerateContent,
      };
    }
  },
  SchemaType: { STRING: 'STRING', NUMBER: 'NUMBER', OBJECT: 'OBJECT' },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { matchDocument, type MatchInput } from '../agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    intakeDocumentId: 'doc-001',
    classificationResult: {
      documentType: 'pay_stub',
      confidence: 0.95,
      borrowerFirstName: 'John',
      borrowerLastName: 'Smith',
      taxYear: null,
      amount: '$3,200',
      institution: 'Acme Corp',
      pageCount: 1,
      additionalNotes: null,
    },
    senderEmail: 'john@example.com',
    threadId: undefined,
    ccAddresses: [],
    emailSubject: 'Documents',
    applicationId: null,
    originalFilename: 'paystub.pdf',
    ...overrides,
  };
}

/** Create a Gemini response that returns a final text answer (no function calls) */
function geminiTextResponse(answer: { chosenContactId: string | null; chosenOpportunityId: string | null; confidence: number; reasoning: string }) {
  return {
    response: {
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify(answer) }],
        },
      }],
      functionCalls: () => undefined,
    },
  };
}

/** Create a Gemini response with function calls */
function geminiFunctionCallResponse(calls: Array<{ name: string; args: Record<string, unknown> }>) {
  return {
    response: {
      candidates: [{
        content: {
          parts: calls.map(c => ({
            functionCall: { name: c.name, args: c.args },
          })),
        },
      }],
      functionCalls: () => calls.map(c => ({ name: c.name, args: c.args })),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Matching Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMatchingConfig.enabled = true;
    // Default: logMatchDecision succeeds
    mockRedisSet.mockResolvedValue('OK');
  });

  describe('Thread match (MATCH-01)', () => {
    it('returns auto_filed when threadId maps to a contact', async () => {
      // Thread store has a mapping
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ contactId: 'contact-thread', opportunityId: 'opp-thread' }),
      );
      // Sender also matches (should not conflict since same contact)
      mockFindContactByEmail.mockResolvedValue('contact-thread');

      // Agent confirms the match
      mockGenerateContent.mockResolvedValue(geminiTextResponse({
        chosenContactId: 'contact-thread',
        chosenOpportunityId: 'opp-thread',
        confidence: 0.95,
        reasoning: 'Thread match confirms this email is a reply to the doc-request sent to this contact.',
      }));

      const decision = await matchDocument(makeInput({ threadId: 'thread-123' }));

      expect(decision.outcome).toBe('auto_filed');
      expect(decision.chosenContactId).toBe('contact-thread');
      expect(decision.chosenOpportunityId).toBe('opp-thread');
      expect(decision.confidence).toBeGreaterThanOrEqual(0.8);
      expect(decision.signals.some(s => s.type === 'thread_match')).toBe(true);
    });
  });

  describe('Sender match + single opportunity', () => {
    it('returns auto_filed when sender email matches a contact', async () => {
      mockRedisGet.mockResolvedValue(null); // no thread mapping
      mockFindContactByEmail.mockResolvedValue('contact-sender');

      mockGenerateContent.mockResolvedValue(geminiTextResponse({
        chosenContactId: 'contact-sender',
        chosenOpportunityId: 'opp-1',
        confidence: 0.9,
        reasoning: 'Sender email matches CRM contact directly.',
      }));

      const decision = await matchDocument(makeInput());

      expect(decision.outcome).toBe('auto_filed');
      expect(decision.chosenContactId).toBe('contact-sender');
      expect(decision.signals.some(s => s.type === 'sender_email')).toBe(true);
    });
  });

  describe('Third-party sender (MATCH-02)', () => {
    it('uses doc content name to find match when sender has no CRM match', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFindContactByEmail.mockResolvedValue(null); // sender unknown

      // Agent calls search_contact_by_name with borrower name from classification
      mockGenerateContent
        .mockResolvedValueOnce(geminiFunctionCallResponse([
          { name: 'search_contact_by_name', args: { firstName: 'John', lastName: 'Smith' } },
        ]))
        .mockResolvedValueOnce(geminiTextResponse({
          chosenContactId: 'contact-john',
          chosenOpportunityId: null,
          confidence: 0.85,
          reasoning: 'Found CRM contact matching borrower name from doc content.',
        }));

      mockFindContactByName.mockResolvedValue('contact-john');

      const decision = await matchDocument(makeInput({ senderEmail: 'thirdparty@lawyer.com' }));

      expect(decision.outcome).toBe('auto_filed');
      expect(decision.chosenContactId).toBe('contact-john');
    });
  });

  describe('Conflicting signals', () => {
    it('returns conflict when sender matches Contact A but agent chose Contact B', async () => {
      mockRedisGet.mockResolvedValue(null);
      // Sender matches Contact A
      mockFindContactByEmail.mockResolvedValue('contact-A');

      // Agent decides on Contact B (from doc content name)
      mockGenerateContent.mockResolvedValue(geminiTextResponse({
        chosenContactId: 'contact-B',
        chosenOpportunityId: null,
        confidence: 0.85,
        reasoning: 'Doc content name matches Contact B, not the sender.',
      }));

      const decision = await matchDocument(makeInput());

      expect(decision.outcome).toBe('conflict');
      expect(decision.reasoning).toBeTruthy();
    });
  });

  describe('No match', () => {
    it('returns auto_created when no signals match any CRM contact', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFindContactByEmail.mockResolvedValue(null);

      mockGenerateContent.mockResolvedValue(geminiTextResponse({
        chosenContactId: null,
        chosenOpportunityId: null,
        confidence: 0.0,
        reasoning: 'No CRM contact matches any available signals.',
      }));

      const decision = await matchDocument(makeInput({ senderEmail: null }));

      expect(decision.outcome).toBe('auto_created');
      expect(decision.chosenContactId).toBeNull();
    });
  });

  describe('Multiple opportunities (MATCH-05)', () => {
    it('picks the Collecting Documents stage opportunity when multiple exist', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFindContactByEmail.mockResolvedValue('contact-multi');

      // Agent searches opportunities and picks the collecting-docs one
      mockGenerateContent
        .mockResolvedValueOnce(geminiFunctionCallResponse([
          { name: 'search_opportunities', args: { contactId: 'contact-multi' } },
        ]))
        .mockResolvedValueOnce(geminiTextResponse({
          chosenContactId: 'contact-multi',
          chosenOpportunityId: 'opp-collecting',
          confidence: 0.88,
          reasoning: 'Contact has multiple deals. Selected the one in Collecting Documents stage.',
        }));

      mockSearchOpportunities.mockResolvedValue([
        { id: 'opp-old', name: 'Old Deal', pipelineStageId: 'stage-closed', customFields: [] },
        { id: 'opp-collecting', name: 'Active Deal', pipelineStageId: 'stage-collecting-docs', customFields: [] },
      ]);

      const decision = await matchDocument(makeInput());

      expect(decision.outcome).toBe('auto_filed');
      expect(decision.chosenOpportunityId).toBe('opp-collecting');
    });
  });

  describe('Co-borrower routing (FOLD-03)', () => {
    it('routes to primary borrower when sender matches a co-borrower', async () => {
      mockRedisGet.mockResolvedValue(null);
      // Sender email not in CRM as a contact directly
      mockFindContactByEmail.mockResolvedValue(null);

      // Agent looks up co-borrowers and finds the primary
      mockGenerateContent
        .mockResolvedValueOnce(geminiFunctionCallResponse([
          { name: 'search_contact_by_name', args: { firstName: 'John', lastName: 'Smith' } },
        ]))
        .mockResolvedValueOnce(geminiFunctionCallResponse([
          { name: 'lookup_co_borrowers', args: { contactId: 'contact-primary' } },
        ]))
        .mockResolvedValueOnce(geminiTextResponse({
          chosenContactId: 'contact-primary',
          chosenOpportunityId: 'opp-1',
          confidence: 0.88,
          reasoning: 'Sender is a co-borrower. Routing to primary borrower folder.',
        }));

      mockFindContactByName.mockResolvedValue('contact-primary');
      mockSearchOpportunities.mockResolvedValue([
        { id: 'opp-1', customFields: [{ id: 'finmo-app-field', fieldValueString: 'app-123' }] },
      ]);
      mockGetOpportunityFieldValue.mockReturnValue('app-123');
      mockFetchFinmoApplication.mockResolvedValue({
        borrowers: [
          { firstName: 'John', lastName: 'Smith', email: 'john@example.com', phone: '416-555-1234', isMainBorrower: true },
          { firstName: 'Jane', lastName: 'Smith', email: 'jane@co-borrower.com', phone: '416-555-5678', isMainBorrower: false },
        ],
      });

      const decision = await matchDocument(makeInput({ senderEmail: 'jane@co-borrower.com' }));

      expect(decision.outcome).toBe('auto_filed');
      expect(decision.chosenContactId).toBe('contact-primary');
    });
  });

  describe('Phone fallback (FOLD-02)', () => {
    it('matches via phone when email lookup fails', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFindContactByEmail.mockResolvedValue(null);

      // Agent tries phone search as fallback
      mockGenerateContent
        .mockResolvedValueOnce(geminiFunctionCallResponse([
          { name: 'search_contact_by_phone', args: { phone: '416-555-1234' } },
        ]))
        .mockResolvedValueOnce(geminiTextResponse({
          chosenContactId: 'contact-phone',
          chosenOpportunityId: null,
          confidence: 0.85,
          reasoning: 'Found contact via phone number fallback.',
        }));

      mockFindContactByPhone.mockResolvedValue('contact-phone');

      const decision = await matchDocument(makeInput({ senderEmail: 'unknown@example.com' }));

      expect(decision.outcome).toBe('auto_filed');
      expect(decision.chosenContactId).toBe('contact-phone');
    });
  });

  describe('Max iterations', () => {
    it('terminates after maxAgentIterations and returns needs_review', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFindContactByEmail.mockResolvedValue(null);

      // Agent keeps making function calls, never gives a final answer
      mockGenerateContent.mockResolvedValue(geminiFunctionCallResponse([
        { name: 'search_contact_by_email', args: { email: 'test@example.com' } },
      ]));
      mockFindContactByEmail.mockResolvedValue(null);

      const decision = await matchDocument(makeInput({ senderEmail: null }));

      expect(decision.outcome).toBe('needs_review');
      expect(decision.reasoning).toContain('max');
      // Should have been called maxAgentIterations times
      expect(mockGenerateContent).toHaveBeenCalledTimes(mockMatchingConfig.maxAgentIterations);
    });
  });

  describe('Disabled mode', () => {
    it('falls back to legacy resolveContactId when matching is disabled', async () => {
      mockMatchingConfig.enabled = false;

      mockResolveContactId.mockResolvedValue({
        contactId: 'contact-legacy',
        resolvedVia: 'email',
      });

      const decision = await matchDocument(makeInput());

      expect(decision.outcome).toBe('auto_filed');
      expect(decision.chosenContactId).toBe('contact-legacy');
      // Agent should NOT have been called
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('returns auto_created when legacy resolve finds no contact', async () => {
      mockMatchingConfig.enabled = false;

      mockResolveContactId.mockResolvedValue({
        contactId: null,
        resolvedVia: null,
      });

      const decision = await matchDocument(makeInput({ senderEmail: null }));

      expect(decision.outcome).toBe('auto_created');
      expect(decision.chosenContactId).toBeNull();
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });
  });
});
