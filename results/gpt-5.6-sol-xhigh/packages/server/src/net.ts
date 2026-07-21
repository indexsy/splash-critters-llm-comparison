import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import express, { type Application } from "express";
import { WebSocketServer, type WebSocket } from "ws";
import Database from "better-sqlite3";
import {
  CONFIG,
  isClientMessage,
  type Animal,
  type ClientMessage,
  type Hat,
  type Mode,
  type Profile,
  type RoomOptions,
  type ServerMessage,
  type Theme
} from "@splash/shared";
import {
  createGameLoop,
  type GameLoop,
  type ServerContext
} from "./gameLoop.js";
import { RoomStore, lobbyView, type Room } from "./rooms.js";
import { Matchmaker, formRankedRoom, shouldRunMatchmaker } from "./matchmaker.js";
import { runMigrations } from "./db/migrations.js";
import {
  createPlayer,
  getPlayerById,
  getPlayerByToken,
  getLeaderboard,
  getRating,
  rowToProfile,
  setNickname,
  updateProfileCosmetics,
  type LeaderboardEntry,
  type PlayerRow
} from "./db/queries.js";
import { loadRatingForMode } from "./elo.js";

const TOKEN_BYTES = 32;
const NICKNAME_MIN = 3;
const NICKNAME_MAX = 16;
const RATE_WINDOW_MS = 1_000;
const RATE_MAX_MESSAGES = CONFIG.MESSAGE_RATE_LIMIT;
const PING_INTERVAL_MS = 5_000;
const PING_TIMEOUT_MS = 15_000;

const PROFANITY = [
  "fuck", "shit", "cunt", "bitch", "asshole", "bastard", "dick", "pussy",
  "nigger", "nigga", "faggot", "retard", "slut", "whore", "rape", "nazi"
];

const VALID_ANIMALS: ReadonlySet<Animal> = new Set(["frog", "duck", "otter", "penguin", "cat", "raccoon", "turtle", "capybara"]);
const VALID_HATS: ReadonlySet<Hat> = new Set(["none", "bucket", "snorkel", "crown", "bandana", "propeller"]);
const VALID_THEMES: ReadonlySet<string> = new Set(["backyard", "beach", "pool", "random"]);

const ADJECTIVES = ["Splashy", "Bubbly", "Puddle", "Pebble", "Tidal", "Sunny", "Frothy", "Mellow", "Zippy", "Quack"];
const NAMES = ["Frog", "Duck", "Otter", "Penguin", "Turtle", "Capybara", "Critter", "Paddle", "Splash", "Waddle"];

export interface RuntimeOptions {
  dataDir: string;
  port: number;
  clientDist?: string;
  production: boolean;
}

export interface Connection {
  ws: WebSocket;
  playerId?: string;
  lastPongAt: number;
  messageTimes: number[];
  closed: boolean;
  lastEmoteAt: number;
}

