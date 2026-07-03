import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  CONFIG,
  type C2S,
  type Dir,
  type GameMode,
  type ProfileData,
  type S2C,
} from "../../shared/src/index.js";
import {
  buildProfile,
  createGuestPlayer,
  findPlayerByToken,
  setCosmetics,
  setNickname,
  setTutorialDone,
  addXp,
  getPlayer,
} from "./db/queries.js";
import { activeMatchByPlayer, type Match } from "./gameLoop.js";
import { matchmaker } from "./matchmaker.js";
import { validateNickname } from "./names.js";
import { roomManager, type Room } from "./rooms.js";

// Artificial latency for netcode testing: LATENCY_MS=150 npm run dev
const LATENCY_MS = Number(process.env.LATENCY_MS || 0);

const connsByPlayer = new Map<string, Conn>();

class Conn {
  playerId = "";
  profile: ProfileData | null = null;
  match: Match | null = null;
  private tokens = CONFIG.RATE_LIMIT_MSGS_PER_SEC * 1.5; // small burst headroom
  private lastRefill = Date.now();
  private lastEmoteAt = 0;

  constructor(private ws: WebSocket) {}

  get displayName(): string {
    return this.profile ? `${this.profile.nickname}${this.profile.tag}` : "?";
  }
  get animal(): string {
    return this.profile?.selectedAnimal ?? "frog";
  }
  get hat(): string {
    return this.profile?.selectedHat ?? "none";
  }

  send(msg: S2C): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify(msg);
    if (LATENCY_MS > 0) setTimeout(() => this.ws.readyState === WebSocket.OPEN && this.ws.send(data), LATENCY_MS / 2);
    else this.ws.send(data);
  }

  error(code: string, msg: string): void {
    this.send({ t: "error", code, msg });
  }

  onRankedMatch(match: Match): void {
    this.match = match;
  }

  rateLimited(): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      CONFIG.RATE_LIMIT_MSGS_PER_SEC * 1.5,
      this.tokens + ((now - this.lastRefill) / 1000) * CONFIG.RATE_LIMIT_MSGS_PER_SEC
    );
    this.lastRefill = now;
    if (this.tokens < 1) return true;
    this.tokens--;
    return false;
  }

  refreshProfile(): void {
    this.profile = buildProfile(this.playerId);
  }

  emoteAllowed(): boolean {
    const now = Date.now();
    if (now - this.lastEmoteAt < CONFIG.EMOTE_COOLDOWN_MS) return false;
    this.lastEmoteAt = now;
    return true;
  }

  close(code: number, reason: string): void {
    this.ws.close(code, reason);
  }
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isDir = (v: unknown): v is Dir => isNum(v) && Number.isInteger(v) && v >= 0 && v <= 4;
const isMode = (v: unknown): v is GameMode => v === "duel" || v === "ffa";

export function attachWebSocketServer(wss: WebSocketServer): void {
  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    const conn = new Conn(ws);
    ws.on("message", (raw) => {
      if (conn.rateLimited()) {
        conn.close(4008, "rate limit");
        return;
      }
      let msg: C2S;
      try {
        msg = JSON.parse(String(raw));
        if (typeof msg !== "object" || msg === null || !isStr((msg as { t?: unknown }).t)) throw new Error("bad");
      } catch {
        conn.close(4002, "malformed message");
        return;
      }
      if (LATENCY_MS > 0) setTimeout(() => handleMessage(conn, msg), LATENCY_MS / 2);
      else handleMessage(conn, msg);
    });
    ws.on("close", () => handleClose(conn));
    ws.on("error", () => handleClose(conn));
  });
}

function handleClose(conn: Conn): void {
  if (!conn.playerId) return;
  if (connsByPlayer.get(conn.playerId) === conn) connsByPlayer.delete(conn.playerId);
  matchmaker.leave(conn.playerId);
  const room = roomManager.byPlayer.get(conn.playerId);
  if (room) {
    if (room.state === "lobby") {
      roomManager.leave(conn.playerId);
    } else {
      room.setConnected(conn.playerId, false);
    }
  }
  conn.match?.handleDisconnect(conn.playerId);
}

/** Detach from any prior activity before starting a new one. */
function leaveEverything(conn: Conn): void {
  matchmaker.leave(conn.playerId);
  roomManager.leave(conn.playerId);
  const match = activeMatchByPlayer.get(conn.playerId);
  if (match && match !== conn.match) match.handleDisconnect(conn.playerId);
  if (conn.match) {
    conn.match.handleDisconnect(conn.playerId);
    activeMatchByPlayer.delete(conn.playerId);
    conn.match = null;
  }
}

