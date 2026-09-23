// Composition of the whole game server on one HTTP server: express (health, REST, built client),
// the WebSocket endpoint at /ws, sessions, rooms, matchmaker and the global 30 Hz ticker.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { WebSocketServer } from 'ws';
import { CONFIG } from '@splash/shared';
import { createApiRouter } from '../api';
import { openDb, type Db } from '../db';
import { acceptConnection } from '../handlers';
import type { ServerContext } from '../handlers/context';
import type { BotFactory } from '../match/types';
import { Matchmaker } from '../matchmaker';
import { RoomManager } from '../rooms';
import { CLOSE_GOING_AWAY } from '../session';
import { Ticker, serverClock } from '../ticker';
import { clientAddress } from './address';
import { Admission, type AdmissionLimits } from './admission';
import { SessionRegistry } from './registry';
import { RoomCodeGuard } from './roomCodes';
import { mountClient } from './static';

export interface GameServerOptions {
  /** DATA_DIR (or ':memory:' for tests). */
  dataDir: string;
  /** Absolute path of the built client (Vite dist). */
  clientDist: string;
  /** DEV_LAG_MS: artificial latency per direction. */
  lagMs: number;
  createBot: BotFactory;
  clock?: () => number;
  /** Per-address socket / new-guest limits (default DEFAULT_ADMISSION_LIMITS). */
  admissionLimits?: AdmissionLimits;
  /** PROXY_HOPS: proxies appending to X-Forwarded-For in front of the server (default 1). */
  proxyHops?: number;
  /** Ranked never groups players from one public address (RANKED_SEPARATE_ADDRESSES=1). */
  rankedSeparateAddresses?: boolean;
}

export interface HealthInfo {
  ok: true;
  /** Seconds since boot. */
  uptime: number;
  rooms: number;
  players: number;
  matches: number;
}

export interface GameServer {
  /** The live database (lets acceptance scripts verify persisted results). */
  readonly db: Db;
  readonly clientMounted: boolean;
  health(): HealthInfo;
  /** Starts listening (port 0 = ephemeral) and the ticker; resolves with the bound port. */
  listen(port: number, host?: string): Promise<number>;
  /** Stops the ticker, closes every socket, the HTTP server and the database. */
  close(): Promise<void>;
}

/** How long sockets get to finish the close handshake on shutdown before being cut. */
const SHUTDOWN_GRACE_MS = 1000;

/** Waits (bounded) for closing sockets to finish their handshake, then cuts the stragglers. */
async function drainSockets(wss: WebSocketServer): Promise<void> {
  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  while (wss.clients.size > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  for (const client of wss.clients) client.terminate();
}

export function createGameServer(opts: GameServerOptions): GameServer {
  const clock = opts.clock ?? serverClock;
  const db = openDb(opts.dataDir);
  const sessions = new SessionRegistry();
  const rooms = new RoomManager({ db, outbox: sessions, createBot: opts.createBot });
  const matchmaker = new Matchmaker({
    outbox: sessions,
    onMatched: (mode, members, now) => rooms.createRankedMatch(mode, members, now),
    separateAddresses: opts.rankedSeparateAddresses === true,
  });
  const admission = new Admission(opts.admissionLimits);
  const context: ServerContext = { db, sessions, rooms, matchmaker, admission, roomCodes: new RoomCodeGuard(), clock };
  const bootedAt = clock();

  const health = (): HealthInfo => ({
    ok: true,
    uptime: Math.round((clock() - bootedAt) / 1000),
    rooms: rooms.roomCount,
    players: sessions.playerCount,
    matches: rooms.matchCount,
  });

  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(health());
  });
  app.use('/api', createApiRouter(db));
  const clientMounted = mountClient(app, opts.clientDist);

  const http: Server = createServer(app);
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: CONFIG.MAX_MESSAGE_BYTES, perMessageDeflate: false });
  wss.on('connection', (socket, req) => {
    acceptConnection(context, socket, { lagMs: opts.lagMs, address: clientAddress(req, opts.proxyHops) });
  });
  wss.on('error', (err) => console.error('[ws] server error', err));

  const ticker = new Ticker({
    clock,
    onTick: (now) => {
      rooms.tick(now);
      matchmaker.tick(now);
      sessions.tick(now);
    },
  });

  let closing: Promise<void> | null = null;

  return {
    db,
    clientMounted,
    health,
    listen(port: number, host?: string): Promise<number> {
      return new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(port, host, () => {
          http.off('error', reject);
          ticker.start();
          resolve((http.address() as AddressInfo).port);
        });
      });
    },
    close(): Promise<void> {
      closing ??= (async () => {
        ticker.stop();
        sessions.closeAll(CLOSE_GOING_AWAY, 'Server shutting down');
        rooms.closeAll();
        await drainSockets(wss);
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        await new Promise<void>((resolve) => {
          if (!http.listening) return resolve();
          http.close(() => resolve());
          http.closeAllConnections();
        });
        db.close();
      })();
      return closing;
    },
  };
}
