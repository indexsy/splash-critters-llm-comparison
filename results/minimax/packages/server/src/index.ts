import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CONFIG,
  tierName,
  type AnimalId,
  type HatId,
  type Mode,
  type PlayerProfile,
  type ServerMessage,
} from '@splash-critters/shared';
import {
  createGuestPlayer,
  findPlayerByToken,
  getPlayer,
  getRatings,
  leaderboard,
  openDatabase,
  profile,
  recentMatches,
  setCosmetics,
  setNickname,
} from './db/index.js';
import { applyMatchResults } from './elo.js';
import { GameLoop } from './gameLoop.js';
import { Matchmaker } from './matchmaker.js';
import { isValidNickname, parseClientMessage, RateLimiter } from './net.js';
import { isAnimal, isHat } from '@splash-critters/shared';
import { Room, type RoomClient } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

const db = openDatabase(DATA_DIR);
const gameLoop = new GameLoop();
const matchmaker = new Matchmaker();

const rooms = new Map<string, Room>();
const clients = new Map<WebSocket, Client>();
const playerConnections = new Map<string, Client>();
let connectionCounter = 0;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(): string {
  let code = '';
  do {
    code = '';
    for (let i = 0; i < CONFIG.ROOM_CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

interface Client extends RoomClient {
  ws: WebSocket;
  connectionId: string;
  token: string | null;
  dbProfile: PlayerProfile | null;
  room: Room | null;
  latency: number;
  rateLimiter: RateLimiter;
  lastEmoteAt: number;
  lastPingSentAt: number;
  connectedAt: number;
}

function send(client: Client, message: ServerMessage): void {
  if (client.ws.readyState !== 1) return;
  const payload = JSON.stringify(message);
  if (client.latency > 0) {
    setTimeout(() => {
      if (client.ws.readyState === 1) client.ws.send(payload);
    }, client.latency);
  } else {
    client.ws.send(payload);
  }
}

function fail(client: Client, code: string, msg: string): void {
  send(client, { t: 'error', code, msg });
}

function buildProfile(playerId: string): PlayerProfile | null {
  const p = profile(db, playerId);
  if (!p) return null;
  const duel = p.ratings.duel;
  const ffa = p.ratings.ffa;
  return {
    id: p.id,
    nickname: p.nickname,
    tag: p.tag,
    animal: p.animal as AnimalId,
    hat: p.hat as HatId,
    xp: p.xp,
    level: p.level,
    tier: tierName(duel.rating),
    ratingDuel: duel.rating,
    ratingFfa: ffa.rating,
    gamesDuel: duel.games,
    gamesFfa: ffa.games,
    unlocks: p.unlocks,
    hasNickname: true,
  };
}

function refreshClientProfile(client: Client): void {
  if (!client.playerId) return;
  const profile = buildProfile(client.playerId);
  if (!profile) return;
  client.dbProfile = profile;
  client.nickname = profile.nickname;
  client.tag = profile.tag;
  client.animal = profile.animal as AnimalId;
  client.hat = profile.hat as HatId;
  const ratings = getRatings(db, client.playerId);
  client.rating = ratings.duel.rating;
  send(client, { t: 'profile', profile });
}

function createRoom(options: {
  name: string;
  maxPlayers: 2 | 4;
  isPublic: boolean;
  theme: 'backyard' | 'beach' | 'pool' | 'random';
  roundsToWin: number;
  botFill: boolean;
  ranked: boolean;
  mode: Mode;
  code?: string;
}): Room {
  const code = options.code ?? makeCode();
  const room = new Room(
    {
      name: options.name,
      maxPlayers: options.maxPlayers,
      isPublic: options.isPublic,
      theme: options.theme,
      roundsToWin: options.roundsToWin,
      botFill: options.botFill,
      ranked: options.ranked,
      mode: options.mode,
    },
    code,
    {
      onMatchEnd: (room, standings) =>
        applyMatchResults(db, room.matchId, room.mode, room.ranked, standings, room.matchStartedAt),
    },
  );
  rooms.set(code, room);
  gameLoop.add(room);
  return room;
}

function publicRooms(mode?: Mode) {
  const list: ReturnType<Room['info']>[] = [];
  for (const room of rooms.values()) {
    if (!room.isPublic) continue;
    if (room.phase !== 'lobby') continue;
    if (mode && room.mode !== mode) continue;
    list.push(room.info());
  }
  return list.sort((a, b) => b.players - a.players);
}

function broadcastLobby(room: Room): void {
  room.broadcast({ t: 'lobby_state', room: room.lobbyState() });
}

// ---------------------------------------------------------------------------
// message handling
// ---------------------------------------------------------------------------

function handleMessage(client: Client, raw: string): void {
  if (!client.rateLimiter.allow()) {
    fail(client, 'rate_limited', 'Slow down a little.');
    return;
  }
  const msg = parseClientMessage(raw);
  if (!msg) return;

  switch (msg.t) {
    case 'hello': {
      if (client.playerId) return;
      const token = msg.token;
      let player = token ? findPlayerByToken(db, token) : undefined;
      let issuedToken: string | null = null;
      if (!player) {
        const created = createGuestPlayer(db);
        player = created.player;
        issuedToken = created.token;
      }
      client.playerId = player.id;
      client.token = issuedToken ?? msg.token ?? null;
      const previous = playerConnections.get(player.id);
      if (previous && previous !== client) {
        previous.ws.close(4000, 'signed in elsewhere');
      }
      playerConnections.set(player.id, client);
      const profile = buildProfile(player.id);
      client.dbProfile = profile;
      if (profile) {
        client.nickname = profile.nickname;
        client.tag = profile.tag;
        client.animal = profile.animal as AnimalId;
        client.hat = profile.hat as HatId;
        client.rating = profile.ratingDuel;
      }
      send(client, {
        t: 'welcome',
        playerId: player.id,
        profile: profile!,
        token: client.token ?? '',
      });
      return;
    }
    case 'set_nickname': {
      if (!client.playerId) return;
      if (!isValidNickname(msg.nickname)) {
        fail(client, 'bad_nickname', 'Pick 3-16 letters, numbers or ! ? * - _');
        return;
      }
      setNickname(db, client.playerId, msg.nickname.trim());
      refreshClientProfile(client);
      if (client.room) broadcastLobby(client.room);
      return;
    }
    case 'create_room': {
      if (!client.playerId) return;
      if (client.room) leaveRoom(client);
      const maxPlayers = msg.opts.maxPlayers;
      const mode: Mode = maxPlayers === 4 ? 'ffa' : 'duel';
      const room = createRoom({
        name: msg.opts.name,
        maxPlayers,
        isPublic: msg.opts.isPublic,
        theme: msg.opts.theme,
        roundsToWin: msg.opts.roundsToWin,
        botFill: msg.opts.botFill,
        ranked: false,
        mode,
      });
      const result = room.addHuman(client);
      if (!result.ok) {
        fail(client, 'room_full', result.msg ?? 'Could not join that room.');
        return;
      }
      client.room = room;
      send(client, { t: 'room_created', room: room.lobbyState() });
      broadcastLobby(room);
      if (msg.opts.autoStart) {
        room.fillWithBots();
        room.startMatch();
      }
      return;
    }
    case 'join_room': {
      if (!client.playerId) return;
      const room = rooms.get(msg.code);
      if (!room) {
        fail(client, 'no_room', 'No room with that code.');
        return;
      }
      if (room.phase !== 'lobby') {
        fail(client, 'room_started', 'That match already started.');
        return;
      }
      if (client.room) leaveRoom(client);
      const result = room.addHuman(client);
      if (!result.ok) {
        fail(client, 'room_full', result.msg ?? 'Could not join that room.');
        return;
      }
      client.room = room;
      send(client, { t: 'room_created', room: room.lobbyState() });
      broadcastLobby(room);
      return;
    }
    case 'room_list_request': {
      send(client, { t: 'room_list', rooms: publicRooms(msg.mode) });
      return;
    }
    case 'leave_room': {
      leaveRoom(client);
      return;
    }
    case 'set_slot': {
      const room = client.room;
      if (!room) return;
      const host = room.host;
      if (!host || host.playerId !== client.playerId) {
        fail(client, 'not_host', 'Only the host can change the slots.');
        return;
      }
      if (room.phase !== 'lobby') return;
      if (!room.setSlot(msg.slot, msg.kind, msg.difficulty)) return;
      broadcastLobby(room);
      return;
    }
    case 'set_cosmetics': {
      if (!client.playerId) return;
      if (!isAnimal(msg.animal) || !isHat(msg.hat)) return;
      setCosmetics(db, client.playerId, msg.animal, msg.hat);
      refreshClientProfile(client);
      return;
    }
    case 'set_ready': {
      const room = client.room;
      if (!room) return;
      const slot = room.slots.find((s) => s.playerId === client.playerId);
      if (slot) slot.ready = msg.ready;
      broadcastLobby(room);
      return;
    }
    case 'start_match': {
      const room = client.room;
      if (!room) return;
      const host = room.host;
      if (!host || host.playerId !== client.playerId) {
        fail(client, 'not_host', 'Only the host can start the match.');
        return;
      }
      if (!room.startMatch()) {
        fail(client, 'cannot_start', 'Fill every slot or add bots first.');
      }
      return;
    }
    case 'input': {
      const room = client.room;
      if (!room) return;
      const slot = room.slots.find((s) => s.playerId === client.playerId);
      if (!slot) return;
      room.queueInput(slot, msg);
      return;
    }
    case 'emote': {
      const now = Date.now();
      if (now - client.lastEmoteAt < 700) return;
      client.lastEmoteAt = now;
      const room = client.room;
      if (!room) return;
      const slot = room.slots.find((s) => s.playerId === client.playerId);
      if (!slot) return;
      room.emitEmote(slot.index, msg.id);
      return;
    }
    case 'queue_join': {
      if (!client.playerId) return;
      if (client.room) leaveRoom(client);
      const ratings = getRatings(db, client.playerId);
      const rating = msg.mode === 'duel' ? ratings.duel.rating : ratings.ffa.rating;
      matchmaker.enqueue({
        playerId: client.playerId,
        rating,
        joinedAt: Date.now(),
        mode: msg.mode,
        notify: (status) => {
          send(client, {
            t: 'queue_status',
            mode: msg.mode,
            eta: status.eta,
            searchRange: status.searchRange,
            queued: status.queued,
            elapsedMs: status.elapsedMs,
          });
        },
        onMatched: (group, mode) => {
          for (const member of group) matchmaker.dequeue(member.playerId);
          const room = createRoom({
            name: mode === 'duel' ? 'Ranked duel' : 'Ranked free-for-all',
            maxPlayers: mode === 'duel' ? 2 : 4,
            isPublic: false,
            theme: 'random',
            roundsToWin: CONFIG.DEFAULT_ROUNDS_TO_WIN,
            botFill: false,
            ranked: true,
            mode,
            code: `R${makeCode().slice(0, 5)}`,
          });
          for (const member of group) {
            const memberClient = playerConnections.get(member.playerId);
            if (!memberClient) continue;
            room.addHuman(memberClient);
            memberClient.room = room;
            send(memberClient, { t: 'match_found', roomId: room.id, code: room.code, mode });
            send(memberClient, { t: 'room_created', room: room.lobbyState() });
          }
          broadcastLobby(room);
          room.startMatch();
        },
      });
      return;
    }
    case 'queue_leave': {
      if (!client.playerId) return;
      matchmaker.dequeue(client.playerId);
      return;
    }
    case 'rematch_vote': {
      const room = client.room;
      if (!room || !client.playerId) return;
      if (room.requestRematch(client.playerId)) {
        room.resetForRematch();
        broadcastLobby(room);
      }
      return;
    }
    case 'pong': {
      client.ping = Math.max(0, Date.now() - msg.ts);
      return;
    }
  }
}

function leaveRoom(client: Client): void {
  const room = client.room;
  if (!room) return;
  if (room.phase === 'lobby') {
    room.removeFromLobby(client.playerId ?? '');
  } else {
    room.removeHuman(client.playerId ?? '');
  }
  client.room = null;
  broadcastLobby(room);
  send(client, { t: 'lobby_state', room: room.lobbyState() });
}

// ---------------------------------------------------------------------------
// http + websocket
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    rooms: rooms.size,
    connections: clients.size,
    tickRate: CONFIG.TICK_RATE,
  });
});

