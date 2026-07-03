// index.ts — server entry. One Node process: ws + express + REST + /health on PORT.
// Spec §1: single port, serves built client in production, REST API, /health.
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db/index.js";
import { attachWs, matchmaker, gcRooms } from "./net.js";
import { leaderboard, profile } from "./db/queries.js";
import { tierFor, type GameMode } from "@splash/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), ".data");

mkdirSync(DATA_DIR, { recursive: true });
openDb(DATA_DIR);

const app = express();
app.use(express.json());

// REST API (spec §5)
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.get("/api/leaderboard", (req, res) => {
  const mode = (req.query.mode === "ffa" ? "ffa" : "duel") as GameMode;
  const rows = leaderboard(mode, 100);
  res.json({
    mode,
    entries: rows.map((r, i) => ({
      rank: i + 1,
      id: r.id,
      nickname: r.nickname,
      tag: r.tag,
      rating: r.rating,
      tier: tierFor(r.rating),
      games: r.games,
      winrate: r.games > 0 ? r.wins / r.games : 0,
    })),
  });
});

app.get("/api/profile/:id", (req, res) => {
  const p = profile(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  res.json(p);
});

// Serve built client in production (client dist is copied to packages/server/public at build)
const clientDist = join(__dirname, "..", "public");
app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
  res.sendFile(join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
attachWs(wss);

matchmaker.start();
setInterval(gcRooms, 60_000);

server.listen(PORT, () => {
  console.log(`[splash] listening on :${PORT}  (ws /ws, rest /api, health /health)`);
});
