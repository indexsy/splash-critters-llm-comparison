// net.ts — WebSocket server: validation, rate limiting, message dispatch (spec §8).
// Owns the global Rooms registry and bridges accounts, rooms, matchmaker, matches.
//
// Each WebSocket is a "connection" identified by connectionId. A connection maps
// to at most one player (via hello) and may be seated in at most one room/match.

import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "node:http";
import {
  RATE_LIMIT_MSGS_PER_SEC,
  ROOM_IDLE_TTL_MS as ROOM_TTL_MS,
  type Animal,
  type GameMode,
  type Hat,
  type ServerMsg,
  type ClientMsg,
  type Snapshot,
  type Theme,
  type RoomSummary,
  type SlotView,
} from "@splash/shared";
import { Room, MatchRun, newRoomCode, toSnapshot, type RoomOpts, type RoomSlot } from "./rooms.js";
import {
  addXp,
  applyRating,
  createPlayerForToken,
  findPlayerByToken,
  getRating,
  getPlayer,
  newToken,
  profile as getProfile,
  recordMatchEnd,
  recordMatchPlayer,
  recordMatchStart,
  setCosmetics,
  setNickname,
} from "./db/queries.js";
import { newId } from "./db/queries.js";
import { Matchmaker, type QueuedPlayer } from "./matchmaker.js";
import { eloDuel, eloFFA, Rng, xpForLevel, XP, tierFor, ANIMALS, HATS, UNLOCKS, MODES } from "@splash/shared";

export interface Connection {
  id: string;
  ws: WebSocket;
  playerId?: string;
  roomCode?: string;
  queued?: GameMode;
  lastMsgs: number[]; // timestamps for rate limiting
}

// Global registries (module-level singletons)
export const Rooms = new Map<string, Room>();
export const Connections = new Map<string, Connection>();

export function attachWs(wss: WebSocketServer) {
  wss.on("connection", (ws, req) => onConnection(ws, req));
}

function onConnection(ws: WebSocket, _req: IncomingMessage) {
  const conn: Connection = { id: newId(), ws, lastMsgs: [] };
  Connections.set(conn.id, conn);
  ws.on("message", (data) => onMessage(conn, data.toString()));
  ws.on("close", () => onClose(conn));
  ws.on("error", () => onClose(conn));
}

function send(conn: Connection, msg: ServerMsg) {
  if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: ServerMsg) {
  for (const slot of room.slots) {
    if (slot.kind === "human" && slot.connectionId) {
      const c = Connections.get(slot.connectionId);
      if (c) send(c, msg);
    }
  }
}

function lobbyState(room: Room, yourSlot: number): ServerMsg {
  const slots: SlotView[] = room.slots.map((s, i) => ({
    slot: i,
    kind: s.kind,
    difficulty: s.difficulty,
    playerId: s.playerId,
    nickname: s.nickname,
    animal: s.animal,
    ready: s.ready,
    isLocal: i === yourSlot,
  }));
  return {
    t: "lobby_state",
    code: room.code, name: room.opts.name, size: room.opts.size, theme: room.opts.theme,
    roundsToWin: room.opts.roundsToWin, slots, hostSlot: room.hostSlot, yourSlot,
  };
}

function roomSummary(room: Room): RoomSummary {
  return {
    code: room.code,
    name: room.opts.name,
    size: room.opts.size,
    visibility: room.opts.visibility,
    theme: room.opts.theme,
    players: room.humanCount,
    max: room.opts.size,
    host: room.slots[room.hostSlot]?.nickname ?? "?",
  };
}

function findMyRoom(conn: Connection): Room | undefined {
  return conn.roomCode ? Rooms.get(conn.roomCode) : undefined;
}
function findMySlot(room: Room, conn: Connection): number {
  return room.slots.findIndex((s) => s.kind === "human" && s.connectionId === conn.id);
}

// ---------- message dispatch ----------

function onMessage(conn: Connection, raw: string) {
  // rate limit: 60 msgs/sec
  const now = Date.now();
  conn.lastMsgs = conn.lastMsgs.filter((t) => now - t < 1000);
  if (conn.lastMsgs.length >= RATE_LIMIT_MSGS_PER_SEC) return;
  conn.lastMsgs.push(now);

  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return send(conn, { t: "error", code: "bad_json", msg: "malformed JSON" });
  }

  switch (msg.t) {
    case "hello": return handleHello(conn, msg.token);
    case "set_nickname": return handleSetNickname(conn, msg.nickname);
    case "create_room": return handleCreateRoom(conn, msg);
    case "join_room": return handleJoinRoom(conn, msg.code);
    case "room_list_request": return handleRoomList(conn);
    case "leave_room": return handleLeaveRoom(conn);
    case "set_slot": return handleSetSlot(conn, msg.slot, msg.kind, msg.difficulty);
    case "set_ready": return handleSetReady(conn, msg.ready);
    case "start_match": return handleStartMatch(conn);
    case "input": return handleInput(conn, msg.seq, msg.tick, msg.dir, msg.balloonPressed);
    case "queue_join": return handleQueueJoin(conn, msg.mode);
    case "queue_leave": return handleQueueLeave(conn);
    case "rematch_vote": return handleRematchVote(conn, msg.vote);
    case "emote": return; // rate-limited broadcast stub
    case "pong": return;
  }
}