export async function startServer(opts: RuntimeOptions): Promise<{ app: Application; server: Server; close: () => void }> {
  await mkdir(opts.dataDir, { recursive: true });
  const dbPath = join(opts.dataDir, "splash.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.set("trust proxy", 1);

  const rooms = new RoomStore();
  const matchmaker = new Matchmaker({
    getRating: (playerId, mode) => loadRatingForMode(db, playerId, mode).rating
  });
  const connections = new Map<string, WebSocket>();
  const playerConnections = new Map<string, WebSocket>();
  const connMeta = new WeakMap<WebSocket, Connection>();

  const send = (ws: WebSocket, message: ServerMessage): void => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(message));
  };

  const sendToPlayer = (playerId: string, message: ServerMessage): void => {
    const ws = playerConnections.get(playerId);
    if (!ws) return;
    send(ws, message);
  };

  const broadcast = (room: Room, message: ServerMessage): void => {
    const seen = new Set<string>();
    for (const slot of room.slots) {
      if (slot.kind !== "human" || !slot.playerId) continue;
      seen.add(slot.playerId);
      sendToPlayer(slot.playerId, message);
    }
    if (room.match) {
      for (const p of room.match.participants) {
        if (p.isBot || seen.has(p.playerId)) continue;
        sendToPlayer(p.playerId, message);
      }
    }
  };

  const ctx: ServerContext = { db, rooms, connections, playerConnections, broadcast, sendToPlayer };
  const gameLoop = createGameLoop(ctx);
  gameLoop.start();

  attachHttpRoutes(app, db, rooms);

  if (opts.production && opts.clientDist) {
    attachStatic(app, opts.clientDist);
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  let lastMatchmakerRun = Date.now();

  const matchmakerTimer = setInterval(() => {
    const now = Date.now();
    if (!shouldRunMatchmaker(now, lastMatchmakerRun)) return;
    lastMatchmakerRun = now;
    const result = matchmaker.tick(now);
    for (const group of result.formedGroups) {
      const room = formRankedRoom(rooms, group.playerIds, group.mode);
      for (const pid of group.playerIds) {
        sendToPlayer(pid, { type: "match_found", roomCode: room.code });
      }
      const profileMap = new Map<string, Profile>();
      for (const pid of group.playerIds) {
        const row = getPlayerById(db, pid);
        if (row) profileMap.set(pid, rowToProfile(row));
      }
      const started = rooms.startMatch(room, profileMap);
      if (started) announceMatchStart(ctx, room, started.mode, started.ranked, started.roundsToWin, started.theme);
    }
    for (const player of playerConnections.keys()) {
      const status = matchmaker.status(player);
      if (status.mode) sendToPlayer(player, { type: "queue_status", eta: status.eta, searchRange: status.searchRange, elapsed: status.elapsed });
    }
  }, 500);

  const gcTimer = setInterval(() => rooms.gc(Date.now()), 60_000);

  const pingTimer = setInterval(() => {
    const now = Date.now();
    for (const ws of connections.values()) {
      const meta = connMeta.get(ws);
      if (!meta) continue;
      if (now - meta.lastPongAt > PING_TIMEOUT_MS) {
        try { ws.close(4008, "ping timeout"); } catch { /* ignore */ }
        continue;
      }
      send(ws, { type: "ping", t: now });
    }
  }, PING_INTERVAL_MS);

  wss.on("connection", (ws) => {
    const meta: Connection = { ws, lastPongAt: Date.now(), messageTimes: [], closed: false, lastEmoteAt: 0 };
    connMeta.set(ws, meta);
    connections.set(cryptoId(ws), ws);

    ws.on("message", (raw) => {
      const now = Date.now();
      meta.messageTimes = meta.messageTimes.filter((t) => now - t < RATE_WINDOW_MS);
      meta.messageTimes.push(now);
      if (meta.messageTimes.length > RATE_MAX_MESSAGES) {
        send(ws, { type: "error", code: "rate_limited", msg: "Too many messages" });
        try { ws.close(4009, "rate limit"); } catch { /* ignore */ }
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: "error", code: "bad_json", msg: "Invalid JSON" });
        return;
      }
      if (!isClientMessage(parsed)) {
        send(ws, { type: "error", code: "bad_message", msg: "Unknown message" });
        return;
      }
      handleMessage(ctx, gameLoop, matchmaker, ws, meta, parsed as ClientMessage).catch((err) => {
        console.error("[ws]", err);
        send(ws, { type: "error", code: "internal", msg: "Internal error" });
      });
    });

    ws.on("ping", () => { meta.lastPongAt = Date.now(); });
    ws.on("pong", () => { meta.lastPongAt = Date.now(); });

    ws.on("close", () => {
      meta.closed = true;
      connections.delete(cryptoId(ws));
      const playerId = meta.playerId;
      if (playerId) {
        matchmaker.dequeue(playerId);
        const stillActive = playerConnections.get(playerId) === ws;
        if (stillActive) playerConnections.delete(playerId);
        const room = rooms.findByPlayer(playerId);
        if (!room) return;
        if (stillActive && room.match) {
          gameLoop.markParticipantDisconnect(room, playerId);
        } else if (stillActive && room.phase === "lobby") {
          rooms.leave(room, playerId);
          broadcastLobby(ctx, room);
        }
      }
    });
  });

  const close = (): void => {
    clearInterval(matchmakerTimer);
    clearInterval(gcTimer);
    clearInterval(pingTimer);
    gameLoop.stop();
    for (const ws of connections.values()) {
      try { ws.close(1001, "server shutdown"); } catch { /* ignore */ }
    }
    server.close();
    db.close();
  };

  return { app, server, close };
}

let connIdCounter = 0;
function cryptoId(ws: WebSocket): string {
  const existing = (ws as unknown as { __id?: string }).__id;
  if (existing) return existing;
  const id = `conn_${connIdCounter++}`;
  (ws as unknown as { __id?: string }).__id = id;
  return id;
}

