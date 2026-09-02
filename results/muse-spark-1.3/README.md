# Splash Critters — 8-bit Online Water Balloon Battler

Cute pixel animals drop **water balloons** that burst into cross-shaped **splashes**. Last critter dry wins. Up to 4 players online, server-side AI bots, ranked Elo (Duel 1v1 + FFA 4p), public room browser, accounts, progression, cosmetics.

## Quickstart

```sh
npm install
npm run dev        # server :3000 + client :5173 (vite proxies /ws and /api)
```

Open http://localhost:5173 — a guest account is auto-created, then play the tutorial.

Artificial latency test: http://localhost:5173/?latency=150

## Production (one port)

```sh
npm run build && npm start   # serves client + ws + api on $PORT (default 3000)
```

- `GET /health` → `{ok:true}`
- `GET /api/leaderboard?mode=duel|ffa`
- `GET /api/profile/:id`
- `POST /api/tutorial` `{token}` → +50 XP
- WebSocket at `/ws` (JSON protocol in `packages/shared/src/protocol.ts`)

## Deploy (Railway / Fly / Render)

Single Node process + SQLite file. Mount a volume at `/data` (or set `DATA_DIR`):

```sh
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data -e PORT=3000 splash-critters
```

Railway: deploy from repo, add volume mounted at `/data`. Fly: `[[mounts]] destination="/data"`. Behind a reverse proxy it speaks `wss://` automatically (same port upgrade at `/ws`).

## Controls

WASD/arrows move · Space/E balloon · 1–4 emotes · M mute. Desktop web only for v1.

## Tests

```sh
npm test --workspace=packages/shared   # sim + elo fixtures
npm run soak --workspace=packages/server  # headless bot-vs-bot full matches
```