// ---------- handlers ----------

function handleHello(conn: Connection, token: string | undefined) {
  let t: string = token ?? "";
  let player = t ? findPlayerByToken(t) : undefined;
  if (!player) {
    t = newToken();
    player = createPlayerForToken(t);
  }
  conn.playerId = player.id;
  send(conn, {
    t: "welcome",
    playerId: player.id,
    token: t,
    profile: {
      id: player.id,
      nickname: player.nickname ?? "Player",
      tag: player.tag ?? "0000",
      xp: player.xp,
      level: player.level,
      selectedAnimal: player.selected_animal as Animal,
      selectedHat: player.selected_hat as Hat,
    },
  });
}

function handleSetNickname(conn: Connection, nickname: string) {
  if (!conn.playerId) return;
  const { nickname: clean, tag } = setNickname(conn.playerId, nickname);
  const p = getPlayer(conn.playerId)!;
  send(conn, {
    t: "welcome", playerId: p.id, token: "",
    profile: {
      id: p.id, nickname: clean, tag, xp: p.xp, level: p.level,
      selectedAnimal: p.selected_animal as Animal, selectedHat: p.selected_hat as Hat,
    },
  });
}

function handleCreateRoom(conn: Connection, opts: ClientMsg & { t: "create_room" }) {
  if (!conn.playerId) return;
  const player = getPlayer(conn.playerId)!;
  const code = newRoomCode();
  const roomOpts: RoomOpts = {
    name: opts.name || "Splash Room",
    size: opts.size,
    visibility: opts.visibility,
    theme: opts.theme,
    roundsToWin: opts.roundsToWin,
    botFill: opts.botFill,
  };
  const room = new Room(code, roomOpts, player.id, player.nickname ?? "Host", player.selected_animal as Animal, player.selected_hat as Hat);
  room.slots[0].connectionId = conn.id;
  Rooms.set(code, room);
  conn.roomCode = code;
  send(conn, { t: "room_created", code });
  send(conn, lobbyState(room, 0));
}

function handleJoinRoom(conn: Connection, code: string) {
  if (!conn.playerId) return;
  const room = Rooms.get(code.toUpperCase());
  if (!room) return send(conn, { t: "error", code: "no_room", msg: "room not found" });
  const slot = room.slots.findIndex((s) => s.kind === "open");
  if (slot < 0) return send(conn, { t: "error", code: "room_full", msg: "room is full" });
  const player = getPlayer(conn.playerId)!;
  room.slots[slot] = {
    kind: "human",
    playerId: player.id,
    nickname: player.nickname ?? "Player",
    animal: player.selected_animal as Animal,
    hat: player.selected_hat as Hat,
    ready: false,
    connectionId: conn.id,
  };
  room.touch();
  conn.roomCode = room.code;
  broadcast(room, lobbyState(room, slot));
}

function handleRoomList(conn: Connection) {
  const rooms: RoomSummary[] = [];
  for (const r of Rooms.values()) {
    if (r.opts.visibility !== "public") continue;
    if (r.match) continue; // skip in-progress
    rooms.push(roomSummary(r));
  }
  send(conn, { t: "room_list", rooms });
}

function handleLeaveRoom(conn: Connection) {
  const room = findMyRoom(conn);
  if (!room) return;
  const slot = findMySlot(room, conn);
  if (slot >= 0) {
    room.slots[slot] = { kind: "open" };
    room.touch();
    broadcast(room, lobbyState(room, slot));
  }
  conn.roomCode = undefined;
}

function handleSetSlot(conn: Connection, slot: number, kind: RoomSlot["kind"], difficulty?: RoomSlot["difficulty"]) {
  const room = findMyRoom(conn);
  if (!room || findMySlot(room, conn) !== room.hostSlot) return; // host only
  if (slot < 0 || slot >= room.slots.length) return;
  if (kind === "human") return; // can't manually set humans
  room.slots[slot] = { kind, difficulty };
  room.touch();
  broadcast(room, lobbyState(room, findMySlot(room, conn)));
}

function handleSetReady(conn: Connection, ready: boolean) {
  const room = findMyRoom(conn);
  if (!room) return;
  const slot = findMySlot(room, conn);
  if (slot < 0) return;
  room.slots[slot].ready = ready;
  room.touch();
  broadcast(room, lobbyState(room, slot));
}

