// ============================================================================
// Tests: Email Draft Orchestrator — createEmailDraft + sendEmailDraft
// ============================================================================
//
// Tests the draft orchestrator with mocked Gmail client.
// Verifies end-to-end flow: checklist -> body -> MIME -> Gmail draft.
// Also tests sendEmailDraft for the draft-to-sent pathway.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { GeneratedChecklist, ChecklistItem } from '../../checklist/types/index.js';

// ---------------------------------------------------------------------------
// Mock Gmail Client (before imports)
// ---------------------------------------------------------------------------

vi.mock('../gmail-client.js', () => ({
  createGmailDraft: vi.fn(),
  sendGmailDraft: vi.fn(),
}));

import { createEmailDraft } from '../draft.js';
import { sendEmailDraft } from '../send.js';
import { createGmailDraft } from '../gmail-client.js';
import { sendGmailDraft } from '../gmail-client.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ChecklistItem> & { displayName: string }): ChecklistItem {
  const { displayName, ...rest } = overrides;
  return {
    ruleId: 'test_rule',
    document: displayName,
    displayName,
    stage: 'PRE',
    forEmail: true,
    section: 'test_section',
    ...rest,
  };
}

/** Minimal checklist: 1 borrower, 1 property, 1 shared item (all forEmail=true) */
function makeMinimalChecklist(): GeneratedChecklist {
  return {
    applicationId: 'app-test-001',
    generatedAt: '2026-02-14T00:00:00Z',
    borrowerChecklists: [
      {
        borrowerId: 'b1',
        borrowerName: 'Megan Smith',
        isMainBorrower: true,
        items: [
          makeItem({ ruleId: 'b1_1', displayName: 'Most recent pay stub' }),
          makeItem({ ruleId: 'b1_2', displayName: '2024 T4' }),
        ],
      },
    ],
    propertyChecklists: [
      {
        propertyId: 'p1',
        propertyDescription: 'Main St, Vancouver',
        items: [
          makeItem({ ruleId: 'p1_1', displayName: 'Current Mortgage Statement' }),
        ],
      },
    ],
    sharedItems: [
      makeItem({ ruleId: 's1', displayName: 'Void Cheque' }),
    ],
    internalFlags: [],
    warnings: [],
    stats: {
      totalItems: 4,
      preItems: 4,
      fullItems: 0,
      perBorrowerItems: 2,
      sharedItems: 1,
      internalFlags: 0,
      warnings: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const mockedCreateGmailDraft = vi.mocked(createGmailDraft);
const mockedSendGmailDraft = vi.mocked(sendGmailDraft);

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateGmailDraft.mockResolvedValue('draft-123');
  mockedSendGmailDraft.mockResolvedValue({
    messageId: 'msg-456',
    threadId: 'thread-789',
  });
});

// ---------------------------------------------------------------------------
// Tests: createEmailDraft
// ---------------------------------------------------------------------------

describe('createEmailDraft', () => {
  const checklist = makeMinimalChecklist();
  const input = {
    checklist,
    recipientEmail: 'client@example.com',
    borrowerFirstNames: ['Megan'],
    contactId: 'contact-001',
  };

  test('calls createGmailDraft with base64url-encoded content', async () => {
    await createEmailDraft(input);
    expect(mockedCreateGmailDraft).toHaveBeenCalledOnce();
    const rawArg = mockedCreateGmailDraft.mock.calls[0][0];
    // base64url: only alphanumeric, -, _ (no +, /, =)
    expect(rawArg).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('returns draftId from Gmail API', async () => {
    const result = await createEmailDraft(input);
    expect(result.draftId).toBe('draft-123');
  });

  test('uses dev recipient override when isDev=true', async () => {
    // APP_ENV defaults to 'development' in test, so recipientOverride is active
    const result = await createEmailDraft(input);
    expect(result.recipientEmail).toBe('dev@venturemortgages.com');
  });

  test('subject contains borrower names', async () => {
    const result = await createEmailDraft(input);
    expect(result.subject).toContain('Megan');
  });

  test('subject has [TEST] prefix in dev mode', async () => {
    const result = await createEmailDraft(input);
    expect(result.subject).toMatch(/^\[TEST\] /);
  });

  test('bodyPreview is first 200 chars of email body', async () => {
    const result = await createEmailDraft(input);
    expect(result.bodyPreview.length).toBeLessThanOrEqual(200);
    expect(result.bodyPreview).toMatch(/^Hey/);
  });

  test('MIME content contains borrower doc items', async () => {
    await createEmailDraft(input);
    const rawArg = mockedCreateGmailDraft.mock.calls[0][0];
    // Decode outer base64url -> MIME message, then extract base64-encoded body
    const mime = Buffer.from(rawArg, 'base64url').toString('utf-8');
    const parts = mime.split('\r\n\r\n');
    const bodyDecoded = Buffer.from(parts[1], 'base64').toString('utf-8');
    expect(bodyDecoded).toContain('Most recent pay stub');
    expect(bodyDecoded).toContain('2024 T4');
    expect(bodyDecoded).toContain('Current Mortgage Statement');
    expect(bodyDecoded).toContain('Void Cheque');
  });

  test('subject joins multiple borrower names with &', async () => {
    const multiInput = {
      ...input,
      borrowerFirstNames: ['Megan', 'Cory'],
    };
    const result = await createEmailDraft(multiInput);
    expect(result.subject).toContain('Megan & Cory');
  });
});

// ---------------------------------------------------------------------------
// Tests: sendEmailDraft
// ---------------------------------------------------------------------------

describe('sendEmailDraft', () => {
  test('returns messageId and threadId from Gmail API', async () => {
    const result = await sendEmailDraft('draft-123');
    expect(result.messageId).toBe('msg-456');
    expect(result.threadId).toBe('thread-789');
  });

  test('calls sendGmailDraft with the provided draft ID', async () => {
    await sendEmailDraft('draft-abc');
    expect(mockedSendGmailDraft).toHaveBeenCalledOnce();
    expect(mockedSendGmailDraft).toHaveBeenCalledWith('draft-abc');
  });
});
