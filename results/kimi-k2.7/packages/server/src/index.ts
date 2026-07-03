import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { join } from "path";
import type { ClientMsg, Mode, RoomOpts, ServerMsg } from "@splash/shared";
import { CONFIG } from "@splash/shared";
import {
  initDb,
  findOrCreatePlayer,
  getProfile,
  setNickname,
  getLeaderboard,
  recentMatches,
  addXp,
} from "./db/index.js";
import {
  addConnection,
  getConnection,
  isRateLimited,
  parseClientMsg,
  removeConnection,
  roomConnections,
  send,
  validateInput,
} from "./net.js";
import {
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  listPublicRooms,
  rematchVote,
  setReady,
  setSlot,
  startRoomMatch,
  gcRooms,
  broadcastLobby,
  getAllRunningMatches,
} from "./rooms.js";
import { joinQueue, leaveQueue, tickMatchmaker } from "./matchmaker.js";
import { finalizeRankedMatch } from "./elo.js";
import type { RunningMatch } from "./gameLoop.js";
import { setPlayerInput, tickMatch } from "./gameLoop.js";
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || "./data";

initDb(DATA_DIR);

// Static client build
const clientDist = join(process.cwd(), "packages/client/dist");
app.use(express.static(clientDist));
app.use(express.json({ limit: "8kb" }));

// Health
app.get("/health", (_req, res) => {
  res.json({ ok: true, players: wss.clients.size, rooms: getAllRunningMatches().length });
});

// API
app.get("/api/leaderboard", (req, res) => {
  const mode = (req.query.mode as Mode) || "duel";
  if (mode !== "duel" && mode !== "ffa") {
    res.status(400).json({ error: "bad mode" });
    return;
  }
  res.json({ entries: getLeaderboard(mode) });
});

app.get("/api/profile/:id", (req, res) => {
  const profile = getProfile(req.params.id);
  if (!profile) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ profile, recent: recentMatches(req.params.id) });
});

app.get("*", (_req, res) => {
  res.sendFile(join(clientDist, "index.html"));
});

// WebSocket handling
wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    const text = data.toString();
    if (text.length > CONFIG.MSG_MAX_SIZE) {
      ws.close();
      return;
    }
    const msg = parseClientMsg(text);
    if (!msg) return;
    handleMessage(ws, msg);
  });

  ws.on("close", () => {
    const c = getConnection(ws);
    if (c) {
      leaveQueue(c);
      leaveRoom(c);
      removeConnection(ws);
    }
  });

  ws.on("error", (err) => {
    console.error("ws error", err);
  });
});

function handleMessage(ws: WebSocket, msg: ClientMsg) {
  const c = getConnection(ws);
  if (c && isRateLimited(c)) {
    send(ws, { type: "error", code: "rate_limited", msg: "Too many messages" });
    return;
  }

  switch (msg.type) {
    case "hello": {
      const { id, token } = findOrCreatePlayer(msg.token);
      const profile = getProfile(id)!;
      addConnection(ws, id, token, profile);
      send(ws, { type: "welcome", playerId: id, profile, token });
      break;
    }
    case "set_nickname": {
      if (!c) return;
      const ok = setNickname(c.playerId, msg.nickname);
      if (!ok) {
        send(ws, { type: "error", code: "nickname_invalid", msg: "Invalid or taken nickname" });
      } else {
        const profile = getProfile(c.playerId)!;
        c.nickname = profile.nickname;
        c.profile = profile;
        send(ws, { type: "profile_update", profile });
      }
      break;
    }
    case "queue_join": {
      if (!c) return;
      if (!c.profile.nickname) {
        send(ws, { type: "error", code: "nickname_required", msg: "Set nickname before ranked" });
        return;
      }
      leaveRoom(c);
      joinQueue(c, msg.mode);
      break;
    }
    case "queue_leave": {
      if (!c) return;
      leaveQueue(c);
      break;
    }
    case "create_room": {
      if (!c) return;
      leaveQueue(c);
      leaveRoom(c);
      const room = createRoom(c, msg.opts);
      send(ws, { type: "room_created", code: room.code });
      broadcastLobby(room);
      break;
    }
    case "join_room": {
      if (!c) return;
      leaveQueue(c);
      const ok = joinRoom(c, msg.code);
      if (!ok) {
        send(ws, { type: "error", code: "join_failed", msg: "Could not join room" });
      } else {
        const room = getRoom(msg.code)!;
        broadcastLobby(room);
      }
      break;
    }
    case "room_list_request": {
      send(ws, { type: "room_list", rooms: listPublicRooms(msg.mode) });
      break;
    }
    case "leave_room": {
      if (!c) return;
      leaveRoom(c);
      break;
    }
    case "set_slot": {
      if (!c) return;
      const room = getRoom(c.roomCode || "");
      if (!room || room.hostId !== c.playerId) return;
      setSlot(room, msg.slot, msg.kind, msg.difficulty);
      break;
    }
    case "set_ready": {
      if (!c) return;
      const room = getRoom(c.roomCode || "");
      if (!room) return;
      setReady(room, c.playerId, msg.ready);
      break;
    }
    case "start_match": {
      if (!c) return;
      const room = getRoom(c.roomCode || "");
      if (!room || room.hostId !== c.playerId) return;
      startRoomMatch(room, (rm) => onMatchFinish(rm, room));
      break;
    }
    case "input": {
      if (!c) return;
      const input = validateInput(msg.input);
      if (!input) return;
      const room = getRoom(c.roomCode || "");
      if (room?.runningMatch) {
        // Keep latest inputs
        c.inputBuffer = c.inputBuffer.filter((i) => i.tick > input.tick - 30);
        c.inputBuffer.push(input);
        setPlayerInput(room.runningMatch, c.playerId, input);
      }
      break;
    }
    case "emote": {
      if (!c) return;
      // handled in snapshot via emote fields; simplistic
      break;
    }
    case "rematch_vote": {
      if (!c) return;
      const room = getRoom(c.roomCode || "");
      if (room) rematchVote(room, c.playerId, msg.vote);
      break;
    }
    case "pong": {
      if (!c) return;
      c.latency = (Date.now() - msg.t) / 2;
      break;
    }
    case "tutorial_complete": {
      if (!c) return;
      addXp(c.playerId, 50);
      const profile = getProfile(c.playerId)!;
      c.profile = profile;
      send(ws, { type: "profile_update", profile });
      break;
    }
  }
}