function handleStartMatch(conn: Connection) {
  const room = findMyRoom(conn);
  if (!room || findMySlot(room, conn) !== room.hostSlot) return;
  if (room.match) return;
  const mode: GameMode = room.opts.size === 2 ? "duel" : "ffa";
  // bot-fill empties if requested
  if (room.opts.botFill) {
    for (let i = 0; i < room.slots.length; i++) {
      if (room.slots[i].kind === "open") room.slots[i] = { kind: "bot", difficulty: "medium" };
    }
  }
  if (room.slots.some((s) => s.kind === "open")) {
    return send(conn, { t: "error", code: "open_slots", msg: "fill or close all slots first" });
  }
  startRoomMatch(room, mode, false);
}

export function startRoomMatch(room: Room, mode: GameMode, ranked: boolean) {
  const seed = Rng.hashStr(room.code + ":" + Date.now());
  const match = new MatchRun({
    mode,
    theme: room.opts.theme,
    roundsToWin: room.opts.roundsToWin,
    ranked,
    seed,
    slots: room.slots.map((s) => ({ ...s })),
  });
  room.match = match;
  room.rematchVotes.clear();

  // wire outputs
  match.onSnapshot = (snap) => broadcast(room, { t: "snapshot", snap });
  match.onRoundEnd = (roundNo, winnerSlot, scores) =>
    broadcast(room, { t: "round_end", roundNo, winnerSlot, scores });
  match.onMatchEnd = () => onMatchEnd(room, match);

  // tell players
  for (let slot = 0; slot < room.slots.length; slot++) {
    const s = room.slots[slot];
    if (s.kind !== "human" || !s.connectionId) continue;
    const c = Connections.get(s.connectionId);
    if (!c) continue;
    const ratingView = ranked ? getRating(s.playerId!, mode).rating : undefined;
    send(c, {
      t: "match_start",
      mode,
      roundsToWin: room.opts.roundsToWin,
      theme: room.opts.theme,
      yourSlot: slot,
      players: room.slots.map((sl, i) => ({
        slot: i,
        nickname: sl.nickname ?? (sl.kind === "bot" ? `Bot(${sl.difficulty})` : "?"),
        animal: (sl.animal ?? "frog") as Animal,
        rating: ranked && sl.kind === "human" ? getRating(sl.playerId!, mode).rating : undefined,
      })),
    });
  }
}

function onMatchEnd(room: Room, match: MatchRun) {
  recordMatchEnd(match.mode + ":" + room.code); // best-effort
  // build placements payload; persist ratings/xp if ranked
  const placementsPayload: { slot: number; nickname: string; ratingBefore: number; ratingAfter: number; xp: number; soaks: number; roundsWon: number }[] = [];
  for (const pl of match.placements) {
    const slot = room.slots[pl.slot];
    const nickname = slot?.nickname ?? "?";
    const isBot = slot?.kind === "bot" || match.slotPlayers[pl.slot]?.startsWith("bot:");
    let ratingBefore = 0;
    let ratingAfter = 0;
    let xp = 0;
    if (!isBot && slot?.playerId) {
      xp = XP.perParticipation + (XP.perPlacement[pl.placement - 1] ?? 0) + pl.soaks * XP.perSoak;
      if (match.ranked) {
        ratingBefore = getRating(slot.playerId, match.mode).rating;
      }
      addXp(slot.playerId, xp);
    }
    placementsPayload.push({ slot: pl.slot, nickname, ratingBefore, ratingAfter, xp, soaks: pl.soaks, roundsWon: pl.roundsWon });
  }

  // ranked rating math
  if (match.ranked) {
    const humanPlacements = match.placements.filter((p) => room.slots[p.slot]?.kind === "human");
    if (humanPlacements.length >= 2) {
      const ratings = humanPlacements.map((p) => getRating(room.slots[p.slot]!.playerId!, match.mode).rating);
      const games = humanPlacements.map((p) => getRating(room.slots[p.slot]!.playerId!, match.mode).games);
      const order = humanPlacements.map((p) => p.placement);
      const deltas =
        match.mode === "duel"
          ? humanPlacements.length === 2
            ? (() => {
                const r = eloDuel(ratings[0], ratings[1], games[0], order[0] < order[1] ? 1 : 0);
                return [r.deltaA, r.deltaB];
              })()
            : [0, 0]
          : eloFFA(ratings, games, order);
      humanPlacements.forEach((p, i) => {
        const slot = room.slots[p.slot]!;
        const after = ratings[i] + deltas[i];
        const won = p.placement === 1;
        applyRating(slot.playerId!, match.mode, after, won);
        const pp = placementsPayload.find((x) => x.slot === p.slot)!;
        pp.ratingBefore = ratings[i];
        pp.ratingAfter = after;
      });
    }
  }

  broadcast(room, { t: "match_end", placements: placementsPayload });
  room.match = null;
}

