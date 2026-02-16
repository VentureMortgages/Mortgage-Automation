/**
 * Finmo Document Downloader
 *
 * Downloads documents from the Finmo API for processing in the intake pipeline.
 * Uses the confirmed API endpoints:
 * - GET /document-requests?applicationId={id} — list document requests
 * - GET /document-requests/{id} — get detail with file list
 * - GET /documents/application-document?src={src} — get signed download URL
 *
 * Also provides Redis-based deduplication to avoid re-processing the same
 * document request across restarts or retries.
 *
 * Auth: Bearer token from appConfig.finmo.apiKey (same pattern as finmo-client.ts).
 *
 * Security:
 * - Only logs metadata (applicationId, docRequestId, file count) — no PII
 * - File buffers are held in memory only during job processing
 *
 * Consumers: intake-worker.ts (processFinmoSource)
 */

import { Redis as IORedis } from 'ioredis';
import { appConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FinmoDocRequestFile {
  src: string;
  fileName: string;
  mimeType?: string;
}

interface FinmoDocRequest {
  id: string;
  name: string;
  numberOfFiles: number;
  files?: FinmoDocRequestFile[];
}

/** Result of downloading a single file from Finmo */
export interface FinmoDownloadResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// Redis Dedup Key
// ---------------------------------------------------------------------------

const PROCESSED_SET_KEY = 'finmo:processed-docs';

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${appConfig.finmo.apiKey}`,
    Accept: 'application/json',
  };
}

function createRedisClient(): IORedis {
  if (appConfig.redis.url) {
    return new IORedis(appConfig.redis.url);
  }
  return new IORedis({
    host: appConfig.redis.host,
    port: appConfig.redis.port,
    password: appConfig.redis.password,
  });
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

/**
 * List document requests for a Finmo application.
 *
 * @param applicationId - Finmo application ID
 * @returns Array of document requests (may be empty)
 */
export async function listDocRequests(applicationId: string): Promise<FinmoDocRequest[]> {
  const url = `${appConfig.finmo.apiBase}/document-requests?applicationId=${applicationId}`;

  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(
      `Finmo listDocRequests failed: ${response.status} ${response.statusText}`,
    );
  }

  const data: unknown = await response.json();

  // Defensive: if response is not an array, return empty
  if (!Array.isArray(data)) {
    console.warn('[finmo-downloader] listDocRequests returned non-array, returning empty', {
      applicationId,
      type: typeof data,
    });
    return [];
  }

  console.log('[finmo-downloader] Listed doc requests:', {
    applicationId,
    count: data.length,
  });

  return data as FinmoDocRequest[];
}

/**
 * Get detail for a specific document request (includes file list).
 *
 * @param docRequestId - Finmo document request ID
 * @returns Document request detail with files array
 * @throws Error on non-OK response
 */
export async function getDocRequestDetail(docRequestId: string): Promise<FinmoDocRequest> {
  const url = `${appConfig.finmo.apiBase}/document-requests/${docRequestId}`;

  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(
      `Finmo getDocRequestDetail failed: ${response.status} ${response.statusText} for ${docRequestId}`,
    );
  }

  return (await response.json()) as FinmoDocRequest;
}

/**
 * Get a signed download URL for a Finmo document file.
 *
 * Defensively checks multiple response fields for the URL since the exact
 * shape may vary (url, signedUrl, downloadUrl).
 *
 * @param fileSrc - The src field from a FinmoDocRequestFile
 * @returns Signed download URL string
 * @throws Error if no URL found in response
 */
export async function getSignedDownloadUrl(fileSrc: string): Promise<string> {
  const url = `${appConfig.finmo.apiBase}/documents/application-document?src=${encodeURIComponent(fileSrc)}`;

  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(
      `Finmo getSignedDownloadUrl failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;

  // Try multiple field names defensively
  const signedUrl = data.url ?? data.signedUrl ?? data.downloadUrl;
  if (typeof signedUrl !== 'string' || signedUrl.length === 0) {
    throw new Error(
      'Finmo getSignedDownloadUrl: no URL found in response. Fields: ' +
        Object.keys(data).join(', '),
    );
  }

  return signedUrl;
}

/**
 * Download a file from a signed URL (no auth needed).
 *
 * @param signedUrl - Pre-signed download URL
 * @returns File contents as a Buffer
 * @throws Error on non-OK response
 */
export async function downloadFinmoFile(signedUrl: string): Promise<Buffer> {
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(
      `Finmo file download failed: ${response.status} ${response.statusText}`,
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Download all files for a Finmo document request.
 *
 * Orchestrates: get detail -> for each file: get signed URL -> download.
 * Errors on individual files are caught (does not fail the whole batch).
 *
 * @param applicationId - Finmo application ID (for logging)
 * @param docRequestId - Finmo document request ID
 * @returns Array of download results (may be empty)
 */
export async function downloadFinmoDocument(
  applicationId: string,
  docRequestId: string,
): Promise<FinmoDownloadResult[]> {
  const detail = await getDocRequestDetail(docRequestId);

  if (detail.numberOfFiles === 0 || !detail.files || detail.files.length === 0) {
    console.log('[finmo-downloader] Doc request has no files:', {
      docRequestId,
      numberOfFiles: detail.numberOfFiles,
    });
    return [];
  }

  const results: FinmoDownloadResult[] = [];

  for (const file of detail.files) {
    try {
      const signedUrl = await getSignedDownloadUrl(file.src);
      const buffer = await downloadFinmoFile(signedUrl);

      results.push({
        buffer,
        filename: file.fileName,
        mimeType: file.mimeType ?? 'application/octet-stream',
      });
    } catch (err) {
      console.error('[finmo-downloader] Failed to download file:', {
        docRequestId,
        fileName: file.fileName,
        error: err instanceof Error ? err.message : String(err),
      });
      // Per-file error — continue with remaining files
    }
  }

  console.log('[finmo-downloader] Downloaded files:', {
    applicationId,
    docRequestId,
    total: detail.files.length,
    succeeded: results.length,
  });

  return results;
}

// ---------------------------------------------------------------------------
// Redis Dedup
// ---------------------------------------------------------------------------

/**
 * Check if a document request has already been processed.
 *
 * Falls back to false (treat as not processed) if Redis is unavailable.
 *
 * @param docRequestId - Finmo document request ID
 * @returns true if already processed
 */
export async function isDocRequestProcessed(docRequestId: string): Promise<boolean> {
  let redis: IORedis | null = null;
  try {
    redis = createRedisClient();
    const result = await redis.sismember(PROCESSED_SET_KEY, docRequestId);
    return result === 1;
  } catch (err) {
    console.warn('[finmo-downloader] Redis unavailable for dedup check, treating as not processed:', {
      docRequestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  } finally {
    if (redis) {
      await redis.quit().catch(() => {});
    }
  }
}

/**
 * Mark a document request as processed in Redis.
 *
 * Falls back gracefully if Redis is unavailable (logs warning).
 *
 * @param docRequestId - Finmo document request ID
 */
export async function markDocRequestProcessed(docRequestId: string): Promise<void> {
  let redis: IORedis | null = null;
  try {
    redis = createRedisClient();
    await redis.sadd(PROCESSED_SET_KEY, docRequestId);
  } catch (err) {
    console.warn('[finmo-downloader] Redis unavailable for marking processed:', {
      docRequestId,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (redis) {
      await redis.quit().catch(() => {});
    }
  }
}