function attachHttpRoutes(app: Application, db: Database.Database, rooms: RoomStore): void {
  app.get("/health", (_req, res) => {
    res.json({ ok: true, time: Date.now(), players: 0, rooms: rooms.list().length });
  });

  app.get("/api/profile/:id", (req, res) => {
    const id = String(req.params.id ?? "");
    const row = getPlayerById(db, id);
    if (!row) { res.status(404).json({ error: "not_found" }); return; }
    const ratings = (["duel", "ffa"] as const).map((mode) => getRating(db, id, mode));
    const recentMatches = db.prepare(
      `SELECT m.id, m.mode, m.ranked, m.started_at, m.ended_at, mp.placement, mp.soaks, mp.rounds_won, mp.rating_before, mp.rating_after, mp.xp_earned
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
        WHERE mp.player_id = ? ORDER BY m.ended_at DESC LIMIT 10`
    ).all(id);
    const unlocks = db.prepare("SELECT item_id, unlocked_at FROM unlocks WHERE player_id = ? ORDER BY unlocked_at").all(id);
    res.json({ ...rowToProfile(row), ratings, recentMatches, unlocks });
  });

  app.get("/api/rating/:id/:mode", (req, res) => {
    const id = String(req.params.id ?? "");
    const mode = String(req.params.mode ?? "") as Mode;
    if (mode !== "duel" && mode !== "ffa") { res.status(400).json({ error: "bad_mode" }); return; }
    const r = getRating(db, id, mode);
    res.json({ playerId: id, mode, rating: r.rating, games: r.games, wins: r.wins });
  });

  app.get("/api/leaderboard/:mode", (req, res) => {
    const mode = String(req.params.mode ?? "") as Mode;
    if (mode !== "duel" && mode !== "ffa") { res.status(400).json({ error: "bad_mode" }); return; }
    const limit = Math.min(100, Number(req.query.limit ?? 25));
    const entries: LeaderboardEntry[] = getLeaderboard(db, mode, limit);
    res.json({ mode, entries });
  });

  app.get("/api/leaderboard", (req, res) => {
    const mode = String(req.query.mode ?? "duel") as Mode;
    if (mode !== "duel" && mode !== "ffa") { res.status(400).json({ error: "bad_mode" }); return; }
    const entries = getLeaderboard(db, mode, 100).map((entry, index) => ({
      ...entry,
      rank: index + 1,
      name: entry.nickname,
      winrate: entry.games > 0 ? entry.wins / entry.games : 0
    }));
    res.json({ scope: "global", mode, entries });
  });

  app.get("/api/rooms", (_req, res) => {
    res.json({ rooms: rooms.summaries() });
  });
}

