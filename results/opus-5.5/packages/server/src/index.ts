// Splash Critters game server entrypoint: reads the environment, boots the game server on one
// port (client + REST + /ws + /health) and shuts down gracefully on SIGINT / SIGTERM.
//
// Env: PORT (3000), DATA_DIR (./data), CLIENT_DIST (default: ../../client/dist relative to this
// file, correct for both `tsx src/index.ts` and the bundled `dist/index.js`), DEV_LAG_MS,
// PROXY_HOPS (1: proxies appending to X-Forwarded-For, e.g. 2 for a CDN in front of the platform),
// RANKED_SEPARATE_ADDRESSES (1: ranked never groups players who share a public address).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBot } from './bots/bot';
import { parseLagMs } from './lag';
import { parseProxyHops } from './net/address';
import { createGameServer } from './net/gameServer';

const DEFAULT_PORT = 3000;
/** A second signal (or a hung shutdown) exits hard after this long. */
const FORCE_EXIT_MS = 5000;

function readPort(raw: string | undefined): number {
  const port = Number(raw ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid PORT: ${raw}`);
  return port;
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const port = readPort(process.env.PORT);
  const dataDir = resolve(process.env.DATA_DIR ?? './data');
  const clientDist = resolve(process.env.CLIENT_DIST ?? resolve(here, '../../client/dist'));
  const lagMs = parseLagMs(process.env.DEV_LAG_MS);
  const proxyHops = parseProxyHops(process.env.PROXY_HOPS);
  const rankedSeparateAddresses = process.env.RANKED_SEPARATE_ADDRESSES === '1';

  const server = createGameServer({ dataDir, clientDist, lagMs, createBot, proxyHops, rankedSeparateAddresses });
  const bound = await server.listen(port);
  const client = server.clientMounted ? clientDist : 'not built (API + WebSocket only)';
  const lag = lagMs > 0 ? `, DEV_LAG_MS=${lagMs}` : '';
  console.log(`[splash] Splash Critters server on http://localhost:${bound} (data ${dataDir}, client ${client}${lag})`);

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) {
      console.log(`[splash] ${signal} again: exiting now`);
      process.exit(1);
    }
    stopping = true;
    console.log(`[splash] ${signal}: shutting down`);
    setTimeout(() => process.exit(1), FORCE_EXIT_MS).unref();
    server.close().then(
      () => process.exit(0),
      (err) => {
        console.error('[splash] shutdown failed', err);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[splash] failed to start', err);
  process.exit(1);
});
