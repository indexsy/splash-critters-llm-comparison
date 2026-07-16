import express from 'express';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CONFIG,
  type C2S,
  type GameMode,
  type Placement,
  type S2C,
} from '@splash/shared';
import {
  openDb,
  createGuest,
  findByToken,
  getProfile,
  setNickname,
  setCosmetic,
  addXp,
  recordMatch,
  getLeaderboard,
  getRecentMatches,
  type Db,
} from './db/queries.js';
import { applyMatchElo } from './elo.js';
import { RoomManager } from './rooms.js';
import { Matchmaker } from './matchmaker.js';
import { createClient, parseMessage, rateLimitOk, send, validateInput, type Client } from './net.js';
import type { MatchCallbacks } from './gameLoop.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

const db: Db = openDb(DATA_DIR);
const rooms = new RoomManager();
const matchmaker = new Matchmaker();
const clients = new Map<WebSocket, Client>();
const playerClients = new Map<string, Client>();

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.rooms.size, players: playerClients.size });
});

app.get('/api/leaderboard', (req, res) => {
  const mode = (req.query.mode === 'ffa' ? 'ffa' : 'duel') as GameMode;
  res.json(getLeaderboard(db, mode));
});

app.get('/api/profile/:id', (req, res) => {
  const profile = getProfile(db, req.params.id);
  if (!profile) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const recent = getRecentMatches(db, req.params.id);
  res.json({ ...profile, recentMatches: recent });
});

// Static client
const clientDist = join(__dirname, '../../client/dist');
const clientDistAlt = join(process.cwd(), 'packages/client/dist');
const staticDir = existsSync(clientDist) ? clientDist : clientDistAlt;
if (existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path === '/health') return next();
    res.sendFile(join(staticDir, 'index.html'));
  });
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastRoom(code: string, msg: S2C, except?: string): void {
  const room = rooms.get(code);
  if (!room) return;
  for (const slot of room.slots) {
    if (slot.kind !== 'human' || !slot.playerId) continue;
    if (except && slot.playerId === except) continue;
    const c = playerClients.get(slot.playerId);
    if (c) send(c, msg);
  }
}

function sendToPlayer(playerId: string, msg: S2C): void {
  const c = playerClients.get(playerId);
  if (c) send(c, msg);
}

function makeMatchCbs(roomCode: string): MatchCallbacks {
  return {
    onSnapshot(snap) {
      broadcastRoom(roomCode, { t: 'snapshot', snap });
    },
    onEvents(events) {
      if (events.length) broadcastRoom(roomCode, { t: 'event', events });
    },
    onRoundStart(data) {
      broadcastRoom(roomCode, { t: 'round_start', ...data });
    },
    onRoundEnd(data) {
      broadcastRoom(roomCode, { t: 'round_end', ...data });
    },
    onMatchEnd(data) {
      const room = rooms.get(roomCode);
      if (!room) return;

      const xpMap: Record<string, number> = {};
      const ratingDeltas: Record<string, number> = {};
      let eloResults: ReturnType<typeof applyMatchElo> = {};

      if (room.match?.ranked) {
        eloResults = applyMatchElo(
          db,
          room.match.mode,
          data.placements.map((p) => ({
            playerId: p.playerId,
            placement: p.placement,
            isBot: p.playerId.startsWith('bot-'),
          })),
        );
        for (const [id, r] of Object.entries(eloResults)) {
          ratingDeltas[id] = r.delta;
        }
      }

      const placements: Placement[] = data.placements.map((p) => {
        let xp = CONFIG.XP_PARTICIPATION;
        xp += CONFIG.XP_PER_PLACEMENT[Math.min(p.placement - 1, 3)] ?? 5;
        xp += p.soaks * CONFIG.XP_PER_SOAK;
        xp += p.castlesWashed * CONFIG.XP_PER_CASTLE;
        if (p.playerId.startsWith('bot-')) {
          xpMap[p.playerId] = 0;
          return {
            ...p,
            ratingBefore: eloResults[p.playerId]?.before,
            ratingAfter: eloResults[p.playerId]?.after,
            xpEarned: 0,
          };
        }
        xpMap[p.playerId] = xp;
        const profile = addXp(db, p.playerId, xp);
        sendToPlayer(p.playerId, { t: 'profile_update', profile });
        return {
          ...p,
          ratingBefore: eloResults[p.playerId]?.before,
          ratingAfter: eloResults[p.playerId]?.after,
          xpEarned: xp,
        };
      });

      if (room.match) {
        recordMatch(
          db,
          room.match.matchId,
          room.match.mode,
          room.match.ranked,
          placements.map((p) => ({
            playerId: p.playerId,
            placement: p.placement,
            soaks: p.soaks,
            roundsWon: p.roundsWon,
            ratingBefore: p.ratingBefore,
            ratingAfter: p.ratingAfter,
            xpEarned: p.xpEarned,
          })),
        );
      }

      broadcastRoom(roomCode, {
        t: 'match_end',
        placements,
        funStats: data.funStats,
        ratingDeltas: room.match?.ranked ? ratingDeltas : undefined,
        xp: xpMap,
        rematchEligible: !room.hidden && !room.match?.ranked,
      });

      // Clear match for rematch
      if (room.match) {
        room.match.stop();
        room.match = null;
      }
      for (const s of room.slots) {
        if (s.kind === 'human') s.ready = false;
      }
    },
    onCountdown(value) {
      broadcastRoom(roomCode, { t: 'countdown', value });
    },
  };
}