function onMatchFinish(rm: RunningMatch, room: any) {
  const soaks: Record<string, number> = {};
  for (const id of Object.keys(rm.stats)) soaks[id] = rm.stats[id].soaks;

  let result;
  if (rm.match.ranked) {
    result = finalizeRankedMatch(rm.match.mode, rm.match.roundWins, soaks, rm.match.id);
  } else {
    const placements = Object.entries(rm.match.roundWins)
      .map(([playerId, roundsWon]) => ({ playerId, roundsWon, soaks: soaks[playerId] ?? 0 }))
      .sort((a, b) => {
        if (a.roundsWon !== b.roundsWon) return b.roundsWon - a.roundsWon;
        return b.soaks - a.soaks;
      })
      .map((p, i) => ({ ...p, placement: i + 1 }));
    const xp: Record<string, number> = {};
    const stats: Record<string, { soaks: number; castles: number; roundsWon: number }> = {};
    for (const p of placements) {
      let x = CONFIG.XP_PARTICIPATION;
      if (p.placement === 1) x += CONFIG.XP_WIN;
      x += p.soaks * CONFIG.XP_PER_SOAK;
      x += CONFIG.XP_TOP_PLACEMENT[Math.min(p.placement - 1, CONFIG.XP_TOP_PLACEMENT.length - 1)] ?? 0;
      xp[p.playerId] = x;
      stats[p.playerId] = { soaks: p.soaks, castles: 0, roundsWon: p.roundsWon };
      addXp(p.playerId, x);
    }
    result = {
      matchId: rm.match.id,
      mode: rm.match.mode,
      ranked: false,
      placements: placements.map((p) => ({ playerId: p.playerId, placement: p.placement })),
      ratingDeltas: {},
      xp,
      stats,
    };
  }

  const msg: ServerMsg = {
    type: "match_end",
    placements: result.placements,
    ratingDeltas: result.ratingDeltas,
    xp: result.xp,
    stats: result.stats,
  };
  for (const c of roomConnections(room.code)) {
    send(c.ws, msg);
    const profile = getProfile(c.playerId);
    if (profile) send(c.ws, { type: "profile_update", profile });
  }
}

// Main loops
setInterval(() => {
  const now = Date.now();
  const matches = tickMatchmaker(now);
  for (const m of matches) {
    // Create ranked room
    const host = m.players[0];
    const opts: RoomOpts = {
      name: "Ranked " + m.mode,
      mode: m.mode,
      public: false,
      theme: "random",
      roundsToWin: CONFIG.ROUND_WIN_FIRST_TO,
      botFill: false,
    };
    const room = createRoom(host, opts);
    for (let i = 1; i < m.players.length; i++) {
      joinRoom(m.players[i], room.code);
    }
    room.ranked = true as any; // mark for finish
    const rm = startRoomMatch(room, (running) => onMatchFinish(running, room));
    if (rm) rm.match.ranked = true;
  }
}, CONFIG.MM_TICK_MS);

setInterval(() => {
  for (const rm of getAllRunningMatches()) {
    tickMatch(rm);
  }
  gcRooms(Date.now());
}, 1000 / CONFIG.TICK_RATE);

setInterval(() => {
  for (const c of getAllConnections()) {
    c.pingSentAt = Date.now();
    send(c.ws, { type: "ping", t: Date.now() });
  }
}, CONFIG.PING_INTERVAL_MS);

function getAllConnections() {
  const list: any[] = [];
  wss.clients.forEach((ws) => {
    const c = getConnection(ws);
    if (c) list.push(c);
  });
  return list;
}

server.listen(PORT, () => {
  console.log(`Splash Critters server on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
