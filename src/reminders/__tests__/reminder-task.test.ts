// ============================================================================
// Tests: CRM Reminder Task CRUD + Cat Email Notification
// ============================================================================
//
// Tests for:
// - findReminderTask: searches contact tasks for "Follow up: Need docs" title
// - createOrUpdateReminderTask: dedup (find then update vs create)
// - closeReminderTask: marks task as completed
// - sendReminderNotification: creates and sends Cat email notification

import { describe, test, expect, vi, beforeEach, afterAll } from 'vitest';

// ============================================================================
// Mock Setup — use vi.hoisted() so mock fns are available in vi.mock factories
// ============================================================================

const { mockCreateGmailDraft, mockSendGmailDraft, mockEncodeMimeMessage } = vi.hoisted(() => ({
  mockCreateGmailDraft: vi.fn(),
  mockSendGmailDraft: vi.fn(),
  mockEncodeMimeMessage: vi.fn().mockReturnValue('base64-encoded-message'),
}));

vi.mock('../../crm/config.js', () => ({
  crmConfig: {
    locationId: 'test-location',
    apiKey: 'test-key',
    baseUrl: 'https://test.api',
    isDev: true,
    userIds: {
      cat: 'cat-user-id',
      taylor: 'taylor-user-id',
    },
    stageIds: {
      applicationReceived: 'stage-app-received',
      collectingDocuments: 'stage-collecting-docs',
      allDocsReceived: 'stage-all-docs',
    },
  },
  devPrefix: (text: string) => `[TEST] ${text}`,
}));

vi.mock('../../crm/errors.js', () => ({
  CrmApiError: class CrmApiError extends Error {
    statusCode: number;
    responseBody: string;
    constructor(message: string, statusCode: number, responseBody: string) {
      super(message);
      this.name = 'CrmApiError';
      this.statusCode = statusCode;
      this.responseBody = responseBody;
    }
  },
  CrmRateLimitError: class CrmRateLimitError extends Error {
    constructor(responseBody: string) {
      super('Rate limit');
      this.name = 'CrmRateLimitError';
    }
  },
  CrmAuthError: class CrmAuthError extends Error {
    constructor(responseBody: string) {
      super('Auth error');
      this.name = 'CrmAuthError';
    }
  },
}));

vi.mock('../../email/gmail-client.js', () => ({
  createGmailDraft: mockCreateGmailDraft,
  sendGmailDraft: mockSendGmailDraft,
}));

vi.mock('../../email/config.js', () => ({
  emailConfig: {
    isDev: true,
    senderAddress: 'dev@venturemortgages.com',
    recipientOverride: 'dev@venturemortgages.com',
    subjectPrefix: '[TEST] ',
    docInbox: 'dev@venturemortgages.com',
    bccAddress: 'dev@venturemortgages.com',
  },
}));

vi.mock('../../email/mime.js', () => ({
  encodeMimeMessage: mockEncodeMimeMessage,
}));

// Mock global fetch for CRM API calls in reminder-task.ts
const mockTaskFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockTaskFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// ============================================================================
// Import modules under test (after mocks are set up)
// ============================================================================

import {
  findReminderTask,
  createOrUpdateReminderTask,
  closeReminderTask,
} from '../reminder-task.js';

import { sendReminderNotification } from '../notify-cat.js';

// ============================================================================
// findReminderTask
// ============================================================================

describe('findReminderTask', () => {
  test('returns matching task when found', async () => {
    mockTaskFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [
          { id: 'task-1', title: '[TEST] Review doc request', completed: false },
          { id: 'task-2', title: '[TEST] Follow up: Need docs - John Smith', completed: false },
          { id: 'task-3', title: 'Other task', completed: true },
        ],
      }),
    });

    const result = await findReminderTask('contact-123');
    expect(result).toEqual({
      id: 'task-2',
      title: '[TEST] Follow up: Need docs - John Smith',
      completed: false,
    });
  });

  test('returns null when no matching task exists', async () => {
    mockTaskFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [
          { id: 'task-1', title: '[TEST] Review doc request', completed: false },
        ],
      }),
    });

    const result = await findReminderTask('contact-123');
    expect(result).toBeNull();
  });

  test('returns null on API error (non-fatal)', async () => {
    mockTaskFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await findReminderTask('contact-123');
    expect(result).toBeNull();
  });
});

