import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer } from "ws";
import { CONFIG, type ClientMessage } from "@splash/shared";
import { Store } from "./db/queries.js";
import { startGameLoop } from "./gameLoop.js";
import { Matchmaker } from "./matchmaker.js";
import { error, parseMessage, send, type Peer } from "./net.js";
import { Rooms } from "./rooms.js";

export async function startServer(
  options: { port?: number; dataDir?: string; host?: string } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("query parser", "simple");
  const server = createServer(app);
  const store = new Store(
    options.dataDir ??
      process.env.DATA_DIR ??
      fileURLToPath(new URL("../../../data/", import.meta.url)),
  );
  const peers = new Map<string, Peer>();
  const connections = new Set<Peer>();
  const rooms = new Rooms(store, peers);
  const matchmaker = new Matchmaker(rooms);
  const stopLoop = startGameLoop(rooms);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({
      ok: true,
      rooms: rooms.rooms.size,
      players: peers.size,
      version: "1.0.0",
    }),
  );
  app.get("/api/leaderboard", (req, res) => {
    if (
      req.query.mode &&
      req.query.mode !== "duel" &&
      req.query.mode !== "ffa"
    ) {
      res.status(400).json({ error: "Invalid mode" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      leaderboard: store.leaderboard(req.query.mode === "ffa" ? "ffa" : "duel"),
    });
  });
  app.get("/api/profile/:id", (req, res) => {
    const profile = store.profile(req.params.id);
    if (!profile) {
      res.status(404).json({ error: "Player not found" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ profile, recentMatches: store.recentMatches(profile.id) });
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  const clientDir = fileURLToPath(
    new URL("../../client/dist/", import.meta.url),
  );
  app.use(express.static(clientDir));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: CONFIG.MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  server.on("upgrade", (request, socket, head) => {
    if (
      request.url?.split("?")[0] !== "/ws" ||
      connections.size >= CONFIG.MAX_CONNECTIONS
    ) {
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    if (origin) {
      let allowed = false;
      try {
        const url = new URL(origin);
        allowed =
          url.host === request.headers.host ||
          (process.env.ALLOWED_ORIGINS ?? "").split(",").includes(origin) ||
          (process.env.NODE_ENV !== "production" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
      } catch {
        /* Reject malformed origins. */
      }
      if (!allowed) {
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(request, socket, head, (ws) =>
      wss.emit("connection", ws, request),
    );
  });
  function handle(peer: Peer, message: ClientMessage): void {
    if (message.type === "hello") {
      if (peer.id) throw new Error("This connection is already signed in.");
      const { profile, token } = store.authenticate(message.token);
      peer.id = profile.id;
      peer.profile = profile;
      const old = peers.get(profile.id);
      if (old) {
        if (old.queue) matchmaker.leave(old);
        old.ws.close(4001, "Account opened in another tab");
      }
      peers.set(profile.id, peer);
      send(peer, { type: "welcome", playerId: profile.id, profile, token });
      rooms.reconnect(peer);
      return;
    }
    if (!peer.id) throw new Error("Say hello before joining the pool.");
    if (peers.get(peer.id) !== peer) return;
    const room = rooms.rooms.get(peer.roomCode ?? "");
    switch (message.type) {
      case "pong":
        if (message.t === peer.pingSent) {
          peer.rtt = Math.max(0, Date.now() - message.t);
          peer.lastSeen = Date.now();
        }
        break;
      case "room_list_request":
        peer.listSubscribed = true;
        peer.listMode = message.mode;
        send(peer, { type: "room_list", rooms: rooms.list(message.mode) });
        break;
      case "set_nickname": {
        if (room?.status === "playing" || peer.queue)
          throw new Error("Change your name between matches.");
        peer.profile = store.nickname(peer.id, message.nickname);
        send(peer, { type: "profile_updated", profile: peer.profile });
        if (room) {
          const slot = room.slots.find((s) => s.playerId === peer.id)!;
          slot.nickname = `${peer.profile.nickname}#${peer.profile.tag}`;
          rooms.update(room);
        }
        break;
      }
      case "equip": {
        if (room?.status === "playing")
          throw new Error("Change your look between matches.");
        peer.profile = store.equip(peer.id, message.animal, message.hat);
        send(peer, { type: "profile_updated", profile: peer.profile });
        if (room) {
          const slot = room.slots.find((s) => s.playerId === peer.id)!;
          slot.animal = message.animal;
          slot.hat = message.hat;
          rooms.update(room);
        }
        break;
      }
      case "queue_join":
        matchmaker.join(peer, message.mode);
        break;
      case "queue_leave":
        matchmaker.leave(peer);
        break;
      case "create_room":
        rooms.create(peer, message.opts);
        break;
      case "join_room":
        rooms.join(peer, message.code);
        break;
      case "leave_room":
        rooms.leave(peer);
        break;
      case "set_slot": {
        if (
          !room ||
          room.hostId !== peer.id ||
          room.status !== "lobby" ||
          room.ranked
        )
          throw new Error("Only the host can change bot slots before a match.");
        const slot = room.slots[message.slot];
        if (!slot || slot.kind === "human")
          throw new Error("That slot is occupied by a player.");
        if (message.kind === "bot")
          rooms.botSlot(room, message.slot, message.difficulty ?? "medium");
        else
          Object.assign(slot, {
            kind: "open",
            playerId: null,
            nickname: "Open slot",
            ready: false,
            connected: false,
          });
        rooms.update(room);
        break;
      }
      case "set_ready": {
        if (!room || room.status !== "lobby")
          throw new Error("Join a lobby first.");
        room.slots.find((s) => s.playerId === peer.id)!.ready = message.ready;
        rooms.update(room);
        break;
      }
      case "start_match": {
        if (!room || room.hostId !== peer.id || room.ranked)
          throw new Error("Only the host can start this match.");
        rooms.start(room);
        break;
      }
      case "input": {
        if (
          !room?.match ||
          room.status !== "playing" ||
          room.match.countdown > 0 ||
          room.match.state.roundOver
        )
          break;
        if (message.seq <= peer.lastSeq || message.seq - peer.lastSeq > 10000)
          break;
        peer.lastSeq = message.seq;
        const old = room.match.inputs.get(peer.id);
        room.match.inputs.set(peer.id, {
          input: {
            ...message,
            balloonPressed:
              message.balloonPressed || !!old?.input.balloonPressed,
          },
          received: Date.now(),
        });
        break;
      }
      case "emote": {
        if (!room || Date.now() - peer.lastEmote < CONFIG.EMOTE_COOLDOWN_MS)
          break;
        peer.lastEmote = Date.now();
        rooms.broadcast(room, {
          type: "event",
          event: { type: "emote", playerId: peer.id, id: message.id },
        });
        break;
      }
      case "rematch_vote": {
        if (!room || room.ranked || room.status !== "results")
          throw new Error("Rematches are available after casual matches.");
        if (!room.rematchVotes.includes(peer.id))
          room.rematchVotes.push(peer.id);
        const humans = room.slots.filter(
          (s) => s.kind === "human" && s.connected,
        );
        if (
          room.rematchVotes.filter((id) =>
            humans.some((s) => s.playerId === id),
          ).length >
          humans.length / 2
        ) {
          for (const slot of room.slots) {
            if (slot.kind === "open") rooms.botSlot(room, slot.slot, "medium");
            slot.ready = true;
          }
          rooms.start(room);
        } else rooms.update(room);
        break;
      }
      case "tutorial_complete": {
        if (
          !room?.opts.tutorial ||
          !room.match ||
          !["move", "castle", "pickup", "chain", "soak"].every((g) =>
            room.match!.tutorialGoals.has(g),
          )
        )
          throw new Error(
            "Finish the five training challenges first, or skip to the menu.",
          );
        peer.profile = store.tutorial(peer.id);
        send(peer, { type: "profile_updated", profile: peer.profile });
        break;
      }
    }
  }
  wss.on("connection", (ws) => {
    const peer: Peer = {
      ws,
      id: null,
      profile: null,
      roomCode: null,
      queue: null,
      messages: 0,
      windowAt: Date.now(),
      lastSeen: Date.now(),
      lastEmote: 0,
      rtt: 0,
      pingSent: 0,
      lastSeq: -1,
      listSubscribed: false,
    };
    connections.add(peer);
    ws.on("error", () => ws.terminate());
    ws.on("message", (raw) => {
      if (Date.now() - peer.windowAt >= 1000) {
        peer.windowAt = Date.now();
        peer.messages = 0;
      }
      if (++peer.messages > CONFIG.RATE_LIMIT) {
        ws.close(1008, "Message rate exceeded");
        return;
      }
      const message = parseMessage(raw);
      if (!message) {
        error(peer, "That message was not valid.", "BAD_MESSAGE");
        return;
      }
      try {
        handle(peer, message);
      } catch (e) {
        error(peer, e instanceof Error ? e.message : "Please try again.");
      }
    });
    ws.on("close", () => {
      connections.delete(peer);
      if (peer.id && peers.get(peer.id) === peer) {
        matchmaker.leave(peer);
        rooms.leave(peer, true);
        peers.delete(peer.id);
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const peer of connections) {
      if (Date.now() - peer.lastSeen > 12000) {
        peer.ws.terminate();
        continue;
      }
      peer.pingSent = Date.now();
      send(peer, { type: "ping", t: peer.pingSent, rtt: peer.rtt });
    }
  }, CONFIG.PING_INTERVAL_MS);
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, options.host ?? "0.0.0.0", resolve);
  });
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;
  return {
    app,
    server,
    store,
    rooms,
    peers,
    matchmaker,
    port: actualPort,
    close: async () => {
      clearInterval(heartbeat);
      stopLoop();
      matchmaker.close();
      for (const peer of connections) peer.ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  startServer()
    .then((instance) => {
      console.log(
        `Splash Critters listening on http://localhost:${instance.port}`,
      );
      const shutdown = () => {
        void instance.close().then(() => process.exit(0));
      };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
