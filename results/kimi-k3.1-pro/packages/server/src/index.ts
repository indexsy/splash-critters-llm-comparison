import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { CONFIG } from "@splash/shared";
import type { ClientMessage, GameMode } from "@splash/shared";
import { SplashDatabase } from "./db/index.js";
import { Matchmaker } from "./matchmaker.js";
import { allowMessage, createConnection, nicknameProblem, parseClientMessage, sendError, sendMessage } from "./net.js";
import { RoomManager } from "./rooms.js";

const port = Number(process.env.PORT ?? 3000);
const latency = Number(process.env.LATENCY_MS ?? CONFIG.ARTIFICIAL_LATENCY_MS);
const db = new SplashDatabase(process.env.DATA_DIR ?? "./data");
const rooms = new RoomManager(db);
const matchmaker = new Matchmaker(rooms);
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "splash-critters", time: Date.now() });
});

app.get("/api/leaderboard", (request, response) => {
  const mode = request.query.mode === "ffa" ? "ffa" : request.query.mode === "duel" ? "duel" : null;
  if (!mode) return response.status(400).json({ error: "mode must be duel or ffa" });
  response.json({ mode, players: db.leaderboard(mode) });
});

app.get("/api/profile/:id", (request, response) => {
  const profile = db.profileRecord(request.params.id);
  if (!profile) return response.status(404).json({ error: "Profile not found" });
  response.json(profile);
});

const clientDirectory = fileURLToPath(new URL("../../client/dist", import.meta.url));
const clientIndex = `${clientDirectory}/index.html`;
app.use(express.static(clientDirectory, { index: false, maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.get("*", (_request, response) => {
  if (existsSync(clientIndex)) return response.sendFile(clientIndex);
  response.status(200).type("text/plain").send("Splash Critters server is running");
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
});

function handleMessage(connection: ReturnType<typeof createConnection>, message: ClientMessage): void {
  if (message.type === "hello") {
    if (connection.accountId) return;
    const { token, profile } = db.findOrCreateGuest(message.token);
    connection.accountId = profile.id;
    connection.profile = profile;
    rooms.register(connection);
    sendMessage(connection, { type: "welcome", playerId: profile.id, sessionId: connection.id, profile, token });
    return;
  }
  if (!connection.accountId || !connection.profile) return sendError(connection, "HELLO_REQUIRED", "Identify your device first");
  switch (message.type) {
    case "set_nickname": {
      const nickname = message.nickname.trim();
      const problem = nicknameProblem(nickname);
      if (problem) return sendError(connection, "INVALID_NICKNAME", problem);
      const profile = db.setNickname(connection.accountId, nickname);
      connection.profile = profile;
      sendMessage(connection, { type: "profile_update", profile });
      rooms.profileUpdated(profile);
      break;
    }
    case "set_cosmetics": {
      try {
        const profile = db.setCosmetics(connection.accountId, message.animal, message.hat);
        connection.profile = profile;
        sendMessage(connection, { type: "profile_update", profile });
        rooms.profileUpdated(profile);
      } catch {
        sendError(connection, "COSMETIC_LOCKED", "That cosmetic is still locked");
      }
      break;
    }
    case "queue_join":
      matchmaker.join(connection, message.mode);
      break;
    case "queue_leave":
      matchmaker.leave(connection);
      break;
    case "create_room":
      matchmaker.leave(connection);
      rooms.createRoom(connection, message.opts);
      break;
    case "join_room":
      matchmaker.leave(connection);
      rooms.join(connection, message.code);
      break;
    case "room_list_request":
      rooms.requestRoomList(connection, message.filter);
      break;
    case "leave_room":
      rooms.leave(connection);
      break;
    case "practice_start":
      matchmaker.leave(connection);
      rooms.createSpecial(connection, "practice", message.difficulty);
      break;
    case "tutorial_start":
      matchmaker.leave(connection);
      rooms.createSpecial(connection, "tutorial");
      break;
    case "set_slot":
    case "set_ready":
    case "start_match":
    case "input":
    case "emote":
    case "rematch_vote":
      rooms.roomAction(connection, message);
      break;
    case "pong":
      connection.rtt = Math.max(0, Date.now() - message.t);
      break;
    default:
      break;
  }
}

wss.on("connection", (ws) => {
  const connection = createConnection(ws, Number.isFinite(latency) ? Math.max(0, latency) : 0);
  ws.on("message", (raw) => {
    if (!allowMessage(connection)) {
      if (connection.rateCount === CONFIG.RATE_LIMIT_MESSAGES_PER_SECOND + 1) sendError(connection, "RATE_LIMIT", "Too many messages");
      if (connection.rateCount > CONFIG.RATE_LIMIT_MESSAGES_PER_SECOND * 2) ws.close(1008, "Rate limit");
      return;
    }
    const message = parseClientMessage(raw);
    if (!message) return sendError(connection, "BAD_MESSAGE", "Invalid message");
    try {
      handleMessage(connection, message);
    } catch (error) {
      console.error("Message handling failed", error);
      sendError(connection, "SERVER_ERROR", "Something went wrong");
    }
  });
  ws.on("close", () => {
    matchmaker.disconnect(connection);
    rooms.disconnect(connection);
  });
  ws.on("error", () => {
    matchmaker.disconnect(connection);
    rooms.disconnect(connection);
  });
});

const pingTimer = setInterval(() => {
  for (const client of rooms.clients) sendMessage(client, { type: "ping", t: Date.now() });
}, CONFIG.PING_INTERVAL_MS);

server.listen(port, "0.0.0.0", () => {
  console.log(`Splash Critters listening on http://0.0.0.0:${port}`);
});

function shutdown(): void {
  clearInterval(pingTimer);
  matchmaker.stop();
  rooms.stop();
  wss.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
