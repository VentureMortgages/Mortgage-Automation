/**
 * Tests for Gmail Reader — Inbox Polling via History API
 *
 * Tests cover:
 * - pollForNewMessages: happy path, empty history, deduplication, stale historyId recovery
 * - getMessageDetails: field extraction, "Name <email>" parsing
 * - getInitialHistoryId: profile historyId retrieval
 *
 * Uses a mock gmail client object matching the Gmail API shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getInitialHistoryId,
  pollForNewMessages,
  getMessageDetails,
} from '../gmail-reader.js';

// ---------------------------------------------------------------------------
// Mock Gmail Client Factory
// ---------------------------------------------------------------------------

function createMockGmailClient() {
  return {
    users: {
      getProfile: vi.fn(),
      history: {
        list: vi.fn(),
      },
      messages: {
        get: vi.fn(),
        list: vi.fn(),
      },
    },
  };
}

type MockGmailClient = ReturnType<typeof createMockGmailClient>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gmail-reader', () => {
  let gmail: MockGmailClient;

  beforeEach(() => {
    gmail = createMockGmailClient();
  });

  // -------------------------------------------------------------------------
  // getInitialHistoryId
  // -------------------------------------------------------------------------

  describe('getInitialHistoryId', () => {
    it('returns the historyId from the user profile', async () => {
      gmail.users.getProfile.mockResolvedValue({
        data: { historyId: '12345' },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await getInitialHistoryId(gmail as any);
      expect(result).toBe('12345');
      expect(gmail.users.getProfile).toHaveBeenCalledWith({ userId: 'me' });
    });

    it('throws if profile has no historyId', async () => {
      gmail.users.getProfile.mockResolvedValue({
        data: { historyId: null },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(getInitialHistoryId(gmail as any)).rejects.toThrow(
        'Gmail profile returned no historyId',
      );
    });
  });

  // -------------------------------------------------------------------------
  // pollForNewMessages
  // -------------------------------------------------------------------------

  describe('pollForNewMessages', () => {
    it('returns message IDs from history records', async () => {
      gmail.users.history.list.mockResolvedValue({
        data: {
          historyId: '200',
          history: [
            {
              messagesAdded: [
                { message: { id: 'msg-1' } },
                { message: { id: 'msg-2' } },
              ],
            },
          ],
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await pollForNewMessages(gmail as any, '100');

      expect(result.messageIds).toEqual(['msg-1', 'msg-2']);
      expect(result.newHistoryId).toBe('200');
      expect(gmail.users.history.list).toHaveBeenCalledWith({
        userId: 'me',
        startHistoryId: '100',
        historyTypes: ['messageAdded'],
        labelId: 'INBOX',
      });
    });

    it('returns empty array when no new messages', async () => {
      gmail.users.history.list.mockResolvedValue({
        data: {
          historyId: '150',
          history: undefined, // No history records
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await pollForNewMessages(gmail as any, '100');

      expect(result.messageIds).toEqual([]);
      expect(result.newHistoryId).toBe('150');
    });

    it('deduplicates message IDs across multiple history records', async () => {
      gmail.users.history.list.mockResolvedValue({
        data: {
          historyId: '300',
          history: [
            {
              messagesAdded: [
                { message: { id: 'msg-1' } },
                { message: { id: 'msg-2' } },
              ],
            },
            {
              messagesAdded: [
                { message: { id: 'msg-2' } }, // Duplicate
                { message: { id: 'msg-3' } },
              ],
            },
          ],
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await pollForNewMessages(gmail as any, '100');

      expect(result.messageIds).toHaveLength(3);
      expect(result.messageIds).toContain('msg-1');
      expect(result.messageIds).toContain('msg-2');
      expect(result.messageIds).toContain('msg-3');
    });

    it('recovers from stale historyId (404 error)', async () => {
      // history.list throws a 404 (stale historyId)
      const error404 = new Error('Requested entity was not found.');
      (error404 as unknown as { code: number }).code = 404;
      gmail.users.history.list.mockRejectedValue(error404);

      // Fallback: messages.list and getProfile
      gmail.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'recent-1' }, { id: 'recent-2' }],
        },
      });
      gmail.users.getProfile.mockResolvedValue({
        data: { historyId: '500' },
      });

      // Suppress console.warn for this test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await pollForNewMessages(gmail as any, 'stale-id');

      expect(result.messageIds).toEqual(['recent-1', 'recent-2']);
      expect(result.newHistoryId).toBe('500');

      // Verify fallback was called
      expect(gmail.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: 'newer_than:1d',
        labelIds: ['INBOX'],
        maxResults: 50,
      });

      // Verify warning was logged
      expect(warnSpy).toHaveBeenCalledWith(
        '[intake] historyId stale, falling back to recent messages',
      );

      warnSpy.mockRestore();
    });

    it('recovers from stale historyId (notFound message)', async () => {
      const notFoundError = new Error('notFound: historyId has expired');
      gmail.users.history.list.mockRejectedValue(notFoundError);

      gmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'fallback-1' }] },
      });
      gmail.users.getProfile.mockResolvedValue({
        data: { historyId: '600' },
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await pollForNewMessages(gmail as any, 'old-id');

      expect(result.messageIds).toEqual(['fallback-1']);
      expect(result.newHistoryId).toBe('600');

      warnSpy.mockRestore();
    });

    it('re-throws non-stale errors', async () => {
      const serverError = new Error('Internal Server Error');
      (serverError as unknown as { code: number }).code = 500;
      gmail.users.history.list.mockRejectedValue(serverError);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(pollForNewMessages(gmail as any, '100')).rejects.toThrow(
        'Internal Server Error',
      );

      // Fallback should NOT have been called
      expect(gmail.users.messages.list).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getMessageDetails
  // -------------------------------------------------------------------------

  describe('getMessageDetails', () => {
    it('extracts correct fields from message headers', async () => {
      gmail.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg-abc',
          threadId: 'thread-xyz',
          historyId: '999',
          payload: {
            headers: [
              { name: 'From', value: 'sender@example.com' },
              { name: 'Subject', value: 'Test Subject' },
              { name: 'Date', value: 'Wed, 12 Feb 2026 10:00:00 -0500' },
            ],
          },
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = await getMessageDetails(gmail as any, 'msg-abc');

      expect(meta).toEqual({
        messageId: 'msg-abc',
        threadId: 'thread-xyz',
        from: 'sender@example.com',
        subject: 'Test Subject',
        date: 'Wed, 12 Feb 2026 10:00:00 -0500',
        historyId: '999',
      });

      expect(gmail.users.messages.get).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg-abc',
        format: 'full',
      });
    });

    it('parses "Name <email>" format correctly', async () => {
      gmail.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg-def',
          threadId: null,
          historyId: '100',
          payload: {
            headers: [
              { name: 'From', value: 'John Doe <john@example.com>' },
              { name: 'Subject', value: 'My Docs' },
              { name: 'Date', value: 'Thu, 13 Feb 2026 12:00:00 +0000' },
            ],
          },
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = await getMessageDetails(gmail as any, 'msg-def');

      expect(meta.from).toBe('john@example.com');
      expect(meta.threadId).toBeNull();
    });

    it('handles missing headers gracefully', async () => {
      gmail.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg-empty',
          threadId: null,
          historyId: '50',
          payload: {
            headers: [], // No headers at all
          },
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = await getMessageDetails(gmail as any, 'msg-empty');

      expect(meta.from).toBe('');
      expect(meta.subject).toBe('');
      expect(meta.date).toBe('');
    });

    it('handles angle-bracket-only email in From header', async () => {
      gmail.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg-brackets',
          threadId: 'thread-1',
          historyId: '70',
          payload: {
            headers: [
              { name: 'From', value: '<noreply@system.com>' },
              { name: 'Subject', value: 'Auto' },
              { name: 'Date', value: 'Mon, 10 Feb 2026 08:00:00 +0000' },
            ],
          },
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = await getMessageDetails(gmail as any, 'msg-brackets');

      expect(meta.from).toBe('noreply@system.com');
    });
  });
});