function handleMessage(client: Client, msg: C2S): void {
  if (!rateLimitOk(client)) {
    send(client, { t: 'error', code: 'rate_limit', msg: 'Too many messages' });
    return;
  }

  switch (msg.t) {
    case 'hello': {
      let profile = msg.token ? findByToken(db, msg.token) : null;
      let token = msg.token ?? '';
      if (!profile) {
        const guest = createGuest(db);
        profile = guest.profile;
        token = guest.token;
      }
      client.playerId = profile.id;
      client.token = token;
      playerClients.set(profile.id, client);
      // Dev latency flag via query? check env
      if (process.env.ARTIFICIAL_LATENCY) {
        client.artificialLatency = Number(process.env.ARTIFICIAL_LATENCY) || 0;
      }
      send(client, { t: 'welcome', playerId: profile.id, profile, token });
      break;
    }

    case 'set_nickname': {
      if (!client.playerId) return;
      const result = setNickname(db, client.playerId, msg.nickname);
      if (!result.ok) {
        send(client, { t: 'error', code: 'nickname', msg: result.error });
        return;
      }
      send(client, { t: 'profile_update', profile: result.profile });
      break;
    }

    case 'set_cosmetic': {
      if (!client.playerId) return;
      const profile = setCosmetic(db, client.playerId, msg.animal, msg.hat);
      if (profile) send(client, { t: 'profile_update', profile });
      break;
    }

    case 'queue_join': {
      if (!client.playerId) return;
      const profile = getProfile(db, client.playerId);
      if (!profile) return;
      if (profile.nickname.startsWith('Soggy') || profile.nickname.length < 3) {
        // Allow guests but prefer nickname — still allow
      }
      const rating = profile.ratings[msg.mode].rating;
      matchmaker.join({
        playerId: client.playerId,
        profile,
        mode: msg.mode,
        rating,
        joinedAt: Date.now(),
      });
      const st = matchmaker.status(client.playerId);
      if (st) send(client, { t: 'queue_status', ...st });
      break;
    }

    case 'queue_leave': {
      if (!client.playerId) return;
      matchmaker.leave(client.playerId);
      break;
    }

    case 'create_room': {
      if (!client.playerId) return;
      const profile = getProfile(db, client.playerId);
      if (!profile) return;
      // Leave existing
      rooms.leave(client.playerId);
      const room = rooms.create(client.playerId, profile, msg.opts);
      send(client, { t: 'room_created', code: room.code });
      send(client, { t: 'lobby_state', ...rooms.lobbyState(room) });
      break;
    }

    case 'join_room': {
      if (!client.playerId) return;
      const profile = getProfile(db, client.playerId);
      if (!profile) return;
      rooms.leave(client.playerId);
      const result = rooms.join(msg.code, client.playerId, profile);
      if ('error' in result) {
        send(client, { t: 'error', code: 'join', msg: result.error });
        return;
      }
      broadcastRoom(result.code, { t: 'lobby_state', ...rooms.lobbyState(result) });
      break;
    }

    case 'room_list_request': {
      send(client, { t: 'room_list', rooms: rooms.listPublic() });
      break;
    }

    case 'leave_room': {
      if (!client.playerId) return;
      const room = rooms.leave(client.playerId);
      if (room) broadcastRoom(room.code, { t: 'lobby_state', ...rooms.lobbyState(room) });
      break;
    }

    case 'set_slot': {
      if (!client.playerId) return;
      const room = rooms.findByPlayer(client.playerId);
      if (!room) return;
      if (msg.kind === 'human') return;
      rooms.setSlot(room, client.playerId, msg.slot, msg.kind, msg.difficulty);
      broadcastRoom(room.code, { t: 'lobby_state', ...rooms.lobbyState(room) });
      break;
    }

    case 'set_ready': {
      if (!client.playerId) return;
      const room = rooms.findByPlayer(client.playerId);
      if (!room) return;
      rooms.setReady(room, client.playerId, msg.ready);
      broadcastRoom(room.code, { t: 'lobby_state', ...rooms.lobbyState(room) });
      break;
    }

    case 'start_match': {
      if (!client.playerId) return;
      const room = rooms.findByPlayer(client.playerId);
      if (!room || room.hostId !== client.playerId) return;
      // Auto-ready host
      rooms.setReady(room, client.playerId, true);
      // Bot fill
      if (room.opts.botFill) {
        for (let i = 0; i < room.slots.length; i++) {
          if (room.slots[i]!.kind === 'empty') {
            rooms.setSlot(room, client.playerId, i, 'bot', 'medium');
          }
        }
      }
      const config = rooms.startMatch(room, makeMatchCbs(room.code));
      if (!config) {
        send(client, { t: 'error', code: 'start', msg: 'Cannot start — need 2+ ready players' });
        return;
      }
      broadcastRoom(room.code, { t: 'match_start', config });
      break;
    }

    case 'input': {
      if (!client.playerId || !validateInput(msg)) return;
      const room = rooms.findByPlayer(client.playerId);
      if (!room?.match) return;
      room.match.setInput(client.playerId, {
        seq: msg.seq,
        tick: msg.tick,
        dir: msg.dir,
        balloonPressed: msg.balloonPressed,
      });
      break;
    }

    case 'emote': {
      if (!client.playerId) return;
      const room = rooms.findByPlayer(client.playerId);
      if (!room) return;
      broadcastRoom(room.code, { t: 'emote', playerId: client.playerId, id: msg.id });
      break;
    }

    case 'rematch_vote': {
      if (!client.playerId) return;
      const room = rooms.findByPlayer(client.playerId);
      if (!room || room.match) return;
      room.rematchVotes.set(client.playerId, msg.yes);
      const votes: Record<string, boolean> = {};
      for (const [k, v] of room.rematchVotes) votes[k] = v;
      broadcastRoom(room.code, { t: 'rematch_status', votes });
      const humans = room.slots.filter((s) => s.kind === 'human' && s.playerId);
      const yes = humans.filter((h) => room.rematchVotes.get(h.playerId!) === true).length;
      if (yes > humans.length / 2) {
        for (const s of room.slots) if (s.kind === 'human') s.ready = true;
        const config = rooms.startMatch(room, makeMatchCbs(room.code));
        if (config) broadcastRoom(room.code, { t: 'match_start', config });
      }
      break;
    }

    case 'pong': {
      client.lastPong = Date.now();
      break;
    }

    case 'practice': {
      if (!client.playerId) return;
      const profile = getProfile(db, client.playerId);
      if (!profile) return;
      rooms.leave(client.playerId);
      const opts = {
        name: 'Practice',
        size: msg.size,
        public: false,
        theme: 'backyard' as const,
        roundsToWin: 2 as const,
        botFill: true,
        mode: (msg.size === 2 ? 'duel' : 'ffa') as GameMode,
      };
      const room = rooms.create(client.playerId, profile, opts, true);
      for (let i = 1; i < msg.size; i++) {
        rooms.setSlot(room, client.playerId, i, 'bot', msg.difficulty);
      }
      rooms.setReady(room, client.playerId, true);
      const config = rooms.startMatch(room, makeMatchCbs(room.code));
      if (config) send(client, { t: 'match_start', config });
      break;
    }

    case 'tutorial_start': {
      if (!client.playerId) return;
      const profile = getProfile(db, client.playerId);
      if (!profile) return;
      rooms.leave(client.playerId);
      const opts = {
        name: 'Practice',
        size: 2 as const,
        public: false,
        theme: 'backyard' as const,
        roundsToWin: 2 as const,
        botFill: true,
        mode: 'duel' as GameMode,
      };
      const room = rooms.create(client.playerId, profile, opts, true);
      rooms.setSlot(room, client.playerId, 1, 'bot', 'easy');
      rooms.setReady(room, client.playerId, true);
      const config = rooms.startMatch(room, makeMatchCbs(room.code));
      if (config) {
        config.kind = 'tutorial';
        send(client, { t: 'match_start', config });
      }
      break;
    }

    case 'tutorial_complete': {
      if (!client.playerId) return;
      const profile = addXp(db, client.playerId, CONFIG.XP_TUTORIAL);
      send(client, { t: 'profile_update', profile });
      break;
    }
  }
}