// ============================================================================
// createOrUpdateReminderTask
// ============================================================================

describe('createOrUpdateReminderTask', () => {
  test('creates new task when no existing reminder task', async () => {
    // First call: GET tasks (empty)
    mockTaskFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tasks: [] }),
    });
    // Second call: POST create task
    mockTaskFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { id: 'new-task-123' } }),
    });

    const result = await createOrUpdateReminderTask(
      'contact-123',
      'John Smith',
      'Task body with missing docs...',
    );

    expect(result).toBe('new-task-123');
    // Verify POST was called with correct title pattern
    const postCall = mockTaskFetch.mock.calls[1];
    const postBody = JSON.parse(postCall[1].body);
    expect(postBody.title).toBe('[TEST] Follow up: Need docs - John Smith');
    expect(postBody.assignedTo).toBe('cat-user-id');
    expect(postBody.body).toBe('Task body with missing docs...');
  });

  test('updates existing task instead of creating duplicate', async () => {
    // First call: GET tasks (has existing reminder)
    mockTaskFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [
          { id: 'existing-task-456', title: '[TEST] Follow up: Need docs - John Smith', completed: false },
        ],
      }),
    });
    // Second call: PUT update task
    mockTaskFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await createOrUpdateReminderTask(
      'contact-123',
      'John Smith',
      'Updated task body...',
    );

    expect(result).toBe('existing-task-456');
    // Verify PUT was called (update, not POST create)
    const putCall = mockTaskFetch.mock.calls[1];
    expect(putCall[0]).toContain('/tasks/existing-task-456');
    expect(putCall[1].method).toBe('PUT');
    const putBody = JSON.parse(putCall[1].body);
    expect(putBody.body).toBe('Updated task body...');
  });

  test('returns undefined on error (non-fatal)', async () => {
    mockTaskFetch.mockRejectedValueOnce(new Error('API down'));

    const result = await createOrUpdateReminderTask(
      'contact-123',
      'John Smith',
      'Task body',
    );

    expect(result).toBeUndefined();
  });
});

// ============================================================================
// closeReminderTask
// ============================================================================

describe('closeReminderTask', () => {
  test('marks existing task as completed', async () => {
    // First call: GET tasks (has existing reminder)
    mockTaskFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [
          { id: 'task-789', title: '[TEST] Follow up: Need docs - Jane Doe', completed: false },
        ],
      }),
    });
    // Second call: PUT complete task
    mockTaskFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    await closeReminderTask('contact-123');

    // Verify the PUT was called with completed: true
    const putCall = mockTaskFetch.mock.calls[1];
    expect(putCall[0]).toContain('/tasks/task-789');
    const putBody = JSON.parse(putCall[1].body);
    expect(putBody.completed).toBe(true);
  });

  test('does nothing when no reminder task exists', async () => {
    mockTaskFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tasks: [] }),
    });

    await closeReminderTask('contact-123');

    // Only one fetch call (the search), no PUT
    expect(mockTaskFetch).toHaveBeenCalledTimes(1);
  });

  test('does nothing when task already completed', async () => {
    mockTaskFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [
          { id: 'task-789', title: '[TEST] Follow up: Need docs - Jane Doe', completed: true },
        ],
      }),
    });

    await closeReminderTask('contact-123');

    // Only one fetch call (the search), no PUT
    expect(mockTaskFetch).toHaveBeenCalledTimes(1);
  });

  test('does not throw on error (non-fatal)', async () => {
    mockTaskFetch.mockRejectedValueOnce(new Error('Network error'));

    // Should not throw
    await closeReminderTask('contact-123');
  });
});

