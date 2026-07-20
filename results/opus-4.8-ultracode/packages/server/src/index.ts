/**
 * Server entrypoint. One Node process: express (static client + REST + /health)
 * and a WebSocket server on /ws, plus the central game loop. Single PORT.
 */

import { type Mode } from '@splash/shared';
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { ServerContext } from './context';
import { makeQueries } from './db/queries';
import { openDb } from './db/index';
import { startGameLoop } from './gameLoop';
import { handleMessage } from './handlers';
import { Matchmaker } from './matchmaker';
import { Client } from './net';
import { RoomManager } from './roomManager';

const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIR = process.env.CLIENT_DIR ?? resolve(process.cwd(), 'packages/client/dist');

function main(): void {
  const db = openDb();
  const q = makeQueries(db);
  const ctx = new ServerContext(q);
  ctx.rooms = new RoomManager(ctx);
  ctx.mm = new Matchmaker(ctx);

  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true, tick: ctx.tick, rooms: ctx.rooms.rooms.size }));

  app.get('/api/leaderboard', (req, res) => {
    const mode = (req.query.mode === 'ffa' ? 'ffa' : 'duel') as Mode;
    res.json({ mode, entries: q.leaderboard(mode, 100) });
  });

  app.get('/api/profile/:id', (req, res) => {
    const profile = q.buildProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'not_found' });
    res.json({ ...profile, recent: q.recentMatches(req.params.id, 15) });
  });

  if (existsSync(CLIENT_DIR)) {
    app.use(express.static(CLIENT_DIR));
    app.get('*', (_req, res) => res.sendFile(resolve(CLIENT_DIR, 'index.html')));
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[server] client build not found at ${CLIENT_DIR} (run "npm run build:client")`);
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const client = new Client(ws);
    ctx.clients.add(client);
    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString();
      if (raw.length > 8192) return; // hard cap on message size
      handleMessage(ctx, client, raw);
    });
    const cleanup = () => {
      ctx.clients.delete(client);
      ctx.mm.removeClient(client);
      if (client.room) client.room.handleDisconnect(client);
      if (client.id && ctx.byId.get(client.id) === client) ctx.byId.delete(client.id);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  const loop = startGameLoop(ctx);

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] Splash Critters listening on :${PORT} (ws /ws)`);
  });

  const shutdown = () => {
    loop.stop();
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
