import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { CONFIG, GameMode } from '@splash/shared';
import * as db from './db/index.js';
import { startGameLoop } from './gameLoop.js';
import { Matchmaker } from './matchmaker.js';
import { setupNet } from './net.js';
import { RoomManager } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

db.runMigrations();

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('/api/leaderboard', (req, res) => {
  const mode = req.query.mode === 'ffa' ? 'ffa' : 'duel';
  res.json({ mode, entries: db.leaderboard(mode as GameMode, 100) });
});

app.get('/api/profile/:id', (req, res) => {
  const profile = db.profileFor(req.params.id);
  if (!profile) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(profile);
});

const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('client not built');
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const latencyMs = Math.max(0, parseInt(process.env.ARTIFICIAL_LATENCY_MS ?? '0', 10) || 0);
const rooms = new RoomManager(latencyMs);
const matchmaker = new Matchmaker(rooms);

setupNet(wss, rooms, matchmaker);
startGameLoop(rooms);
setInterval(() => matchmaker.tick(), CONFIG.MATCHMAKING.TICK_MS);

const PORT = parseInt(process.env.PORT ?? '3000', 10);
server.listen(PORT, () => {
  console.log(`splash-critters server listening on :${PORT} (latency sim: ${latencyMs}ms)`);
});
