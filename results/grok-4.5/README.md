# Splash Critters

8-bit online water balloon arena battler. Cute pixel animals drop water balloons that burst into cross-shaped splashes, washing away sandcastles and soaking opponents. Last critter dry wins.

## Stack

- **TypeScript** monorepo (`shared` / `server` / `client`)
- **shared** — pure deterministic sim, map gen, Elo, protocol
- **server** — Express + `ws`, SQLite (`better-sqlite3`), bots, matchmaker
- **client** — Vite + Canvas 2D + Web Audio (no React/Phaser)

## Quick start

```bash
npm install
npm run dev
```

- Client: http://localhost:5173  
- Server: http://localhost:3000 (`/ws`, `/api`, `/health`)

Production (single port):

```bash
npm run build
npm start
# → http://localhost:3000
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Server + Vite client |
| `npm run build` | Build all packages |
| `npm start` | Serve client + API + WS on `PORT` |
| `npm test` | Vitest (sim + Elo) |
| `npm run soak` | Headless bot-vs-bot full match |

## Game modes

- **Duel (1v1)** — 13×11, first to 3 rounds  
- **Free-for-All (4p)** — 15×13, first to 3 rounds  
- **Ranked** — Elo matchmaking (no bots)  
- **Casual** — public room browser, private codes, bot slots  
- **Practice** — solo vs bots  

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrows | Move |
| Space / E | Drop balloon |
| 1–4 | Emotes |
| M | Mute |
| Esc | Back / leave |

Dev: append `?latency=150` for artificial lag testing.

## Deploy

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data splash-critters
```

Environment:

| Var | Default | Description |
|-----|---------|-------------|
| `PORT` | `3000` | HTTP + WS port |
| `DATA_DIR` | `./data` | SQLite directory (`splash.db`) |
| `ARTIFICIAL_LATENCY` | — | Optional ms delay (server-wide) |

Works behind a reverse proxy with `wss://` (Railway / Fly / Render). Mount a volume on `DATA_DIR` so ratings persist.

## Architecture

- Server sim **30 Hz**; snapshots **15 Hz**; client inputs **30 Hz**
- Client prediction + rewind-replay; remote interpolation at `−100 ms`
- Map power-ups pre-rolled from `mapSeed` (hidden until revealed)
- Chain bursts resolve in one tick via BFS
- Rising Tide sudden death at 2:00

## Accounts

Guest UUID device token in `localStorage` — no passwords. Losing the token loses the account (see Settings).
