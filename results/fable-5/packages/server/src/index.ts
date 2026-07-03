import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { migrate } from "./db/index.js";
import { leaderboard, profileResponse } from "./db/queries.js";
import { attachWebSocketServer } from "./net.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

migrate();

const app = express();
app.disable("x-powered-by");

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get("/api/leaderboard", (req, res) => {
  const mode = req.query.mode === "ffa" ? "ffa" : "duel";
  res.json({ mode, rows: leaderboard(mode) });
});

app.get("/api/profile/:id", (req, res) => {
  const id = String(req.params.id);
  if (id.length > 64) {
    res.status(400).json({ error: "bad id" });
    return;
  }
  const profile = profileResponse(id);
  if (!profile) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(profile);
});

// Serve the built client (single-process deploy). In dev, Vite serves the
// client on :5173 and proxies /ws + /api here instead.
const clientDist = [
  path.resolve(__dirname, "../../../../client/dist"), // running from dist/server/src
  path.resolve(__dirname, "../../client/dist"), // running from src via tsx
].find((p) => existsSync(path.join(p, "index.html")));
if (clientDist) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
} else {
  app.get("/", (_req, res) => {
    res.status(200).send("Splash Critters server running. Build the client for production, or use Vite dev on :5173.");
  });
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
attachWebSocketServer(wss);

httpServer.listen(PORT, () => {
  console.log(`[splash-critters] listening on :${PORT} (ws path /ws)`);
  if (process.env.LATENCY_MS) console.log(`[dev] artificial latency ${process.env.LATENCY_MS}ms`);
});