app.get('/api/leaderboard', (req, res) => {
  const mode = req.query.mode === 'ffa' ? 'ffa' : 'duel';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 100) || 100));
  res.json({ mode, entries: leaderboard(db, mode, limit) });
});

app.get('/api/profile/:id', (req, res) => {
  const p = profile(db, req.params.id);
  if (!p) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const duel = p.ratings.duel;
  const ffa = p.ratings.ffa;
  res.json({
    id: p.id,
    nickname: p.nickname,
    tag: p.tag,
    animal: p.animal as AnimalId,
    hat: p.hat as HatId,
    xp: p.xp,
    level: p.level,
    tier: tierName(duel.rating),
    ratings: {
      duel: { ...duel, tier: tierName(duel.rating) },
      ffa: { ...ffa, tier: tierName(ffa.rating) },
    },
    unlocks: p.unlocks,
    recentMatches: recentMatches(db, p.id, 10),
  });
});

app.get('/api/rooms', (req, res) => {
  const mode = req.query.mode === 'ffa' ? 'ffa' : req.query.mode === 'duel' ? 'duel' : undefined;
  res.json({ rooms: publicRooms(mode) });
});

app.get('/api/player/:id/cosmetics', (req, res) => {
  const player = getPlayer(db, req.params.id);
  if (!player) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  setCosmetics(db, player.id, player.selected_animal, player.selected_hat);
  res.json({ ok: true });
});

