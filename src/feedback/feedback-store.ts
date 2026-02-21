/**
 * Feedback Store — JSON file persistence for feedback records
 *
 * Simple append-only JSON file storage. Expected volume is <100 records
 * over months, so a JSON file is sufficient (no DB needed).
 *
 * File: data/feedback-records.json
 *
 * Consumers: capture.ts (append), retriever.ts (load)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { feedbackConfig } from './config.js';
import type { FeedbackRecord } from './types.js';

/**
 * Load all feedback records from the JSON file.
 * Returns an empty array if the file doesn't exist yet.
 */
export async function loadFeedbackRecords(): Promise<FeedbackRecord[]> {
  try {
    const raw = await readFile(feedbackConfig.feedbackFilePath, 'utf-8');
    return JSON.parse(raw) as FeedbackRecord[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Append a feedback record to the JSON file.
 * Creates the file and directory if they don't exist.
 */
export async function appendFeedbackRecord(record: FeedbackRecord): Promise<void> {
  const records = await loadFeedbackRecords();
  records.push(record);

  const dir = path.dirname(feedbackConfig.feedbackFilePath);
  await mkdir(dir, { recursive: true });
  await writeFile(feedbackConfig.feedbackFilePath, JSON.stringify(records, null, 2), 'utf-8');
}
