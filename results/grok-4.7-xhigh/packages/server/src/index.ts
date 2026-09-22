import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createQueries } from './db/queries.js';
import { openDatabase } from './db/migrate.js';
import { startLoops } from './gameLoop.js';
import { attachSocket } from './net.js';
import { setQueries } from './wire.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.resolve(here, '../../../data');
const port = Number(process.env.PORT || 3000);
const clientDist = path.resolve(here, '../../client/dist');

const db = openDatabase(path.join(dataDir, 'splash.db'));
setQueries(createQueries(db));

const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});
app.get('/api/leaderboard', (req, res) => {
  const mode = req.query.mode === 'ffa' ? 'ffa' : 'duel';
  res.json({ mode, rows: createQueries(db).leaderboard(mode) });
});
app.get('/api/profile/:id', (req, res) => {
  const profile = createQueries(db).profile(req.params.id);
  if (!profile) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json(profile);
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => attachSocket(ws));
startLoops();
server.listen(port, () => {
  console.log(`Splash Critters listening on :${port}`);
});
