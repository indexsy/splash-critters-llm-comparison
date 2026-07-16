# Splash Critters

8-bit online water balloon arena battler. Cute pixel animals, cross-shaped splashes, sandcastles, ranked Elo, casual rooms, and bots.

## Stack

- **shared** — pure TypeScript sim (30Hz), map gen, Elo, protocol
- **server** — Node 20, `ws` + Express, SQLite (`better-sqlite3`), bots, matchmaker
- **client** — Vite 5, Canvas 2D, Web Audio (no React/Phaser)

## Quick start

```bash
npm install
npm run dev
```

- Client: http://localhost:5173  
- Server: http://localhost:3000 (`/health`, `/ws`, `/api/*`)

Production (single port):

```bash
npm run build
npm start
# open http://localhost:3000
```

## Tests

```bash
npm test          # shared sim + Elo fixtures
npm run soak      # headless bot-vs-bot full matches
```

## Deploy

Docker:

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data -e DATA_DIR=/data splash-critters
```

Env:

| Variable   | Default | Notes                          |
|-----------|---------|--------------------------------|
| `PORT`    | `3000`  | HTTP + WebSocket               |
| `DATA_DIR`| `./data`| SQLite file `splash.db` (WAL)  |

Works behind any reverse proxy that supports WebSockets (`wss://`).

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrows | Move |
| Space / E | Drop balloon |
| 1–4 | Emotes |
| M | Mute |

## Modes

- **Duel (1v1)** — 13×11, first to 3 rounds  
- **FFA (4p)** — 15×13, first to 3 rounds  
- **Ranked** — Elo matchmaking (humans only)  
- **Casual** — public browser, private codes, bot fill  

## Account note

Guest accounts use a device token in `localStorage`. No passwords in v1 — losing the token loses the account.