function handleInput(conn: Connection, seq: number, tick: number, dir: number, balloonPressed: boolean) {
  const room = findMyRoom(conn);
  if (!room || !room.match) return;
  const slot = findMySlot(room, conn);
  if (slot < 0) return;
  // validate
  if (dir < -1 || dir > 3) return;
  room.match.submitInput(slot, { seq, tick, dir: dir as -1 | 0 | 1 | 2 | 3, balloonPressed: !!balloonPressed });
}

function handleQueueJoin(conn: Connection, mode: GameMode) {
  if (!conn.playerId) return;
  const player = getPlayer(conn.playerId);
  if (!player || !player.nickname) return send(conn, { t: "error", code: "need_nick", msg: "set a nickname first" });
  const rating = getRating(conn.playerId, mode).rating;
  conn.queued = mode;
  matchmaker.join({
    playerId: conn.playerId,
    connectionId: conn.id,
    mode,
    rating,
    joinedAt: Date.now(),
    lastNotifyAt: 0,
  });
}

function handleQueueLeave(conn: Connection) {
  if (conn.queued) {
    matchmaker.leave(conn.playerId!);
    conn.queued = undefined;
  }
}

function handleRematchVote(conn: Connection, vote: boolean) {
  const room = findMyRoom(conn);
  if (!room || room.match) return;
  const slot = findMySlot(room, conn);
  if (slot < 0) return;
  if (vote) room.rematchVotes.add(slot);
  else room.rematchVotes.delete(slot);
  // majority restarts
  const humans = room.slots.filter((s) => s.kind === "human").length;
  if (room.rematchVotes.size > humans / 2) {
    room.rematchVotes.clear();
    const mode: GameMode = room.opts.size === 2 ? "duel" : "ffa";
    startRoomMatch(room, mode, false);
  }
}

// ---------- lifecycle ----------

function onClose(conn: Connection) {
  Connections.delete(conn.id);
  if (conn.queued && conn.playerId) matchmaker.leave(conn.playerId);
  const room = findMyRoom(conn);
  if (room) {
    const slot = findMySlot(room, conn);
    if (slot >= 0) {
      // casual: convert to medium bot after grace; here we just open the slot for simplicity
      room.slots[slot] = { kind: "open" };
      room.touch();
      broadcast(room, lobbyState(room, slot));
    }
  }
}

// ---------- matchmaker wiring ----------

export const matchmaker = new Matchmaker();
matchmaker.send = (connId, msg) => {
  const c = Connections.get(connId);
  if (c) send(c, msg as ServerMsg);
};
matchmaker.onMatch = (mode, players) => {
  // create a hidden ranked room
  const code = newRoomCode();
  const roomOpts: RoomOpts = {
    name: "Ranked",
    size: mode === "duel" ? 2 : 4,
    visibility: "private",
    theme: "beach",
    roundsToWin: 3,
    botFill: false,
  };
  const first = players[0];
  const fp = getPlayer(first.playerId)!;
  const room = new Room(code, roomOpts, first.playerId, fp.nickname ?? "P", fp.selected_animal as Animal, fp.selected_hat as Hat);
  room.slots[0].connectionId = first.connectionId;
  for (let i = 1; i < players.length; i++) {
    const qp = players[i];
    const p = getPlayer(qp.playerId)!;
    room.slots[i] = {
      kind: "human",
      playerId: p.id,
      nickname: p.nickname ?? "P",
      animal: p.selected_animal as Animal,
      hat: p.selected_hat as Hat,
      connectionId: qp.connectionId,
    };
  }
  Rooms.set(code, room);
  for (const qp of players) {
    const c = Connections.get(qp.connectionId);
    if (c) {
      c.roomCode = code;
      c.queued = undefined;
      send(c, { t: "match_found", mode, ranked: true });
    }
  }
  startRoomMatch(room, mode, true);
};

// GC idle rooms (spec §3)
export function gcRooms() {
  const now = Date.now();
  for (const [code, room] of Rooms) {
    if (room.match) continue; // don't GC in-progress matches
    if (now - room.lastActivity > ROOM_TTL_MS) {
      Rooms.delete(code);
    }
  }
}

// avoid unused-import warnings for symbols re-exported/used by tests & API only
void xpForLevel; void getProfile; void tierFor; void ANIMALS; void HATS; void UNLOCKS; void MODES;
void toSnapshot; void recordMatchStart; void recordMatchPlayer; void setCosmetics; void Rng; void eloFFA; void XP;
