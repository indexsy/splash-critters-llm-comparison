/**
 * Process entry point: boot the server from the environment, then wait for a
 * signal telling us to put it down again.
 *
 * All the wiring lives in server.ts so that tests can start the identical
 * server in-process without going through this file.
 */

import { startServer } from './server.js';

/** Sockets that will not close politely must not hold a deploy hostage. */
const SHUTDOWN_GRACE_MS = 5000;

const running = await startServer();

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[splash] ${signal} received, shutting down`);

  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  void running.close().then(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
