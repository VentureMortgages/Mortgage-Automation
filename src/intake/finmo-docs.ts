/**
 * Finmo Document Webhook Handler
 *
 * Express route handler for Finmo "Document request status changed" resthook events.
 * When Finmo notifies us that a document has been uploaded/submitted, this handler:
 *
 * 1. Extracts applicationId and documentRequestId from the payload
 *    (supports multiple payload shapes since Finmo format is undocumented)
 * 2. Enqueues an intake job for downstream processing
 * 3. Returns 202 Accepted
 *
 * Deduplication: Uses documentRequestId as the BullMQ jobId to prevent
 * duplicate processing of the same document upload event.
 *
 * Security: Only document metadata is logged (no PII from the payload).
 *
 * Consumers: Express app (POST /webhooks/finmo/documents)
 */

import type { Request, Response } from 'express';
import type { Queue } from 'bullmq';

// ---------------------------------------------------------------------------
// Payload Field Extraction
// ---------------------------------------------------------------------------

/**
 * Extracts a field from the payload, checking both top-level and nested `data` shapes.
 */
function extractField(body: Record<string, unknown>, field: string): string | undefined {
  // Direct field
  if (typeof body[field] === 'string') {
    return body[field] as string;
  }

  // Nested in data object
  if (body.data && typeof body.data === 'object') {
    const data = body.data as Record<string, unknown>;
    if (typeof data[field] === 'string') {
      return data[field] as string;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Route Handler Factory
// ---------------------------------------------------------------------------

/**
 * Creates an Express route handler for Finmo document webhook events.
 *
 * @param queue - BullMQ Queue to enqueue intake jobs onto
 * @returns Express request handler for POST /webhooks/finmo/documents
 */
export function finmoDocumentHandler(queue: Queue): (req: Request, res: Response) => void {
  return (req: Request, res: Response): void => {
    const body = req.body as Record<string, unknown>;

    // Extract required fields from payload
    const documentRequestId = extractField(body, 'documentRequestId');
    if (!documentRequestId) {
      res.status(400).json({ error: 'Missing documentRequestId' });
      return;
    }

    const applicationId = extractField(body, 'applicationId');
    const receivedAt = new Date().toISOString();

    // Enqueue for intake processing (async, but we respond immediately)
    queue
      .add(
        'finmo-doc-upload',
        {
          source: 'finmo',
          applicationId: applicationId ?? null,
          documentRequestId,
          receivedAt,
        },
        {
          jobId: `finmo-doc-${documentRequestId}`, // Dedup key
        },
      )
      .then(() => {
        console.log('[intake] Finmo doc event enqueued:', {
          applicationId: applicationId ?? null,
          documentRequestId,
        });
      })
      .catch((err: unknown) => {
        console.error('[intake] Failed to enqueue Finmo doc event:', {
          documentRequestId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    res.status(202).json({ accepted: true });
  };
}
