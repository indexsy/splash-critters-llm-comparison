import type Database from "better-sqlite3";
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  ANIMALS,
  CONFIG,
  HATS,
  type AnimalId,
  type ClientMsg,
  type HatId,
} from "@splash/shared";
import {
  addXp,
  createGuest,
  findByToken,
  leaderboard,
  loadProfile,
  recentMatches,
  setCosmetic,
  setNickname,
} from "./db/index.js";
import type { DbApi } from "./dbApi.js";
import { enqueue, leaveQueue } from "./matchmaker.js";
import {
  broadcast,
  createRoom,
  getRoom,
  handleRoomInput,
  joinRoom,
  leaveRoom,
  lobbyPayload,
  publicRoomList,
  send,
  setSlot,
  startMatch,
  voteRematch,
  type Client,
} from "./rooms.js";

export function makeDbApi(db: Database.Database): DbApi {
  return { raw: db, loadProfile: (id) => loadProfile(db, id) };
}

export function attachWs(wss: WebSocketServer, db: Database.Database): void {
  const api = makeDbApi(db);
  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    const client: Client = {
      ws,
      playerId: null,
      profile: null,
      roomCode: null,
      queuedMode: null,
      queuedAt: 0,
      lastMsgs: [],
      lastInput: null,
      lastPong: Date.now(),
      alive: true,
    };

    ws.on("message", (raw) => {
      if (!rateOk(client)) return;
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw)) as ClientMsg;
      } catch {
        send(client, { type: "error", code: "bad_json", msg: "Invalid message" });
        return;
      }
      handle(client, msg, db, api);
    });

    ws.on("close", () => {
      client.alive = false;
      leaveQueue(client);
      leaveRoom(client);
    });
  });

  setInterval(() => {
    for (const c of wss.clients) {
      if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: "ping", t: Date.now() }));
    }
  }, CONFIG.PING_INTERVAL_MS);
}

function rateOk(client: Client): boolean {
  const now = Date.now();
  client.lastMsgs = client.lastMsgs.filter((t) => now - t < 1000);
  if (client.lastMsgs.length >= CONFIG.RATE_LIMIT_MSGS_PER_SEC) return false;
  client.lastMsgs.push(now);
  return true;
}

function handle(client: Client, msg: ClientMsg, db: Database.Database, api: DbApi): void {
  switch (msg.type) {
    case "hello": {
      const { token, profile } = msg.token
        ? (() => {
            const p = findByToken(db, msg.token!);
            return p ? { token: msg.token!, profile: p } : createGuest(db);
          })()
        : createGuest(db);
      client.playerId = profile.id;
      client.profile = profile;
      send(client, { type: "welcome", playerId: profile.id, profile, token });
      return;
    }
    case "set_nickname": {
      if (!client.playerId) return;
      const r = setNickname(db, client.playerId, msg.nickname);
      if (!r.ok) {
        send(client, { type: "error", code: "bad_nick", msg: r.msg });
        return;
      }
      client.profile = loadProfile(db, client.playerId);
      if (client.profile) send(client, { type: "profile", profile: client.profile });
      return;
    }
    case "set_cosmetic": {
      if (!client.playerId) return;
      if (!ANIMALS.some((a) => a.id === msg.animal) || !HATS.some((h) => h.id === msg.hat)) return;
      setCosmetic(db, client.playerId, msg.animal as AnimalId, msg.hat as HatId);
      client.profile = loadProfile(db, client.playerId);
      if (client.profile) send(client, { type: "profile", profile: client.profile });
      return;
    }
    case "queue_join": {
      if (!client.profile) return;
      if (client.profile.nickname.length < CONFIG.NICKNAME_MIN) {
        send(client, { type: "error", code: "need_nick", msg: "Set a nickname before ranked" });
        return;
      }
      enqueue(client, msg.mode, client.profile.ratings[msg.mode].rating);
      return;
    }
    case "queue_leave":
      leaveQueue(client);
      return;
    case "create_room": {
      if (!client.profile) return;
      const room = createRoom(client, msg.opts);
      send(client, { type: "room_created", code: room.code });
      send(client, lobbyPayload(room));
      return;
    }
    case "join_room": {
      const r = joinRoom(client, msg.code);
      if (typeof r === "string") {
        send(client, { type: "error", code: "join_fail", msg: r });
        return;
      }
      send(client, lobbyPayload(r));
      broadcast(r, lobbyPayload(r));
      return;
    }
    case "room_list_request":
      send(client, { type: "room_list", rooms: publicRoomList() });
      return;
    case "leave_room":
      leaveRoom(client);
      return;
    case "set_slot": {
      if (!client.roomCode || !client.playerId) return;
      const room = getRoom(client.roomCode);
      if (!room) return;
      const err = setSlot(room, client.playerId, msg.slot, msg.kind, msg.difficulty);
      if (err) send(client, { type: "error", code: "slot", msg: err });
      else broadcast(room, lobbyPayload(room));
      return;
    }
    case "set_ready": {
      if (!client.roomCode || !client.playerId) return;
      const room = getRoom(client.roomCode);
      if (!room) return;
      const slot = room.slots.find((s) => s.playerId === client.playerId);
      if (slot) slot.ready = msg.ready;
      broadcast(room, lobbyPayload(room));
      return;
    }
    case "start_match": {
      if (!client.roomCode || !client.playerId) return;
      const room = getRoom(client.roomCode);
      if (!room) return;
      if (room.hostId !== client.playerId) {
        send(client, { type: "error", code: "not_host", msg: "Only host can start" });
        return;
      }
      const err = startMatch(room, api);
      if (err) send(client, { type: "error", code: "start", msg: err });
      return;
    }
    case "input": {
      if (!client.roomCode || !client.playerId) return;
      const room = getRoom(client.roomCode);
      if (!room) return;
      const dir = msg.dir;
      if (!["up", "down", "left", "right", "none"].includes(dir)) return;
      handleRoomInput(room, client.playerId, {
        seq: msg.seq,
        tick: msg.tick,
        dir,
        balloonPressed: !!msg.balloonPressed,
      });
      return;
    }
    case "emote": {
      if (!client.roomCode || !client.playerId) return;
      const room = getRoom(client.roomCode);
      if (!room) return;
      const id = Math.max(1, Math.min(4, msg.id | 0));
      broadcast(room, { type: "emote_fx", playerId: client.playerId, emoteId: id });
      return;
    }
    case "rematch_vote": {
      if (!client.roomCode || !client.playerId) return;
      const room = getRoom(client.roomCode);
      if (!room) return;
      voteRematch(room, client.playerId, api);
      return;
    }
    case "pong":
      client.lastPong = Date.now();
      return;
    case "tutorial_complete": {
      if (!client.playerId) return;
      addXp(db, client.playerId, CONFIG.XP_TUTORIAL);
      client.profile = loadProfile(db, client.playerId);
      if (client.profile) send(client, { type: "profile", profile: client.profile });
      return;
    }
  }
}

export { leaderboard, loadProfile, recentMatches };