function handleMessage(conn: Conn, msg: C2S): void {
  if (msg.t === "hello") {
    handleHello(conn, msg.token);
    return;
  }
  if (!conn.playerId) {
    conn.error("not_authed", "Say hello first.");
    return;
  }
  const room = roomManager.byPlayer.get(conn.playerId) ?? null;
  switch (msg.t) {
    case "set_nickname": {
      if (!isStr(msg.nickname)) return;
      const v = validateNickname(msg.nickname);
      if (!v.ok) {
        conn.send({ t: "nickname_result", ok: false, msg: v.msg });
        return;
      }
      const res = setNickname(conn.playerId, v.nickname);
      conn.send({ t: "nickname_result", ok: res.ok, msg: res.msg });
      if (res.ok) {
        conn.refreshProfile();
        conn.send({ t: "profile_update", profile: conn.profile! });
      }
      return;
    }
    case "set_cosmetics": {
      if (!isStr(msg.animal) || !isStr(msg.hat)) return;
      setCosmetics(conn.playerId, msg.animal, msg.hat);
      conn.refreshProfile();
      conn.send({ t: "profile_update", profile: conn.profile! });
      return;
    }
    case "tutorial_done": {
      const row = getPlayer(conn.playerId);
      if (row && row.tutorial_done === 0) {
        setTutorialDone(conn.playerId);
        addXp(conn.playerId, CONFIG.XP_TUTORIAL);
        conn.refreshProfile();
        conn.send({ t: "profile_update", profile: conn.profile! });
      }
      return;
    }
    case "queue_join": {
      if (!isMode(msg.mode)) return;
      if (!conn.profile?.hasCustomNickname) {
        conn.error("nickname_required", "Pick a nickname before playing ranked.");
        return;
      }
      leaveEverything(conn);
      matchmaker.join(msg.mode, conn);
      return;
    }
    case "queue_leave":
      matchmaker.leave(conn.playerId);
      return;
    case "create_room": {
      const o = msg.opts;
      if (
        !o ||
        !isMode(o.mode) ||
        !isStr(o.name) ||
        !isBool(o.isPublic) ||
        !isBool(o.botFill) ||
        !isNum(o.roundsToWin) ||
        !["backyard", "beach", "pool", "random"].includes(o.theme)
      ) {
        conn.error("bad_request", "Invalid room options.");
        return;
      }
      leaveEverything(conn);
      const created = roomManager.create(o, conn);
      conn.send({ t: "room_created", code: created.code });
      created.broadcastLobbyState();
      return;
    }
    case "join_room": {
      if (!isStr(msg.code) || msg.code.length > 8) return;
      leaveEverything(conn);
      const joined = roomManager.join(msg.code, conn);
      if ("error" in joined) {
        conn.error("join_failed", joined.error);
        return;
      }
      return;
    }
    case "room_list_request":
      conn.send({ t: "room_list", rooms: roomManager.publicList() });
      return;
    case "leave_room":
      leaveEverything(conn);
      return;
    case "set_slot": {
      if (!room || room.hostPlayerId !== conn.playerId || room.state !== "lobby") return;
      if (!isNum(msg.slot) || msg.slot < 0 || msg.slot >= room.maxPlayers) return;
      const target = room.slots[msg.slot];
      if (target.kind === "human") return; // no kicking in v1
      if (msg.kind === "bot") {
        const diff = msg.difficulty;
        if (diff !== "easy" && diff !== "medium" && diff !== "hard") return;
        room.slots[msg.slot] = { kind: "bot", difficulty: diff };
      } else if (msg.kind === "open" || msg.kind === "closed") {
        room.slots[msg.slot] = { kind: msg.kind };
      }
      room.touch();
      room.broadcastLobbyState();
      return;
    }
    case "set_ready": {
      if (!room || room.state !== "lobby" || !isBool(msg.ready)) return;
      room.setReady(conn.playerId, msg.ready);
      room.broadcastLobbyState();
      return;
    }
    case "start_match": {
      if (!room || room.hostPlayerId !== conn.playerId) return;
      const res = roomManager.startMatch(room);
      if ("error" in res) conn.error("start_failed", res.error);
      else bindRoomMatch(room, res);
      return;
    }
    case "input": {
      if (!conn.match) return;
      if (!isNum(msg.seq) || !isNum(msg.tick) || !isDir(msg.dir) || !isBool(msg.balloon)) return;
      conn.match.handleInput(conn.playerId, {
        seq: msg.seq,
        tick: msg.tick,
        dir: msg.dir,
        balloon: msg.balloon,
      });
      return;
    }
    case "emote": {
      if (!isNum(msg.id) || msg.id < 0 || msg.id >= CONFIG.EMOTE_COUNT) return;
      if (!conn.match || !conn.emoteAllowed()) return;
      const seat = conn.match.seats.find((s) => s.playerId === conn.playerId);
      if (seat) conn.match.broadcast({ t: "emote", slot: seat.slot, id: msg.id });
      return;
    }
    case "rematch_vote": {
      if (!room) return;
      roomManager.rematchVote(room, conn.playerId);
      const restarted = room.match;
      if (room.state === "playing" && restarted) bindRoomMatch(room, restarted);
      return;
    }
    case "pong":
      // Client-initiated RTT probe: echo the timestamp straight back.
      if (isNum(msg.ts)) conn.send({ t: "ping", ts: msg.ts });
      return;
    default:
      conn.error("unknown", "Unknown message type.");
  }
}

function bindRoomMatch(room: Room, match: Match): void {
  for (const h of room.humanMembers()) {
    const c = connsByPlayer.get(h.member.playerId);
    if (c) c.match = match;
  }
}

function handleHello(conn: Conn, token: string | undefined): void {
  if (conn.playerId) return; // already authed on this socket
  let resolvedToken = isStr(token) && token.length >= 8 && token.length <= 128 ? token : randomUUID();
  let row = findPlayerByToken(resolvedToken);
  if (row && connsByPlayer.has(row.id)) {
    // Same account already connected (another tab): mint a fresh guest so
    // both tabs can play. The new token lives in that tab's sessionStorage.
    resolvedToken = randomUUID();
    row = undefined;
  }
  if (!row) row = createGuestPlayer(resolvedToken);
  conn.playerId = row.id;
  conn.refreshProfile();
  connsByPlayer.set(row.id, conn);
  conn.send({ t: "welcome", profile: conn.profile!, token: resolvedToken });

  // Auto-reconnect into a live match (15s ranked grace / casual bot takeover).
  const match = activeMatchByPlayer.get(row.id);
  if (match) {
    const ok = match.handleReconnect(row.id, conn);
    if (ok) {
      conn.match = match;
      const memberRoom = roomManager.byPlayer.get(row.id);
      memberRoom?.setConnected(row.id, true);
    } else {
      activeMatchByPlayer.delete(row.id);
    }
  }
}

