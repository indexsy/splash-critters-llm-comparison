import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { runMigrations, leaderboard, getPlayerById, getRatings, recentMatches, getPlayerByTokenHash, hashToken, addXp } from './db/db.js';
import { GameServer } from './net.js';
import { tierFor } from '@splash/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

runMigrations();

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, game: 'splash-critters' }));

app.get('/api/leaderboard', (req, res) => {
  const mode = req.query.mode === 'ffa' ? 'ffa' : 'duel';
  const rows = leaderboard(mode, 100).map((r) => ({ ...r, tier: tierFor(r.rating) }));
  res.json({ mode, rows });
});

app.get('/api/profile/:id', (req, res) => {
  const p = getPlayerById(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const ratings = getRatings(p.id);
  const duel = ratings.duel;
  const ffa = ratings.ffa;
  res.json({
    id: p.id,
    nickname: p.nickname,
    tag: p.tag,
    level: p.level,
    xp: p.xp,
    animal: p.selected_animal,
    hat: p.selected_hat,
    ratings: {
      duel: { ...duel, tier: tierFor(duel.rating) },
      ffa: { ...ffa, tier: tierFor(ffa.rating) },
    },
    recent: recentMatches(p.id, 10),
  });
});

app.post('/api/tutorial', (req, res) => {
  const token = String(req.body?.token ?? '');
  if (!token) {
    res.status(400).json({ error: 'token required' });
    return;
  }
  const p = getPlayerByTokenHash(hashToken(token));
  if (!p) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const r = addXp(p.id, 50);
  res.json({ ok: true, ...r });
});

// Serve built client (single-port deploy)
const clientDist = join(__dirname, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(join(clientDist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Splash Critters server. Build the client for full UI.'));
}

const http = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const gs = new GameServer();

http.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => gs.handleWs(ws));
  } else {
    socket.destroy();
  }
});

http.listen(PORT, () => {
  console.log(`Splash Critters listening on :${PORT}`);
});
