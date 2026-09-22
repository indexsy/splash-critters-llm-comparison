import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { CONFIG, type Mode, type Profile, type ServerMsg } from '@splash/shared';
import { DB } from './db/index.js';
import { Matchmaker } from './matchmaker.js';
import { parseClientMessage, RateLimiter } from './net.js';
import { isClean } from './profanity.js';
import { Rooms } from './rooms.js';
import type { LiveMatch, MatchResult } from './gameLoop.js';

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const db = new DB(path.join(DATA_DIR, 'splash.db'));

interface Session {
  ws: WebSocket;
  playerId: string | null;
  limiter: RateLimiter;
  rtt: number;
  lastEmote: number;
  pingAt: number;
}

const sessions = new Map<WebSocket, Session>();
const byPlayer = new Map<string, Session>();

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendTo(playerId: string, msg: ServerMsg): void {
  const session = byPlayer.get(playerId);
  if (session) send(session.ws, msg);
}

const rooms = new Rooms({
  send: sendTo,
  profile: (id) => db.profile(id),
  rating: (id, mode) => {
    const row = db.rating(id, mode);
    return { rating: row.rating, games: row.games };
  },
  rtt: (id) => byPlayer.get(id)?.rtt ?? 0,
  onMatchStart: (match) => db.insertMatch(match.config.id, match.config.mode, match.config.ranked),
  onMatchEnd: (match, result) => persistEnd(match, result),
});

const matchmaker = new Matchmaker(rooms, sendTo);

