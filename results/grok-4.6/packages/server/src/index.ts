import express from "express";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { CONFIG, tierForRating } from "@splash/shared";
import { leaderboard, loadProfile, openDb, recentMatches } from "./db/index.js";
import { tickMatchmaker } from "./matchmaker.js";
import { GameSession } from "./gameLoop.js";
import { attachWs, makeDbApi } from "./net.js";
import { bindSessionFactory, gcRooms, tickRooms } from "./rooms.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");

const db = openDb(DATA_DIR);
const api = makeDbApi(db);
bindSessionFactory((room, d) => new GameSession(room, d));

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get("/api/leaderboard", (req, res) => {
  const mode = req.query.mode === "ffa" ? "ffa" : "duel";
  const rows = leaderboard(db, mode, 100);
  res.json(
    rows.map((r, i) => ({
      rank: i + 1,
      nickname: r.nickname,
      tag: r.tag,
      rating: r.rating,
      tier: tierForRating(r.rating).name,
      games: r.games,
      winrate: r.games ? Math.round((r.wins / r.games) * 100) : 0,
    })),
  );
});

app.get("/api/profile/:id", (req, res) => {
  const p = loadProfile(db, req.params.id);
  if (!p) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ ...p, recent: recentMatches(db, p.id, 10) });
});

const clientDist = join(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/ws") || req.path.startsWith("/health")) {
    next();
    return;
  }
  res.sendFile(join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
attachWs(wss, db);

setInterval(() => tickRooms(), 1000 / CONFIG.TICK_RATE);
setInterval(() => tickMatchmaker(api), CONFIG.MM_TICK_MS);
setInterval(() => gcRooms(), 30_000);

server.listen(PORT, () => {
  console.log(`Splash Critters listening on :${PORT}`);
});
