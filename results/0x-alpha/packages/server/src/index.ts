import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG,
  tierFor,
  type ClientMsg,
  type GameMode,
  type MatchEndMsg,
} from "@sc/shared";
import { openDb } from "./db/db";
import { Queries, publicProfile, cleanNickname } from "./db/queries";
import { createRateLimiter, validateClientMsg } from "./net";
import { Rooms, type ActiveMatch, type Conn } from "./rooms";
import { GameLoop } from "./gameLoop";
import { Matchmaker } from "./matchmaker";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? path.join(__dirname, "../../data");

const db = openDb(DATA_DIR);
const q = new Queries(db);

const app = express();
app.use(express.json());

// ---------- REST ----------

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), rooms: [...rooms.allRooms()].length });
});

app.get("/api/leaderboard", (req, res) => {
  const mode = req.query.mode === "ffa" ? "ffa" : "duel";
  res.json({ mode, entries: q.leaderboard(mode as GameMode) });
});

app.get("/api/profile/:id", (req, res) => {
  const profile = q.profile(req.params.id);
  if (!profile) return res.status(404).json({ error: "not_found" });
  res.json(profile);
});

const server = http.createServer(app);

// ---------- game services ----------

const loop = new GameLoop({
  broadcastMatch(match, msg) {
    rooms.broadcastMatch(match, msg);
  },
  sendToEntity(match, entityId, msg) {
    rooms.sendToEntity(match, entityId, msg);
  },
  onMatchEnd(match: ActiveMatch, end: MatchEndMsg) {
    rooms.finalizeMatch(match, end);
  },
});
const rooms = new Rooms(q, loop, () => {});
const matchmaker = new Matchmaker(rooms, (playerId, mode) => q.rating(playerId, mode).rating);

// ---------- WebSocket ----------

const wss = new WebSocketServer({ server, path: "/ws" });
const limiter = createRateLimiter(CONFIG.maxMsgsPerSec);