// ============================================================================
// sendReminderNotification
// ============================================================================

describe('sendReminderNotification', () => {
  test('creates and sends email notification to Cat', async () => {
    mockCreateGmailDraft.mockResolvedValueOnce({ draftId: 'draft-123' });
    mockSendGmailDraft.mockResolvedValueOnce({ messageId: 'msg-123' });

    await sendReminderNotification({
      borrowerName: 'John Smith',
      borrowerEmail: 'john@example.com',
      missingDocs: [{ name: 'Pay Stub', stage: 'PRE' }, { name: 'T4', stage: 'PRE' }, { name: 'Bank Statements', stage: 'PRE' }] as any,
      businessDaysOverdue: 5,
      followUpText: 'Hi John,\n\nJust a friendly follow-up...',
      driveFolderUrl: 'https://drive.google.com/drive/folders/abc123',
    });

    // Verify draft was created
    expect(mockCreateGmailDraft).toHaveBeenCalledTimes(1);
    // Verify draft was immediately sent
    expect(mockSendGmailDraft).toHaveBeenCalledWith('draft-123');
  });

  test('uses recipientOverride in dev mode', async () => {
    mockCreateGmailDraft.mockResolvedValueOnce({ draftId: 'draft-123' });
    mockSendGmailDraft.mockResolvedValueOnce({ messageId: 'msg-123' });

    await sendReminderNotification({
      borrowerName: 'John Smith',
      borrowerEmail: 'john@example.com',
      missingDocs: [{ name: 'Pay Stub', stage: 'PRE' }, { name: 'T4', stage: 'PRE' }, { name: 'Bank Statements', stage: 'PRE' }] as any,
      businessDaysOverdue: 5,
      followUpText: 'Hi John,\n\nJust a friendly follow-up...',
      driveFolderUrl: 'https://drive.google.com/drive/folders/abc123',
    });

    // In dev mode, the recipient should be overridden
    expect(mockEncodeMimeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'dev@venturemortgages.com',
        subject: '[TEST] Follow up: Need docs - John Smith',
      }),
    );
  });

  test('does not throw on error (non-fatal)', async () => {
    mockCreateGmailDraft.mockRejectedValueOnce(new Error('Gmail auth error'));

    // Should not throw
    await sendReminderNotification({
      borrowerName: 'John Smith',
      borrowerEmail: 'john@example.com',
      missingDocs: [{ name: 'Pay Stub', stage: 'PRE' }, { name: 'T4', stage: 'PRE' }, { name: 'Bank Statements', stage: 'PRE' }] as any,
      businessDaysOverdue: 5,
      followUpText: 'Hi John,\n\nJust a friendly follow-up...',
      driveFolderUrl: 'https://drive.google.com/drive/folders/abc123',
    });
  });

  test('email body includes client details', async () => {
    mockCreateGmailDraft.mockResolvedValueOnce({ draftId: 'draft-123' });
    mockSendGmailDraft.mockResolvedValueOnce({ messageId: 'msg-123' });

    await sendReminderNotification({
      borrowerName: 'John Smith',
      borrowerEmail: 'john@example.com',
      missingDocs: [{ name: 'Pay Stub', stage: 'PRE' }, { name: 'T4', stage: 'PRE' }, { name: 'Bank Statements', stage: 'PRE' }] as any,
      businessDaysOverdue: 5,
      followUpText: 'Hi John,\n\nJust a friendly follow-up...',
      driveFolderUrl: 'https://drive.google.com/drive/folders/abc123',
    });

    expect(mockEncodeMimeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('John Smith'),
      }),
    );
    expect(mockEncodeMimeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('john@example.com'),
      }),
    );
    expect(mockEncodeMimeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('3 docs'),
      }),
    );
    expect(mockEncodeMimeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('5 business days'),
      }),
    );
  });
});