wss.on('connection', (ws, req) => {
  const client = createClient(ws);
  // ?latency=150 for dev
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  const lat = url.searchParams.get('latency');
  if (lat) client.artificialLatency = Number(lat) || 0;

  clients.set(ws, client);

  ws.on('message', (data) => {
    const msg = parseMessage(data.toString());
    if (!msg) return;
    handleMessage(client, msg);
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (client.playerId) {
      playerClients.delete(client.playerId);
      matchmaker.leave(client.playerId);
      const room = rooms.findByPlayer(client.playerId);
      if (room) {
        if (room.match) {
          room.match.setConnected(client.playerId, false);
          const slot = room.slots.find((s) => s.playerId === client.playerId);
          if (slot) slot.connected = false;
        } else {
          rooms.leave(client.playerId);
          const still = rooms.get(room.code);
          if (still) broadcastRoom(still.code, { t: 'lobby_state', ...rooms.lobbyState(still) });
        }
      }
    }
  });
});

// Matchmaker tick
setInterval(() => {
  const matches = matchmaker.tick();
  for (const m of matches) {
    const players = m.entries.map((e) => ({
      id: e.playerId,
      profile: e.profile,
      rating: e.rating,
    }));
    // Create room first to get code, then start match with correct callbacks
    const size = m.mode === 'duel' ? 2 : 4;
    const host = players[0]!;
    const room = rooms.create(
      host.id,
      host.profile,
      {
        name: 'Ranked',
        size: size as 2 | 4,
        public: false,
        theme: (['backyard', 'beach', 'pool'] as const)[Math.floor(Math.random() * 3)]!,
        roundsToWin: 3,
        botFill: false,
        mode: m.mode,
      },
      true,
    );
    room.slots = players.map((p) => ({
      kind: 'human' as const,
      playerId: p.id,
      nickname: `${p.profile.nickname}#${p.profile.tag}`,
      animal: p.profile.selectedAnimal,
      hat: p.profile.selectedHat,
      ready: true,
      connected: true,
    }));
    const config = rooms.startMatch(room, makeMatchCbs(room.code));
    if (!config) continue;
    // Patch ranked flags (startMatch sets casual by default for non-hidden check — room.hidden is true)
    config.ranked = true;
    config.kind = 'ranked';
    config.players = config.players.map((cp, i) => ({
      ...cp,
      rating: players[i]?.rating,
      tier: undefined,
    }));
    if (room.match) {
      room.match.ranked = true;
      room.match.kind = 'ranked';
    }
    for (const p of players) {
      sendToPlayer(p.id, { t: 'match_found', config });
      sendToPlayer(p.id, { t: 'match_start', config });
    }
  }
}, CONFIG.MM_TICK_MS);

// Queue status updates
setInterval(() => {
  for (const mode of ['duel', 'ffa'] as GameMode[]) {
    for (const e of matchmaker.queues[mode]) {
      const st = matchmaker.status(e.playerId);
      if (st) sendToPlayer(e.playerId, { t: 'queue_status', ...st });
    }
  }
}, 1000);

// Ping
setInterval(() => {
  const now = Date.now();
  for (const client of clients.values()) {
    send(client, { t: 'ping', time: now });
  }
}, CONFIG.PING_INTERVAL_MS);

// Room GC
setInterval(() => rooms.gc(), 60000);

server.listen(PORT, () => {
  console.log(`Splash Critters server on :${PORT}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`Static: ${staticDir}`);
});