wss.on("connection", (ws: WebSocket) => {
  const conn: Conn = {
    id: crypto.randomUUID(),
    playerRow: null,
    profile: null,
    roomCode: null,
    send(msg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };

  ws.on("message", (raw) => {
    const text = raw.toString();
    if (!limiter.allow(conn.id)) return;
    const msg = validateClientMsg(text);
    if (!msg) {
      conn.send({ t: "error", code: "bad_msg", msg: "invalid message" });
      return;
    }
    handle(conn, msg);
  });

  ws.on("close", () => {
    matchmaker.handleDisconnect(conn.playerRow?.id ?? "");
    rooms.dropConn(conn);
  });

  function handle(conn: Conn, msg: ClientMsg): void {
    switch (msg.t) {
      case "hello": {
        let row = msg.token ? q.playerByToken(msg.token) : undefined;
        let token = msg.token;
        if (!row) {
          token = crypto.randomUUID();
          row = q.createPlayer(token!);
        }
        rooms.bindPlayer(conn, row);
        // reconnect into an active ranked match?
        const active = rooms.activeRankedMatch(row.id);
        conn.send({
          t: "welcome",
          playerId: row.id,
          token,
          profile: publicProfile(row, q),
          ratings: {
            duel: q.rating(row.id, "duel"),
            ffa: q.rating(row.id, "ffa"),
          },
        });
        void active;
        break;
      }
      case "set_nickname": {
        if (!conn.playerRow) return;
        const clean = cleanNickname(msg.nickname);
        if (!clean) {
          conn.send({ t: "error", code: "bad_nickname", msg: "3-16 chars, letters/numbers/space/-_" });
          return;
        }
        q.setNickname(conn.playerRow.id, clean);
        conn.profile = publicProfile(q.playerById(conn.playerRow.id)!, q);
        conn.send({ t: "welcome", playerId: conn.playerRow.id, token: "", profile: conn.profile, ratings: { duel: q.rating(conn.playerRow.id, "duel"), ffa: q.rating(conn.playerRow.id, "ffa") } });
        break;
      }
      case "select": {
        if (!conn.playerRow) return;
        const row = q.playerById(conn.playerRow.id)!;
        const unlocks = q.unlocks(row.id);
        const animalsOk = CONFIG.unlocks.startAnimals.includes(msg.animal) || unlocks.animals.includes(msg.animal);
        const hatsOk = msg.hat === null || unlocks.hats.includes(msg.hat);
        if (animalsOk && hatsOk) {
          q.setSelection(row.id, msg.animal, msg.hat);
          conn.profile = publicProfile(q.playerById(row.id)!, q);
        }
        break;
      }
      case "queue_join": {
        if (!conn.playerRow) return;
        if (!q.playerById(conn.playerRow.id)!.nickname_custom) {
          conn.send({ t: "error", code: "nickname_required", msg: "set a nickname before ranked" });
          return;
        }
        matchmaker.join(msg.mode, conn);
        break;
      }
      case "queue_leave":
        if (conn.playerRow) matchmaker.leave(conn.playerRow.id);
        break;
      case "create_room": {
        if (!conn.playerRow || !defaultGuard(conn)) return;
        rooms.leaveRoom(conn);
        rooms.createRoom(conn, msg);
        break;
      }
      case "join_room": {
        if (!conn.playerRow || !defaultGuard(conn)) return;
        rooms.leaveRoom(conn);
        const room = rooms.joinRoom(conn, msg.code);
        if (!room) conn.send({ t: "error", code: "room_not_found", msg: `room ${msg.code} not found or full` });
        break;
      }
      case "room_list_request":
        conn.send(rooms.roomList());
        break;
      case "leave_room":
        rooms.leaveRoom(conn);
        break;
      case "set_slot":
        rooms.setSlot(conn, msg.slot, msg.kind, msg.difficulty ?? "medium");
        break;
      case "set_ready":
        rooms.setReady(conn, msg.ready);
        break;
      case "start_match":
        rooms.startMatch(conn);
        break;
      case "input": {
        const match = findMatchForConn(conn);
        if (match) {
          const entity = match.entities.find((e) => e.playerId === conn.playerRow?.id);
          if (entity && !entity.isBot) {
            loop.applyInput(match, entity.id, {
              seq: msg.seq,
              tick: msg.tick,
              dirX: msg.dirX,
              dirY: msg.dirY,
              balloonPressed: msg.balloonPressed,
            });
          }
        }
        break;
      }
      case "emote": {
        const match = findMatchForConn(conn);
        if (match && conn.playerRow) {
          const now = Date.now();
          const last = emoteCooldowns.get(conn.playerRow.id) ?? 0;
          if (now - last >= CONFIG.emoteCooldownMs) {
            emoteCooldowns.set(conn.playerRow.id, now);
            const entity = match.entities.find((e) => e.playerId === conn.playerRow!.id);
            if (entity) rooms.broadcastMatch(match, { t: "emote_event", entityId: entity.id, id: msg.id });
          }
        }
        break;
      }
      case "rematch_vote":
        rooms.voteRematch(conn);
        break;
      case "pong":
        break;
    }
  }

  function defaultGuard(conn: Conn): boolean {
    if (!conn.playerRow) return false;
    if (matchmaker.isQueued(conn.playerRow.id)) {
      conn.send({ t: "error", code: "in_queue", msg: "leave the ranked queue first" });
      return false;
    }
    return true;
  }
});

const emoteCooldowns = new Map<string, number>();

function findMatchForConn(conn: Conn): ActiveMatch | null {
  if (!conn.playerRow) return null;
  // ranked match?
  const ranked = rooms.activeRankedMatch(conn.playerRow.id);
  if (ranked && !ranked.finished) return ranked;
  // room match?
  const room = conn.roomCode ? rooms.getRoom(conn.roomCode) : undefined;
  if (room?.match && !room.match.finished) return room.match;
  return null;
}

// periodic housekeeping
setInterval(() => {
  rooms.gcRooms();
}, 60_000);

// queue status push
setInterval(() => {
  for (const { playerId, mode } of matchmaker.queuedEntries()) {
    const conn = rooms.getConn(playerId);
    if (!conn) continue;
    const status = matchmaker.queueStatus(mode, playerId);
    conn.send({ t: "queue_status", mode, ...status });
  }
}, CONFIG.matchmakerTickMs);

loop.start();
matchmaker.start();

// static client in production
const clientDist = path.join(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

server.listen(PORT, () => {
  console.log(`Splash Critters server listening on :${PORT} (data: ${DATA_DIR})`);
});
