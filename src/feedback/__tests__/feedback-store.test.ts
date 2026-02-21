/**
 * Tests for Feedback Store — JSON file append/read
 *
 * Tests cover:
 * - loadFeedbackRecords: returns records from existing file
 * - loadFeedbackRecords: returns empty array when file doesn't exist
 * - appendFeedbackRecord: appends to existing records
 * - appendFeedbackRecord: creates file when it doesn't exist
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FeedbackRecord } from '../types.js';

// ---------------------------------------------------------------------------
// Mock fs and config
// ---------------------------------------------------------------------------

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('../config.js', () => ({
  feedbackConfig: {
    feedbackFilePath: '/test/data/feedback-records.json',
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { loadFeedbackRecords, appendFeedbackRecord } from '../feedback-store.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testRecord: FeedbackRecord = {
  id: 'rec-1',
  contactId: 'contact-123',
  createdAt: '2026-02-20T00:00:00Z',
  context: {
    goal: 'purchase',
    incomeTypes: ['employed/salaried'],
    propertyTypes: ['owner_occupied'],
    borrowerCount: 1,
    hasGiftDP: false,
    hasRentalIncome: false,
  },
  contextText: 'Single purchase, salaried, owner-occupied',
  embedding: null,
  edits: {
    itemsRemoved: ['Void Cheque'],
    itemsAdded: [],
    itemsReworded: [],
    sectionsReordered: false,
    otherChanges: null,
    noChanges: false,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feedback Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  describe('loadFeedbackRecords', () => {
    it('returns records from existing file', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([testRecord]));

      const records = await loadFeedbackRecords();

      expect(records).toHaveLength(1);
      expect(records[0].id).toBe('rec-1');
    });

    it('returns empty array when file does not exist', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      mockReadFile.mockRejectedValue(err);

      const records = await loadFeedbackRecords();

      expect(records).toEqual([]);
    });

    it('throws on other file errors', async () => {
      const err = new Error('Permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      mockReadFile.mockRejectedValue(err);

      await expect(loadFeedbackRecords()).rejects.toThrow('Permission denied');
    });
  });

  describe('appendFeedbackRecord', () => {
    it('appends to existing records', async () => {
      const existing = [testRecord];
      mockReadFile.mockResolvedValue(JSON.stringify(existing));

      const newRecord: FeedbackRecord = { ...testRecord, id: 'rec-2' };
      await appendFeedbackRecord(newRecord);

      expect(mockWriteFile).toHaveBeenCalledOnce();
      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written).toHaveLength(2);
      expect(written[1].id).toBe('rec-2');
    });

    it('creates file when it does not exist', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      mockReadFile.mockRejectedValue(err);

      await appendFeedbackRecord(testRecord);

      expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledOnce();
      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written).toHaveLength(1);
      expect(written[0].id).toBe('rec-1');
    });
  });
});
