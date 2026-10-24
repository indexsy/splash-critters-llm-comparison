# Splash Critters

An original 8-bit online water-balloon arena battler for desktop browsers. Up to four critters wash away sandcastles, chain cross-shaped splashes, collect power-ups, and dodge the Rising Tide.

## Requirements

- Node.js 20 LTS or newer LTS
- npm 10+
- A platform that supports `better-sqlite3` (prebuilt binaries or a C++ build toolchain)

## Develop

```sh
npm ci
npm run dev
```

The API/game server runs on `http://localhost:3000`; Vite serves the client on `http://localhost:5173` and proxies `/api`, `/health`, and `/ws`.

Useful checks:

```sh
npm test
npm run typecheck
npm run soak
```

The soak runs a full four-bot match twice in parallel, checks inputs/events/snapshots for divergence, then runs eight seeded Hard-versus-Easy duels with a win-rate gate.

## Production

```sh
npm run build
npm start
```

Everything is served on `PORT` (default `3000`): the built client, WebSocket endpoint `/ws`, REST API, and `/health`.

Environment variables:

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `3000` | HTTP/WebSocket port |
| `DATA_DIR` | `./data` | Directory containing `splash.db` and SQLite WAL files |
| `LATENCY_MS` | `0` | Artificial outbound server latency for development |

For client-side round-trip latency testing, open `/?latency=150`. Local prediction remains immediate; remote entities use delayed interpolation. Add `?dev=1` for the FPS/entity overlay.

## Docker

```sh
docker build -t splash-critters .
docker run --rm -p 3000:3000 -v splash-data:/data splash-critters
```

The database persists in `/data/splash.db`. The image uses Node 20, builds all three workspaces, prunes development dependencies, and includes a health check.

## Deployment

### Railway

1. Create a service from this repository and choose Dockerfile deployment.
2. Set `PORT=3000` and `DATA_DIR=/data`.
3. Add a persistent volume mounted at `/data`.
4. Expose the service through Railway's HTTPS proxy. WebSocket upgrades and `wss://` work on the same domain/port.

### Render

1. Create a Web Service using the Dockerfile.
2. Set health check path to `/health` and `DATA_DIR=/data`.
3. Add a persistent disk at `/data`.
4. Use the provided HTTPS URL; no separate WebSocket service is needed.

### Fly.io

1. Launch with `fly launch --dockerfile Dockerfile`.
2. Set `DATA_DIR=/data` and create/mount a volume at `/data`.
3. Ensure the HTTP service maps public ports 80/443 to internal port `3000`.
4. Deploy with `fly deploy`; keep the same volume between releases.

SQLite uses WAL mode and numbered migrations in `packages/server/src/db/migrations`. Run one application process per database volume.

## Controls

- Move: WASD or arrow keys
- Drop water balloon: Space or E
- Emotes: 1–4
- Mute: M
- Pause/leave menu: Escape

Controls can be remapped in Settings. The game also includes volume sliders, a colorblind-safe splash palette, and reduced screen shake.

## Accounts and data

Accounts are passwordless and tied to the browser's device token. The token is stored in `localStorage`; only its SHA-256 hash is stored server-side. Losing or clearing the token loses access to that account. No email, OAuth, password, or recovery flow exists in v1.

REST endpoints:

- `GET /api/leaderboard?mode=duel|ffa`
- `GET /api/profile/:id`
- `GET /health`

## Architecture

- `packages/shared`: dependency-free deterministic map generation, simulation, protocol, configuration, seeded PRNG, and Elo
- `packages/server`: Express, `ws`, SQLite migrations/queries, authoritative 30 Hz rooms, bots, matchmaker, ratings, and XP
- `packages/client`: Vite + vanilla TypeScript, Canvas 2D, prediction/reconciliation, interpolation, procedural sprites/particles, and Web Audio

Snapshots are sent at 15 Hz. Castle contents are rolled at map generation and are never sent to clients until revealed. Ranked rooms are human-only; casual disconnects become Medium bots after the reconnect grace period.
