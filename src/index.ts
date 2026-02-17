/**
 * Application Entry Point
 *
 * Starts the Express HTTP server and all BullMQ workers in a single process.
 * This is appropriate for the current scale (<10 webhooks/day).
 *
 * Startup:
 * 1. Log environment configuration
 * 2. Start Express server on configured port
 * 3. Start BullMQ workers (webhook, intake, classification)
 * 4. Start Gmail monitor (periodic inbox polling)
 *
 * Shutdown (SIGTERM/SIGINT):
 * 1. Stop accepting new HTTP connections
 * 2. Close all workers (finish current jobs, stop accepting new)
 * 3. Close all queue connections
 * 4. Exit process
 *
 * Usage:
 *   Production: node dist/index.js
 *   Development: npx tsx src/index.ts
 */

import { createApp } from './webhook/server.js';
import { createWorker, closeWorker } from './webhook/worker.js';
import { closeQueue } from './webhook/queue.js';
import { getIntakeQueue, closeIntakeQueue, startGmailMonitor } from './intake/gmail-monitor.js';
import { createIntakeWorker, closeIntakeWorker, closeClassificationQueue } from './intake/intake-worker.js';
import { createClassificationWorker, closeClassificationWorker } from './classification/classification-worker.js';
import { appConfig } from './config.js';

async function main() {
  console.log('[startup] Venture Mortgages Doc Automation starting...');
  console.log('[startup] Environment:', appConfig.isDev ? 'development' : 'production');
  console.log('[startup] Kill switch:', appConfig.killSwitch ? 'ACTIVE' : 'inactive');

  // Start Express server
  const app = createApp();
  const server = app.listen(appConfig.server.port, () => {
    console.log(`[startup] Server listening on port ${appConfig.server.port}`);
  });

  // Start BullMQ workers
  const worker = createWorker();
  const intakeWorker = createIntakeWorker();
  const classificationWorker = createClassificationWorker();

  // Start Gmail monitor (periodic inbox polling)
  const intakeQueue = getIntakeQueue();
  await startGmailMonitor(intakeQueue);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] Received ${signal} — shutting down gracefully...`);

    // Stop accepting new connections
    server.close(() => {
      console.log('[shutdown] HTTP server closed');
    });

    // Close all workers
    await closeWorker();
    console.log('[shutdown] Webhook worker closed');

    await closeIntakeWorker();
    console.log('[shutdown] Intake worker closed');

    await closeClassificationWorker();
    console.log('[shutdown] Classification worker closed');

    // Close all queue connections
    await closeQueue();
    await closeIntakeQueue();
    await closeClassificationQueue();
    console.log('[shutdown] All queues closed');

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[startup] Fatal error:', err.message);
  process.exit(1);
});
