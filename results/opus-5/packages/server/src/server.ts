/**
 * One whole server, wired programmatically: database, rooms, matchmaker, socket
 * gateway, game loop and the small REST surface.
 *
 * `index.ts` is nothing but the process entry point that calls this, so a test
 * can boot the very same wiring on an ephemeral port with its own throwaway
 * data directory instead of re-assembling the pieces by hand.
 *
 * The REST surface is deliberately tiny (health, leaderboard, profile) because
 * everything that matters happens over the socket. The built client is served
 * from the same origin and port, so there is nothing to configure and no CORS.
 */

import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { CONFIG, type GameMode, type LeaderboardResponse, type ProfileResponse } from '@splash/shared';
import { openDatabase, type DB } from './db/index.js';
import { ENV } from './env.js';
import { GameLoop } from './gameLoop.js';
import { Matchmaker } from './matchmaker.js';
import { Hub } from './net.js';
import { PlayerService } from './players.js';
import { RoomManager } from './rooms.js';

const LEADERBOARD_LIMIT = 100;
const HISTORY_LIMIT = 20;
/** A socket that will not close politely must not hold a shutdown hostage. */
const SOCKET_CLOSE_GRACE_MS = 500;

export interface ServerOptions {
  /** 0 asks the OS for a free port, which is what tests want. */
  port?: number;
  dataDir?: string;
  clientDir?: string;
  /** Boot lines are noise inside a test runner. */
  silent?: boolean;
}

/** Everything a caller needs to talk to a running server and to stop it again. */
export interface RunningServer {
  port: number;
  url: string;
  wsUrl: string;
  db: DB;
  players: PlayerService;
  rooms: RoomManager;
  matchmaker: Matchmaker;
  hub: Hub;
  loop: GameLoop;
  /** Stops the loop, closes every socket, the listener and the database. */
  close(): Promise<void>;
}

interface Parts {
  http: HttpServer;
  wss: WebSocketServer;
  loop: GameLoop;
  db: DB;
}

function buildApp(players: PlayerService, rooms: RoomManager, hub: Hub, clientDir: string): express.Express {
  const app = express();
  const clientIndex = join(clientDir, 'index.html');

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      rooms: rooms.all().length,
      clients: hub.connectionCount(),
    });
  });

  app.get('/api/leaderboard', (req, res) => {
    const mode = String(req.query.mode ?? '');
    if (mode !== 'duel' && mode !== 'ffa') {
      res.status(400).json({ error: 'mode must be duel or ffa' });
      return;
    }
    const body: LeaderboardResponse = {
      mode: mode as GameMode,
      rows: players.getLeaderboard(mode, LEADERBOARD_LIMIT),
    };
    res.json(body);
  });

  app.get('/api/profile/:id', (req, res) => {
    const profile = players.getProfile(req.params.id);
    if (profile === null) {
      res.status(404).json({ error: 'no such player' });
      return;
    }
    const body: ProfileResponse = {
      profile,
      recentMatches: players.getRecentMatches(req.params.id, HISTORY_LIMIT),
    };
    res.json(body);
  });

  // Static assets first, then the SPA fallback for client-side routes. Checked
  // per request so a client built after the server booted is picked up straight
  // away.
  app.use(express.static(clientDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    if (!existsSync(clientIndex)) {
      res.status(404).json({ error: 'client build missing' });
      return;
    }
    res.sendFile(clientIndex);
  });
  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  return app;
}

async function closeAll(parts: Parts): Promise<void> {
  parts.loop.stop();
  for (const socket of parts.wss.clients) socket.close(1001, 'server shutting down');

  // Politeness has a deadline: anything still holding on gets cut loose.
  const sweep = setTimeout(() => {
    for (const socket of parts.wss.clients) socket.terminate();
  }, SOCKET_CLOSE_GRACE_MS);
  sweep.unref();

  await new Promise<void>((resolve) => parts.wss.close(() => resolve()));
  clearTimeout(sweep);

  // Keep-alive HTTP connections would otherwise hold the listener open.
  parts.http.closeAllConnections();
  await new Promise<void>((resolve) => parts.http.close(() => resolve()));
  if (parts.db.open) parts.db.close();
}

/**
 * Boots a complete server and resolves once it is listening. Options fall back
 * to the process environment, so `startServer()` with no arguments is exactly
 * what production runs.
 */
export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const port = opts.port ?? ENV.port;
  const dataDir = opts.dataDir ?? ENV.dataDir;
  const clientDir = opts.clientDir ?? ENV.clientDir;
  const log = (line: string): void => {
    if (!opts.silent) console.log(line);
  };

  const db = openDatabase(dataDir);
  const players = new PlayerService(db);
  const rooms = new RoomManager(players);

  // The matchmaker needs the gateway to announce a match, and the gateway needs
  // the matchmaker to service queue messages. One late-bound reference breaks
  // the knot without making either of them optional.
  const gateway: { hub: Hub | null } = { hub: null };
  const matchmaker = new Matchmaker(rooms, players, (room, playerIds) => {
    const hub = gateway.hub;
    if (hub === null) return;
    for (const playerId of playerIds) {
      hub.send(playerId, { t: 'match_found', code: room.code, mode: room.mode });
    }
    hub.startMatch(room);
  });

  const hub = new Hub({ players, rooms, matchmaker });
  gateway.hub = hub;
  const loop = new GameLoop({ rooms, players, matchmaker, hub });

  const http = createServer(buildApp(players, rooms, hub, clientDir));
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: CONFIG.MAX_MSG_BYTES });
  wss.on('connection', (socket, request) => {
    hub.handleConnection(socket, request.socket.remoteAddress ?? undefined);
  });

  const parts: Parts = { http, wss, loop, db };

  return new Promise<RunningServer>((resolve, reject) => {
    const onError = (error: Error): void => {
      void closeAll(parts).then(() => reject(error));
    };
    http.once('error', onError);
    http.listen(port, () => {
      http.removeListener('error', onError);
      const address = http.address() as AddressInfo;
      const clientIndex = join(clientDir, 'index.html');

      log(`[splash] listening on http://localhost:${address.port} (${ENV.nodeEnv})`);
      log(`[splash] data ${dataDir}`);
      if (!existsSync(clientIndex)) log(`[splash] no client build at ${clientDir}`);
      if (ENV.artificialLatencyMs > 0) {
        log(`[splash] artificial latency: ${ENV.artificialLatencyMs}ms outbound`);
      }

      loop.start();
      resolve({
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        wsUrl: `ws://127.0.0.1:${address.port}/ws`,
        db,
        players,
        rooms,
        matchmaker,
        hub,
        loop,
        close: () => closeAll(parts),
      });
    });
  });
}
