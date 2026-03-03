// ============================================================================
// Tests: Reminder Scheduler
// ============================================================================
//
// Tests the daily scan orchestrator:
// - runReminderScan processes each overdue opportunity
// - Handles errors gracefully (one failure doesn't block others)
// - Respects kill switch

import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { MissingDocEntry } from '../../crm/types/index.js';

// ============================================================================
// Mock Setup
// ============================================================================

const { mockScanForOverdueReminders, mockCreateOrUpdateReminderTask, mockSendReminderNotification, mockReminderConfig } = vi.hoisted(() => ({
  mockScanForOverdueReminders: vi.fn(),
  mockCreateOrUpdateReminderTask: vi.fn(),
  mockSendReminderNotification: vi.fn(),
  mockReminderConfig: { enabled: true, intervalBusinessDays: 3 },
}));

vi.mock('../scanner.js', () => ({
  scanForOverdueReminders: mockScanForOverdueReminders,
}));

vi.mock('../reminder-task.js', () => ({
  createOrUpdateReminderTask: mockCreateOrUpdateReminderTask,
}));

vi.mock('../notify-cat.js', () => ({
  sendReminderNotification: mockSendReminderNotification,
}));

vi.mock('../follow-up-text.js', () => ({
  generateFollowUpText: vi.fn().mockReturnValue('Follow-up email text...'),
  generateReminderTaskBody: vi.fn().mockReturnValue('CRM task body...'),
}));

vi.mock('../types.js', () => ({
  reminderConfig: mockReminderConfig,
}));

vi.mock('../../webhook/queue.js', () => ({
  getWebhookQueue: vi.fn().mockReturnValue({
    add: vi.fn().mockResolvedValue({ id: 'job-123' }),
    getRepeatableJobs: vi.fn().mockResolvedValue([]),
    removeRepeatableByKey: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockReminderConfig.enabled = true;
});

// ============================================================================
// Import module under test
// ============================================================================

import { runReminderScan } from '../scheduler.js';

// ============================================================================
// runReminderScan
// ============================================================================

describe('runReminderScan', () => {
  const missingDocs: MissingDocEntry[] = [
    { name: 'Letter of Employment', stage: 'PRE' as const },
    { name: 'Pay Stubs', stage: 'PRE' as const },
  ];

  const overdueOpps = [
    {
      opportunityId: 'opp-1',
      contactId: 'contact-1',
      borrowerName: 'John Smith',
      borrowerEmail: 'john@example.com',
      missingDocs,
      emailSentDate: '2026-02-25',
      businessDaysOverdue: 5,
      reminderCycle: 1,
    },
    {
      opportunityId: 'opp-2',
      contactId: 'contact-2',
      borrowerName: 'Jane Doe',
      borrowerEmail: 'jane@example.com',
      missingDocs: [{ name: 'T4', stage: 'PRE' as const }],
      emailSentDate: '2026-02-24',
      businessDaysOverdue: 6,
      reminderCycle: 2,
    },
  ];

  test('processes all overdue opportunities', async () => {
    mockScanForOverdueReminders.mockResolvedValueOnce({
      overdue: overdueOpps,
      scannedCount: 5,
      skippedTerminal: 1,
    });
    mockCreateOrUpdateReminderTask.mockResolvedValue('task-id');
    mockSendReminderNotification.mockResolvedValue(undefined);

    const result = await runReminderScan();

    expect(result).toEqual({ processed: 2, errors: 0 });
    expect(mockCreateOrUpdateReminderTask).toHaveBeenCalledTimes(2);
    expect(mockSendReminderNotification).toHaveBeenCalledTimes(2);
  });

  test('calls createOrUpdateReminderTask with correct args', async () => {
    mockScanForOverdueReminders.mockResolvedValueOnce({
      overdue: [overdueOpps[0]],
      scannedCount: 1,
      skippedTerminal: 0,
    });
    mockCreateOrUpdateReminderTask.mockResolvedValue('task-id');
    mockSendReminderNotification.mockResolvedValue(undefined);

    await runReminderScan();

    expect(mockCreateOrUpdateReminderTask).toHaveBeenCalledWith(
      'contact-1',
      'John Smith',
      'CRM task body...',
    );
  });

  test('calls sendReminderNotification with correct args', async () => {
    mockScanForOverdueReminders.mockResolvedValueOnce({
      overdue: [overdueOpps[0]],
      scannedCount: 1,
      skippedTerminal: 0,
    });
    mockCreateOrUpdateReminderTask.mockResolvedValue('task-id');
    mockSendReminderNotification.mockResolvedValue(undefined);

    await runReminderScan();

    expect(mockSendReminderNotification).toHaveBeenCalledWith(
      'John Smith',
      'john@example.com',
      2, // missingDocs.length
      5, // businessDaysOverdue
    );
  });

  test('handles errors gracefully (one failure does not block others)', async () => {
    mockScanForOverdueReminders.mockResolvedValueOnce({
      overdue: overdueOpps,
      scannedCount: 5,
      skippedTerminal: 0,
    });
    // First opp: task creation throws
    mockCreateOrUpdateReminderTask
      .mockRejectedValueOnce(new Error('CRM API down'))
      .mockResolvedValueOnce('task-id');
    mockSendReminderNotification.mockResolvedValue(undefined);

    const result = await runReminderScan();

    // First opp failed, second succeeded
    expect(result).toEqual({ processed: 1, errors: 1 });
    // Second opp still processed
    expect(mockSendReminderNotification).toHaveBeenCalledTimes(1);
  });

  test('returns zero when reminders disabled', async () => {
    mockReminderConfig.enabled = false;

    const result = await runReminderScan();

    expect(result).toEqual({ processed: 0, errors: 0 });
    expect(mockScanForOverdueReminders).not.toHaveBeenCalled();
  });

  test('returns zero when no overdue opportunities', async () => {
    mockScanForOverdueReminders.mockResolvedValueOnce({
      overdue: [],
      scannedCount: 3,
      skippedTerminal: 0,
    });

    const result = await runReminderScan();

    expect(result).toEqual({ processed: 0, errors: 0 });
    expect(mockCreateOrUpdateReminderTask).not.toHaveBeenCalled();
    expect(mockSendReminderNotification).not.toHaveBeenCalled();
  });
});
