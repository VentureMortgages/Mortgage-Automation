/**
 * Application Entry Point
 *
 * Starts both the Express HTTP server and the BullMQ worker in a single process.
 * This is appropriate for the current scale (<10 webhooks/day).
 *
 * Startup:
 * 1. Log environment configuration
 * 2. Start Express server on configured port
 * 3. Start BullMQ worker (listens for jobs on finmo-webhooks queue)
 *
 * Shutdown (SIGTERM/SIGINT):
 * 1. Stop accepting new HTTP connections
 * 2. Close worker (finish current job, stop accepting new)
 * 3. Close queue connection
 * 4. Exit process
 *
 * Usage:
 *   Production: node dist/index.js
 *   Development: npx tsx src/index.ts
 */

import { createApp } from './webhook/server.js';
import { createWorker, closeWorker } from './webhook/worker.js';
import { closeQueue } from './webhook/queue.js';
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

  // Start BullMQ worker
  const worker = createWorker();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] Received ${signal} — shutting down gracefully...`);

    // Stop accepting new connections
    server.close(() => {
      console.log('[shutdown] HTTP server closed');
    });

    // Close worker (finish current job, stop accepting new)
    await closeWorker();
    console.log('[shutdown] Worker closed');

    // Close queue connection
    await closeQueue();
    console.log('[shutdown] Queue closed');

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[startup] Fatal error:', err.message);
  process.exit(1);
});
