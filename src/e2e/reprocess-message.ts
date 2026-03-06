/**
 * Quick script to re-enqueue a Gmail message for intake processing.
 * Usage: npx tsx src/e2e/reprocess-message.ts <messageId>
 */
import { Queue } from 'bullmq';
import { createRedisConnection } from '../webhook/queue.js';

const messageId = process.argv[2];
if (!messageId) {
  console.error('Usage: npx tsx src/e2e/reprocess-message.ts <messageId>');
  process.exit(1);
}

const queue = new Queue('doc-intake', {
  connection: createRedisConnection(),
});

await queue.add(
  'process-gmail-message',
  {
    source: 'gmail' as const,
    gmailMessageId: messageId,
    receivedAt: new Date().toISOString(),
  },
  { jobId: `gmail-reprocess-${messageId}` },
);

console.log(`Enqueued reprocess job for message ${messageId}`);
await queue.close();
process.exit(0);
