/**
 * Tests for Finmo Document Downloader
 *
 * Tests cover:
 * - listDocRequests: returns parsed array; handles empty response; handles non-array response
 * - getDocRequestDetail: returns parsed detail; throws on non-OK
 * - getSignedDownloadUrl: extracts url field; tries fallback fields (signedUrl, downloadUrl)
 * - downloadFinmoFile: returns Buffer from arrayBuffer
 * - downloadFinmoDocument: orchestrates detail -> signed URL -> download for each file;
 *   skips files with numberOfFiles=0; catches per-file errors
 * - isDocRequestProcessed / markDocRequestProcessed: checks and adds to Redis set
 *
 * All fetch and Redis interactions are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockRedis = vi.hoisted(() => ({
  sismember: vi.fn(),
  sadd: vi.fn(),
  quit: vi.fn().mockResolvedValue('OK'),
}));

// Mock ioredis — named import { Redis as IORedis } in finmo-downloader.ts
vi.mock('ioredis', () => {
  return {
    Redis: class MockIORedis {
      sismember = mockRedis.sismember;
      sadd = mockRedis.sadd;
      quit = mockRedis.quit;
      constructor() { /* no-op */ }
    },
  };
});

// Mock appConfig
vi.mock('../../config.js', () => ({
  appConfig: {
    finmo: {
      apiKey: 'test-api-key',
      apiBase: 'https://test.finmo.ca/api/v1',
    },
    redis: {
      url: undefined,
      host: 'localhost',
      port: 6379,
      password: undefined,
    },
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  listDocRequests,
  getDocRequestDetail,
  getSignedDownloadUrl,
  downloadFinmoFile,
  downloadFinmoDocument,
  isDocRequestProcessed,
  markDocRequestProcessed,
} from '../finmo-downloader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(body: unknown, ok = true, status = 200, statusText = 'OK') {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
    arrayBuffer: async () => {
      if (body instanceof ArrayBuffer) return body;
      if (Buffer.isBuffer(body)) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      return new TextEncoder().encode(JSON.stringify(body)).buffer;
    },
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Finmo Downloader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // listDocRequests
  // -------------------------------------------------------------------------

  describe('listDocRequests', () => {
    it('returns parsed array of doc requests', async () => {
      const docRequests = [
        { id: 'dr-1', name: 'T4', numberOfFiles: 1 },
        { id: 'dr-2', name: 'Pay Stub', numberOfFiles: 2 },
      ];
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(docRequests));

      const result = await listDocRequests('app-123');

      expect(result).toEqual(docRequests);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://test.finmo.ca/api/v1/document-requests?applicationId=app-123',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('returns empty array when no doc requests', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse([]));

      const result = await listDocRequests('app-empty');

      expect(result).toEqual([]);
    });

    it('returns empty array when response is not an array (defensive)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({ error: 'unexpected' }));

      const result = await listDocRequests('app-bad');

      expect(result).toEqual([]);
    });

    it('throws on non-OK response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(null, false, 500, 'Internal Server Error'),
      );

      await expect(listDocRequests('app-err')).rejects.toThrow('Finmo listDocRequests failed: 500');
    });
  });

  // -------------------------------------------------------------------------
  // getDocRequestDetail
  // -------------------------------------------------------------------------

  describe('getDocRequestDetail', () => {
    it('returns parsed doc request detail', async () => {
      const detail = {
        id: 'dr-1',
        name: 'T4',
        numberOfFiles: 1,
        files: [{ src: 's3://bucket/file.pdf', fileName: 'T4-2024.pdf', mimeType: 'application/pdf' }],
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(detail));

      const result = await getDocRequestDetail('dr-1');

      expect(result).toEqual(detail);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://test.finmo.ca/api/v1/document-requests/dr-1',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('throws on non-OK response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(null, false, 404, 'Not Found'),
      );

      await expect(getDocRequestDetail('dr-missing')).rejects.toThrow(
        'Finmo getDocRequestDetail failed: 404 Not Found for dr-missing',
      );
    });
  });

  // -------------------------------------------------------------------------
  // getSignedDownloadUrl
  // -------------------------------------------------------------------------

  describe('getSignedDownloadUrl', () => {
    it('extracts url field from response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse({ url: 'https://s3.amazonaws.com/signed-url' }),
      );

      const result = await getSignedDownloadUrl('s3://bucket/file.pdf');

      expect(result).toBe('https://s3.amazonaws.com/signed-url');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('documents/application-document?src='),
        expect.any(Object),
      );
    });

    it('falls back to signedUrl field', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse({ signedUrl: 'https://cdn.finmo.ca/signed' }),
      );

      const result = await getSignedDownloadUrl('some-src');

      expect(result).toBe('https://cdn.finmo.ca/signed');
    });

    it('falls back to downloadUrl field', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse({ downloadUrl: 'https://download.finmo.ca/file' }),
      );

      const result = await getSignedDownloadUrl('some-src');

      expect(result).toBe('https://download.finmo.ca/file');
    });

    it('throws when no URL field found in response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse({ status: 'ok', data: null }),
      );

      await expect(getSignedDownloadUrl('bad-src')).rejects.toThrow(
        'no URL found in response',
      );
    });

    it('throws on non-OK response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(null, false, 403, 'Forbidden'),
      );

      await expect(getSignedDownloadUrl('forbidden-src')).rejects.toThrow(
        'Finmo getSignedDownloadUrl failed: 403',
      );
    });
  });

  // -------------------------------------------------------------------------
  // downloadFinmoFile
  // -------------------------------------------------------------------------

  describe('downloadFinmoFile', () => {
    it('returns Buffer from arrayBuffer', async () => {
      const content = Buffer.from('pdf-file-content');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
      } as unknown as Response);

      const result = await downloadFinmoFile('https://s3.amazonaws.com/signed');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe('pdf-file-content');
    });

    it('throws on non-OK response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as unknown as Response);

      await expect(downloadFinmoFile('https://s3.amazonaws.com/expired')).rejects.toThrow(
        'Finmo file download failed: 404',
      );
    });
  });

  // -------------------------------------------------------------------------
  // downloadFinmoDocument (orchestrator)
  // -------------------------------------------------------------------------

  describe('downloadFinmoDocument', () => {
    it('downloads all files from a doc request', async () => {
      const detail = {
        id: 'dr-1',
        name: 'T4',
        numberOfFiles: 2,
        files: [
          { src: 'src1', fileName: 'T4-2024.pdf', mimeType: 'application/pdf' },
          { src: 'src2', fileName: 'T4-2023.pdf', mimeType: 'application/pdf' },
        ],
      };

      const fileContent1 = Buffer.from('file-1-content');
      const fileContent2 = Buffer.from('file-2-content');

      vi.spyOn(globalThis, 'fetch')
        // getDocRequestDetail
        .mockResolvedValueOnce(mockFetchResponse(detail))
        // getSignedDownloadUrl for file 1
        .mockResolvedValueOnce(mockFetchResponse({ url: 'https://s3/file1' }))
        // downloadFinmoFile for file 1
        .mockResolvedValueOnce({
          ok: true, arrayBuffer: async () => fileContent1.buffer.slice(fileContent1.byteOffset, fileContent1.byteOffset + fileContent1.byteLength),
        } as unknown as Response)
        // getSignedDownloadUrl for file 2
        .mockResolvedValueOnce(mockFetchResponse({ url: 'https://s3/file2' }))
        // downloadFinmoFile for file 2
        .mockResolvedValueOnce({
          ok: true, arrayBuffer: async () => fileContent2.buffer.slice(fileContent2.byteOffset, fileContent2.byteOffset + fileContent2.byteLength),
        } as unknown as Response);

      const results = await downloadFinmoDocument('app-123', 'dr-1');

      expect(results).toHaveLength(2);
      expect(results[0].filename).toBe('T4-2024.pdf');
      expect(results[0].mimeType).toBe('application/pdf');
      expect(results[0].buffer.toString()).toBe('file-1-content');
      expect(results[1].filename).toBe('T4-2023.pdf');
    });

    it('returns empty array when numberOfFiles is 0', async () => {
      const detail = {
        id: 'dr-empty',
        name: 'Empty',
        numberOfFiles: 0,
        files: [],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockFetchResponse(detail));

      const results = await downloadFinmoDocument('app-123', 'dr-empty');

      expect(results).toEqual([]);
    });

    it('returns empty array when files array is missing', async () => {
      const detail = {
        id: 'dr-no-files',
        name: 'No Files',
        numberOfFiles: 1,
        // no files array
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockFetchResponse(detail));

      const results = await downloadFinmoDocument('app-123', 'dr-no-files');

      expect(results).toEqual([]);
    });

    it('defaults mimeType to application/octet-stream when missing', async () => {
      const detail = {
        id: 'dr-no-mime',
        name: 'No MIME',
        numberOfFiles: 1,
        files: [{ src: 'src1', fileName: 'unknown.bin' }],
      };

      const fileContent = Buffer.from('binary-data');
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse(detail))
        .mockResolvedValueOnce(mockFetchResponse({ url: 'https://s3/file' }))
        .mockResolvedValueOnce({
          ok: true, arrayBuffer: async () => fileContent.buffer.slice(fileContent.byteOffset, fileContent.byteOffset + fileContent.byteLength),
        } as unknown as Response);

      const results = await downloadFinmoDocument('app-123', 'dr-no-mime');

      expect(results).toHaveLength(1);
      expect(results[0].mimeType).toBe('application/octet-stream');
    });

    it('catches per-file errors without failing the whole batch', async () => {
      const detail = {
        id: 'dr-partial',
        name: 'Partial',
        numberOfFiles: 2,
        files: [
          { src: 'src-bad', fileName: 'broken.pdf', mimeType: 'application/pdf' },
          { src: 'src-good', fileName: 'good.pdf', mimeType: 'application/pdf' },
        ],
      };

      const goodContent = Buffer.from('good-file');

      vi.spyOn(globalThis, 'fetch')
        // getDocRequestDetail
        .mockResolvedValueOnce(mockFetchResponse(detail))
        // getSignedDownloadUrl for file 1 -> error
        .mockResolvedValueOnce(mockFetchResponse(null, false, 500, 'Server Error'))
        // getSignedDownloadUrl for file 2 -> success
        .mockResolvedValueOnce(mockFetchResponse({ url: 'https://s3/good' }))
        // downloadFinmoFile for file 2
        .mockResolvedValueOnce({
          ok: true, arrayBuffer: async () => goodContent.buffer.slice(goodContent.byteOffset, goodContent.byteOffset + goodContent.byteLength),
        } as unknown as Response);

      const results = await downloadFinmoDocument('app-123', 'dr-partial');

      // Only the second file should succeed
      expect(results).toHaveLength(1);
      expect(results[0].filename).toBe('good.pdf');
    });
  });

  // -------------------------------------------------------------------------
  // Redis Dedup
  // -------------------------------------------------------------------------

  describe('isDocRequestProcessed', () => {
    it('returns true when doc request is in Redis set', async () => {
      mockRedis.sismember.mockResolvedValue(1);

      const result = await isDocRequestProcessed('dr-existing');

      expect(result).toBe(true);
      expect(mockRedis.sismember).toHaveBeenCalledWith('finmo:processed-docs', 'dr-existing');
    });

    it('returns false when doc request is not in Redis set', async () => {
      mockRedis.sismember.mockResolvedValue(0);

      const result = await isDocRequestProcessed('dr-new');

      expect(result).toBe(false);
    });

    it('returns false when Redis is unavailable (graceful fallback)', async () => {
      mockRedis.sismember.mockRejectedValue(new Error('Connection refused'));

      const result = await isDocRequestProcessed('dr-no-redis');

      expect(result).toBe(false);
    });
  });

  describe('markDocRequestProcessed', () => {
    it('adds doc request ID to Redis set', async () => {
      mockRedis.sadd.mockResolvedValue(1);

      await markDocRequestProcessed('dr-done');

      expect(mockRedis.sadd).toHaveBeenCalledWith('finmo:processed-docs', 'dr-done');
    });

    it('does not throw when Redis is unavailable (graceful fallback)', async () => {
      mockRedis.sadd.mockRejectedValue(new Error('Connection refused'));

      // Should not throw
      await expect(markDocRequestProcessed('dr-no-redis')).resolves.toBeUndefined();
    });
  });
});