function attachStatic(app: Application, clientDist: string): void {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/health" || req.path === "/ws") return next();
    res.sendFile(join(clientDist, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

async function handleMessage(ctx: ServerContext, gameLoop: GameLoop, matchmaker: Matchmaker, ws: WebSocket, meta: Connection, msg: ClientMessage): Promise<void> {
  const send = (m: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  switch (msg.type) {
    case "hello": {
      const tokenHash = msg.token ? sha256(msg.token) : null;
      let row: PlayerRow | undefined = tokenHash ? getPlayerByToken(ctx.db, tokenHash) : undefined;
      if (!row) {
        const id = `p_${randomBytes(8).toString("hex")}`;
        const newToken = randomBytes(TOKEN_BYTES).toString("hex");
        const token = msg.token ?? newToken;
        const hash = sha256(token);
        const { nickname, tag } = generateGuestName();
        row = createPlayer(ctx.db, id, hash, nickname, tag);
        send({ type: "welcome", playerId: row.id, profile: rowToProfile(row), token });
      } else {
        send({ type: "welcome", playerId: row.id, profile: rowToProfile(row), token: msg.token ?? "" });
      }
      meta.playerId = row.id;
      ctx.playerConnections.set(row.id, ws);
      const existing = ctx.rooms.findByPlayer(row.id);
      if (existing && existing.match) {
        gameLoop.reconnected(existing, row.id);
      }
      return;
    }
    case "set_nickname": {
      const pid = meta.playerId;
      if (!pid) return;
      const cleaned = sanitizeNickname(msg.nickname);
      if (!cleaned) { send({ type: "error", code: "bad_nickname", msg: "Nickname must be 3-16 chars" }); return; }
      const tag = generateTag();
      setNickname(ctx.db, pid, cleaned, tag);
      const row = getPlayerById(ctx.db, pid);
      if (row) send({ type: "profile_updated", profile: rowToProfile(row) });
      return;
    }
    case "set_cosmetic": {
      const pid = meta.playerId;
      if (!pid) return;
      const animal = msg.animal as Animal;
      const hat = msg.hat as Hat;
      if (!VALID_ANIMALS.has(animal) || !VALID_HATS.has(hat)) {
        send({ type: "error", code: "bad_cosmetic", msg: "Invalid animal or hat" });
        return;
      }
      const current = getPlayerById(ctx.db, pid);
      if (!current || current.level < CONFIG.UNLOCK_LEVELS.animals[animal] || current.level < CONFIG.UNLOCK_LEVELS.hats[hat]) {
        send({ type: "error", code: "locked_cosmetic", msg: "Reach the required level to use that item" });
        return;
      }
      updateProfileCosmetics(ctx.db, pid, animal, hat);
      const row = getPlayerById(ctx.db, pid);
      if (row) send({ type: "profile_updated", profile: rowToProfile(row) });
      return;
    }
    case "tutorial_complete": {
      const pid = meta.playerId;
      if (!pid) return;
      const row = getPlayerById(ctx.db, pid);
      if (row && row.xp === 0) {
        ctx.db.prepare("UPDATE players SET xp = ? WHERE id = ?").run(CONFIG.XP.tutorial, pid);
        const updated = getPlayerById(ctx.db, pid);
        if (updated) send({ type: "profile_updated", profile: rowToProfile(updated) });
      }
      return;
    }
    case "queue_join": {
      const pid = meta.playerId;
      if (!pid) return;
      const row = getPlayerById(ctx.db, pid);
      if (!row?.has_custom_nickname) {
        send({ type: "error", code: "nickname_required", msg: "Set a nickname before entering ranked" });
        return;
      }
      matchmaker.dequeue(pid);
      matchmaker.enqueue(pid, msg.mode);
      return;
    }
    case "queue_leave": {
      const pid = meta.playerId;
      if (!pid) return;
      matchmaker.dequeue(pid);
      return;
    }
    case "create_room": {
      const pid = meta.playerId;
      if (!pid) return;
      const opts = sanitizeRoomOpts(msg.opts);
      if (!opts) { send({ type: "error", code: "bad_opts", msg: "Invalid room options" }); return; }
      const existing = ctx.rooms.findByPlayer(pid);
      if (existing) ctx.rooms.leave(existing, pid);
      const room = ctx.rooms.create(pid, opts);
      const host = getPlayerById(ctx.db, pid);
      const hostSlot = room.slots.find((slot) => slot.playerId === pid);
      if (host && hostSlot) {
        hostSlot.name = `${host.nickname}#${host.tag}`;
        hostSlot.animal = host.selected_animal as Animal;
      }
      send({ type: "room_created", code: room.code });
      broadcastLobby(ctx, room);
      return;
    }
    case "join_room": {
      const pid = meta.playerId;
      if (!pid) return;
      const room = ctx.rooms.get(msg.code.toUpperCase());
      if (!room) { send({ type: "error", code: "not_found", msg: "Room not found" }); return; }
      const ok = ctx.rooms.join(room, pid);
      if (!ok) { send({ type: "error", code: "room_full", msg: "Room is full or started" }); return; }
      const player = getPlayerById(ctx.db, pid);
      const joinedSlot = room.slots.find((slot) => slot.playerId === pid);
      if (player && joinedSlot) {
        joinedSlot.name = `${player.nickname}#${player.tag}`;
        joinedSlot.animal = player.selected_animal as Animal;
      }
      broadcastLobby(ctx, room);
      return;
    }
    case "room_list_request": {
      send({ type: "room_list", rooms: ctx.rooms.summaries(msg.mode) });
      return;
    }
    case "leave_room": {
      const pid = meta.playerId;
      if (!pid) return;
      const room = ctx.rooms.findByPlayer(pid);
      if (room) {
        ctx.rooms.leave(room, pid);
        broadcastLobby(ctx, room);
      }
      return;
    }
    case "set_slot": {
      const pid = meta.playerId;
      if (!pid) return;
      const room = ctx.rooms.findByPlayer(pid);
      if (!room || room.hostId !== pid) return;
      ctx.rooms.setSlot(room, msg.slot, msg.kind, msg.difficulty ?? "medium");
      broadcastLobby(ctx, room);
      return;
    }
    case "set_ready": {
      const pid = meta.playerId;
      if (!pid) return;
      const room = ctx.rooms.findByPlayer(pid);
      if (!room) return;
      ctx.rooms.setReady(room, pid, msg.ready);
      broadcastLobby(ctx, room);
      return;
    }
    case "start_match": {
      const pid = meta.playerId;
      if (!pid) return;
      const room = ctx.rooms.findByPlayer(pid);
      if (!room || room.hostId !== pid || room.phase !== "lobby") return;
      const profileMap = new Map<string, Profile>();
      for (const slot of room.slots) {
        if (slot.kind === "human" && slot.playerId) {
          const row = getPlayerById(ctx.db, slot.playerId);
          if (row) profileMap.set(slot.playerId, rowToProfile(row));
        }
      }
      const started = ctx.rooms.startMatch(room, profileMap);
      if (!started) { send({ type: "error", code: "cannot_start", msg: "Players not ready" }); return; }
      announceMatchStart(ctx, room, started.mode, started.ranked, started.roundsToWin, started.theme);
      return;
    }
    case "input": {
      const pid = meta.playerId;
      if (!pid) return;
      const room = ctx.rooms.findByPlayer(pid);
      if (!room || !room.match) return;
      gameLoop.pushInput(room, pid, {
        playerId: pid, seq: msg.seq, tick: msg.tick, dir: msg.dir,
        balloonPressed: msg.balloonPressed, ...(msg.revengePressed !== undefined ? { revengePressed: msg.revengePressed } : {})
      });
      return;
    }
    case "emote": {
      const pid = meta.playerId;
      if (!pid) return;
      const room = ctx.rooms.findByPlayer(pid);
      if (!room) return;
      const now = Date.now();
      if (now - meta.lastEmoteAt < CONFIG.EMOTE_COOLDOWN_MS) return;
      meta.lastEmoteAt = now;
      ctx.broadcast(room, { type: "emote", playerId: pid, id: msg.id });
      return;
    }
    case "rematch_vote": {
      const pid = meta.playerId;
      if (!pid) return;
      const room = ctx.rooms.findByPlayer(pid);
      if (!room || room.ranked) return;
      ctx.rooms.voteRematch(room, pid);
      broadcastLobby(ctx, room);
      const humans = room.slots.filter((s) => s.kind === "human" && s.playerId).length;
      const majority = Math.floor(humans / 2) + 1;
      if (humans > 0 && room.rematchVotes.size >= majority) {
        ctx.rooms.resetToLobby(room);
        const profileMap = new Map<string, Profile>();
        for (const slot of room.slots) {
          if (slot.kind !== "human" || !slot.playerId) continue;
          slot.ready = true;
          const row = getPlayerById(ctx.db, slot.playerId);
          if (row) profileMap.set(slot.playerId, rowToProfile(row));
        }
        const started = ctx.rooms.startMatch(room, profileMap);
        if (started) announceMatchStart(ctx, room, started.mode, started.ranked, started.roundsToWin, started.theme);
        else broadcastLobby(ctx, room);
      }
      return;
    }
    case "pong": {
      meta.lastPongAt = Date.now();
      return;
    }
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
    }
  }
}

function announceMatchStart(ctx: ServerContext, room: Room, mode: Mode, ranked: boolean, roundsToWin: number, theme: Theme): void {
  ctx.broadcast(room, {
    type: "match_start",
    config: { mode, ranked, roundsToWin, theme }
  });
}

function broadcastLobby(ctx: ServerContext, room: Room): void {
  const view = lobbyView(room);
  for (const slot of room.slots) {
    if (slot.kind === "human" && slot.playerId) ctx.sendToPlayer(slot.playerId, { type: "lobby_state", lobby: view });
  }
}

function sanitizeNickname(raw: string): string | null {
  const trimmed = raw.trim().slice(0, NICKNAME_MAX);
  if (trimmed.length < NICKNAME_MIN) return null;
  if (containsProfanity(trimmed)) return null;
  return trimmed;
}

function containsProfanity(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z]/g, "");
  for (const word of PROFANITY) {
    if (normalized.includes(word)) return true;
  }
  return false;
}

function sanitizeRoomOpts(opts: RoomOptions): RoomOptions | null {
  if (!opts || typeof opts !== "object") return null;
  const size = opts.size === 2 || opts.size === 4 ? opts.size : 4;
  const visibility = opts.visibility === "public" || opts.visibility === "private" ? opts.visibility : "public";
  const theme = VALID_THEMES.has(opts.theme) ? opts.theme as RoomOptions["theme"] : "random";
  const roundsToWin = [2, 3, 5].includes(opts.roundsToWin) ? opts.roundsToWin : 3;
  const botFill = typeof opts.botFill === "boolean" ? opts.botFill : true;
  const name = typeof opts.name === "string" ? opts.name.slice(0, 32) : "Casual Splash";
  return { name, size, visibility, theme, roundsToWin, botFill };
}

function generateGuestName(): { nickname: string; tag: string } {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const n = NAMES[Math.floor(Math.random() * NAMES.length)]!;
  return { nickname: `${a}${n}`, tag: generateTag() };
}

function generateTag(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