function persistEnd(match: LiveMatch, result: MatchResult): void {
  const rows = [];
  for (const row of result.placements) {
    if (!row.human) continue;
    const delta = match.pendingDeltas.find((d) => d.id === row.id);
    const before = delta?.before ?? row.rating;
    const after = delta ? Math.max(0, delta.after) : null;
    if (match.config.ranked && delta) {
      db.applyRating(row.id, result.mode, after ?? before, row.placement === 1);
    }
    const xp = result.xp[row.id] ?? 0;
    if (xp > 0) db.grantXp(row.id, xp);
    if (result.kind === 'tutorial' && row.placement === 1) db.setTutorialDone(row.id);
    rows.push({
      playerId: row.id,
      placement: row.placement,
      soaks: row.soaks,
      roundsWon: row.roundWins,
      ratingBefore: match.config.ranked ? before : null,
      ratingAfter: match.config.ranked ? after : null,
      xp,
    });
    const profile = db.profile(row.id);
    if (profile) sendTo(row.id, { t: 'profile', profile });
  }
  if (rows.length) db.finishMatch(result.matchId, rows);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function welcome(session: Session, token: string, profile: Profile): void {
  session.playerId = profile.id;
  const prev = byPlayer.get(profile.id);
  if (prev && prev !== session) {
    prev.playerId = null;
    prev.ws.close();
  }
  byPlayer.set(profile.id, session);
  send(session.ws, { t: 'welcome', playerId: profile.id, profile, token });
  if (!rooms.reconnect(profile.id)) {
    /* fresh or lobby */
  }
}

function onMessage(session: Session, raw: string): void {
  if (!session.limiter.allow()) return;
  const msg = parseClientMessage(raw);
  if (!msg) return;
  if (msg.t === 'hello') {
    const token = msg.token && /^[0-9a-f-]{16,80}$/i.test(msg.token) ? msg.token : randomUUID();
    const hash = hashToken(token);
    let id = db.playerIdByToken(hash);
    let profile = id ? db.profile(id) : null;
    if (!profile) profile = db.createGuest(hash);
    welcome(session, token, profile);
    return;
  }
  if (msg.t === 'pong') {
    if (msg.serverTime) session.rtt = Math.max(0, Date.now() - msg.serverTime);
    if (session.playerId) rooms.roomOf(session.playerId)?.match?.setPing(session.playerId, session.rtt);
    return;
  }
  if (!session.playerId) {
    send(session.ws, { t: 'error', code: 'hello', msg: 'Say hello first.' });
    return;
  }
  const playerId = session.playerId;
  const profile = db.profile(playerId);
  if (!profile) return;
  switch (msg.t) {
    case 'set_nickname': {
      const nick = msg.nickname.trim();
      if (!/^[A-Za-z0-9_]{3,16}$/.test(nick) || !isClean(nick)) {
        send(session.ws, { t: 'error', code: 'bad_nick', msg: 'Use 3–16 letters, numbers, or underscores.' });
        return;
      }
      const result = db.setNickname(playerId, nick);
      if (!result.ok) {
        send(session.ws, { t: 'error', code: 'bad_nick', msg: result.error });
        return;
      }
      send(session.ws, { t: 'profile', profile: result.profile });
      return;
    }
    case 'select_cosmetic': {
      const next = db.setCosmetic(playerId, msg.animal, msg.hat);
      if (next) send(session.ws, { t: 'profile', profile: next });
      return;
    }
    case 'queue_join': {
      if (!profile.nicknameSet) {
        send(session.ws, { t: 'error', code: 'need_nickname', msg: 'Set a nickname before ranked.' });
        return;
      }
      if (rooms.codeFor(playerId)) rooms.leave(playerId);
      const rating = db.rating(playerId, msg.mode as Mode);
      matchmaker.join(playerId, msg.mode, rating.rating);
      return;
    }
    case 'queue_leave':
      matchmaker.leave(playerId);
      return;
    case 'create_room':
      matchmaker.leave(playerId);
      {
        const created = rooms.create(playerId, msg.opts);
        if ('error' in created) send(session.ws, { t: 'error', code: 'bad_room', msg: created.error });
      }
      return;
    case 'join_room':
      matchmaker.leave(playerId);
      rooms.join(playerId, msg.code);
      return;
    case 'room_list_request':
      send(session.ws, { t: 'room_list', rooms: rooms.list(msg.mode) });
      return;
    case 'leave_room':
      rooms.leave(playerId);
      return;
    case 'set_slot':
      rooms.setSlot(playerId, msg.slot, msg.kind, msg.difficulty ?? 'medium');
      return;
    case 'set_ready':
      rooms.setReady(playerId, msg.ready);
      return;
    case 'start_match':
      rooms.start(playerId);
      return;
    case 'input':
      rooms.input(playerId, msg.seq, msg.dir, msg.balloonPressed);
      return;
    case 'emote':
      if (Date.now() - session.lastEmote < CONFIG.EMOTE_COOLDOWN_MS) return;
      session.lastEmote = Date.now();
      rooms.emote(playerId, msg.id);
      return;
    case 'rematch_vote':
      rooms.vote(playerId, msg.yes);
      return;
    case 'tutorial_begin':
      matchmaker.leave(playerId);
      rooms.createSpecial({
        hostId: playerId,
        mode: 'duel',
        kind: 'tutorial',
        ranked: false,
        hidden: true,
        name: 'Tutorial',
        theme: 'backyard',
        roundsToWin: 1,
        players: [
          { id: playerId, bot: false },
          { id: 'bot', bot: true, difficulty: 'easy' },
        ],
      });
      return;
    case 'tutorial_skip':
      db.setTutorialDone(playerId);
      rooms.leave(playerId);
      {
        const next = db.profile(playerId);
        if (next) send(session.ws, { t: 'profile', profile: next });
      }
      return;
    case 'practice_start':
      matchmaker.leave(playerId);
      rooms.createSpecial({
        hostId: playerId,
        mode: 'ffa',
        kind: 'practice',
        ranked: false,
        hidden: true,
        name: 'Practice',
        theme: 'backyard',
        roundsToWin: 2,
        players: [
          { id: playerId, bot: false },
          { id: 'b1', bot: true, difficulty: 'medium' },
          { id: 'b2', bot: true, difficulty: 'medium' },
          { id: 'b3', bot: true, difficulty: 'easy' },
        ],
      });
      return;
    default:
      return;
  }
}

const app = express();
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'splash-critters' });
});
app.get('/api/leaderboard', (req, res) => {
  const mode = req.query.mode === 'ffa' ? 'ffa' : 'duel';
  res.json({ mode, rows: db.leaderboard(mode) });
});
app.get('/api/profile/:id', (req, res) => {
  const profile = db.publicProfile(req.params.id);
  if (!profile) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(profile);
});

const clientDist = path.join(process.cwd(), 'packages/client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).end();
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const session: Session = { ws, playerId: null, limiter: new RateLimiter(), rtt: 0, lastEmote: 0, pingAt: 0 };
  sessions.set(ws, session);
  ws.on('message', (buf) => onMessage(session, buf.toString()));
  ws.on('close', () => {
    sessions.delete(ws);
    if (session.playerId) {
      if (byPlayer.get(session.playerId) === session) byPlayer.delete(session.playerId);
      matchmaker.leave(session.playerId);
      rooms.disconnect(session.playerId);
    }
  });
});

setInterval(() => rooms.tick(), 1000 / CONFIG.TICK_RATE);
setInterval(() => matchmaker.tick(), CONFIG.MM_TICK_MS);
setInterval(() => {
  const now = Date.now();
  for (const session of sessions.values()) {
    session.pingAt = now;
    send(session.ws, { t: 'ping', serverTime: now, rtt: session.rtt });
  }
}, 2000);

server.listen(PORT, () => {
  console.log(`Splash Critters listening on :${PORT}`);
});
