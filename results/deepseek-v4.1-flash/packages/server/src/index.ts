import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import type { GameMode } from "@splash/shared";
import { leaderboard, openDatabase, profileForId, recentMatches } from "./db/index.js";
import { Hub } from "./hub.js";
import { NetServer } from "./net.js";
import { GameLoop } from "./gameLoop.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const dataDir = path.resolve(process.env.DATA_DIR ?? "data");
const isProduction = process.env.NODE_ENV === "production";
const fakeLatency = Number(process.env.FAKE_LATENCY_MS ?? 0);
const clientDir = fileURLToPath(new URL("../../client/dist", import.meta.url));

const db = openDatabase(dataDir);
const hub = new Hub(db);
const app = express();
app.disable("x-powered-by");

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    rooms: hub.rooms.allRooms().length,
  });
});

app.get("/api/leaderboard", (req, res) => {
  const raw = String(req.query.mode ?? "duel");
  const mode: GameMode = raw === "ffa" ? "ffa" : "duel";
  const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 100) || 100));
  res.json({ mode, entries: leaderboard(db, mode, limit) });
});

app.get("/api/profile/:playerId", (req, res) => {
  const profile = profileForId(db, req.params.playerId);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json({
    profile,
    ratings: profile.ratings,
    recentMatches: recentMatches(db, profile.id).map((match) => ({
      ...match,
      ranked: Boolean(match.ranked),
    })),
    unlocks: profile.unlocks,
  });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

if (fs.existsSync(clientDir)) {
  app.use(
    express.static(clientDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
        else if (/\.(js|css|png|webp|ogg|mp3|woff2?)$/u.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

const server = http.createServer(app);
const net = new NetServer(
  server,
  {
    connect: (connection) => hub.connect(connection),
    message: (connection, message) => hub.handleMessage(connection, message),
    disconnect: (connection) => hub.disconnect(connection),
  },
  {
    latencyMs: Number.isFinite(fakeLatency) ? fakeLatency : 0,
    allowClientLag: !isProduction || process.env.ALLOW_CLIENT_LAG === "1",
  },
);
hub.attachNet(net);

const loop = new GameLoop(
  () => hub.gameTick(),
  (elapsed) => console.warn(`[loop] lag spike ${Math.round(elapsed)}ms`),
);
loop.start();
hub.startTimers();

server.listen(port, host, () => {
  console.log(`Splash Critters listening on http://${host}:${port}`);
  if (!isProduction) console.log(`Dev latency override available with ?lag=<ms>`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${signal})`);
  loop.stop();
  hub.closeNet();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