app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));

app.get('*', (_req, res) => {
  res.sendFile(path.join(CLIENT_DIST, 'index.html'), (err) => {
    if (err) {
      res
        .status(503)
        .type('text/plain')
        .send('Client bundle is not built yet. Run: npm run build');
    }
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket as never, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const latency = Math.min(1000, Math.max(0, Number(url.searchParams.get('latency') ?? 0) || 0));
  connectionCounter += 1;
  const client: Client = {
    ws,
    connectionId: `c${connectionCounter}`,
    token: null,
    dbProfile: null,
    room: null,
    playerId: '',
    latency,
    rateLimiter: new RateLimiter(),
    lastEmoteAt: 0,
    lastPingSentAt: 0,
    connectedAt: Date.now(),
    nickname: 'guest',
    tag: '0000',
    animal: 'frog',
    hat: 'none',
    rating: CONFIG.ELO.start,
    ping: 0,
    send(message: ServerMessage) {
      send(client, message);
    },
  };
  clients.set(ws, client);

  ws.on('message', (data) => {
    try {
      handleMessage(client, data.toString());
    } catch (err) {
      console.error('[ws] handler failed', err);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (client.playerId) {
      const current = playerConnections.get(client.playerId);
      if (current === client) playerConnections.delete(client.playerId);
    }
    if (client.room) {
      const room = client.room;
      room.removeHuman(client.playerId ?? '');
      client.room = null;
      broadcastLobby(room);
    }
  });

  ws.on('error', () => {
    /* the close handler does the cleanup */
  });
});

// ping/pong clock
setInterval(() => {
  const now = Date.now();
  for (const client of clients.values()) {
    if (now - client.lastPingSentAt < CONFIG.PING_INTERVAL_MS) continue;
    client.lastPingSentAt = now;
    send(client, { t: 'ping', ts: now });
  }
}, 1000).unref?.();

gameLoop.start();
matchmaker.start();

server.listen(PORT, () => {
  console.log(`[splash-critters] listening on http://localhost:${PORT}`);
  console.log(`[splash-critters] data dir: ${DATA_DIR}`);
  console.log(`[splash-critters] client bundle: ${CLIENT_DIST}`);
});

function shutdown(): void {
  console.log('[splash-critters] shutting down');
  gameLoop.stop();
  matchmaker.stop();
  for (const client of clients.values()) client.ws.close(1001, 'server shutting down');
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref?.();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
