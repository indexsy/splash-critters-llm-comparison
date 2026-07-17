# Splash Critters

An 8-bit online arena battler. Cute pixel critters drop water balloons that burst into cross-shaped splashes, washing away sandcastles and soaking opponents. Last critter dry wins.

Up to 4 players online, server-side bots, ranked Elo matchmaking (1v1 Duel and 4-player FFA), public room browser, accounts, XP/levels, and cosmetic unlocks.

## Tech

- TypeScript strict everywhere, npm workspaces monorepo
- `packages/shared` — zero-dep pure TS: CONFIG, types, seeded PRNG (mulberry32), map gen, deterministic `simulateTick`, Elo math. Same code powers the server (authority) and client (prediction).
- `packages/server` — Node ≥20, `ws` + `express` on one port, SQLite via `better-sqlite3` (WAL, numbered migrations at boot, `DATA_DIR/splash.db`).
- `packages/client` — Vite 5 + vanilla TS, Canvas 2D (256×224 integer-scaled), Web Audio chiptunes. No frameworks.

## Run locally

```bash
npm install
npm run build      # builds shared, server, client
npm start          # serves everything on http://localhost:3000
```

Dev mode (hot reload, server :3000 + client :5173 with /ws and /api proxied):

```bash
npm run dev
```

## Tests & checks

```bash
npm test           # Vitest: sim chains, splash blocking, seed determinism, Elo fixtures
npm run soak       # headless bot-vs-bot full matches (crash/desync check, Hard vs Easy sanity)
npm run typecheck
```

Artificial latency for netcode testing:

```bash
ARTIFICIAL_LATENCY_MS=150 npm start
```

## Deploy (Docker / Railway / Fly / Render)

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data splash-critters
```

- Single Node process, one `PORT` (default 3000), WebSocket on `/ws` (works behind a reverse proxy with `wss://`).
- SQLite persists on the mounted `/data` volume (`DATA_DIR` env).
- Health check: `GET /health`.
- On Railway/Render: set the start command to `npm start`, add a volume mounted at `/data`.

## How to play

- **Move**: WASD / arrows. **Drop balloon**: Space or E. **Emotes**: 1–4. **Mute**: M.
- Balloons burst in a cross after 3s. Boulders block splashes; sandcastles stop them (and get washed away, sometimes revealing power-ups).
- Chain balloons for DOUBLE/TRIPLE splashes. Rubber Boots let you kick balloons.
- At 2:00 the tide rises ring by ring — stay dry, last critter standing wins the round.
- Ranked: set a nickname first. Duel and FFA have separate Elo ratings and tiers (Puddle → Tsunami).
