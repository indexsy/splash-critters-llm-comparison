# Splash Critters

Splash Critters is an original online pixel-arena game about cute animals, water balloons, sandcastles, and staying dry. It supports casual public/private rooms, server-side bots, ranked Duel and four-player FFA, progression, cosmetics, leaderboards, and a guided first-run tutorial.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- A desktop browser with Canvas 2D, WebSocket, and Web Audio support

## Run Locally

```bash
npm install
npm run dev
```

The server runs at `http://localhost:3000`; Vite runs at `http://localhost:5173` and proxies `/api` and `/ws`. Open two browser tabs to test multiplayer. Add `?latency=150` to the Vite URL to simulate 150 ms latency in each direction.

## Production

```bash
npm run build
DATA_DIR=./data PORT=3000 NODE_ENV=production npm start
```

The Express server serves the built client, REST API, health endpoint, and WebSocket endpoint from one port. SQLite is stored at `$DATA_DIR/splash.db` in WAL mode.

Useful endpoints:

- `GET /health`
- `GET /api/leaderboard?mode=duel`
- `GET /api/leaderboard?mode=ffa`
- `GET /api/profile/:id`
- `WS /ws`

## Test

```bash
npm test
npm run soak
```

The unit suite covers deterministic map generation, hidden power-up rolls, splash blocking, three-balloon chains, Duel Elo, and pairwise FFA Elo. The soak script runs a complete deterministic bot FFA, checks that snapshots do not expose hidden drops, persists a match, and fails on stalls or crashes.

## Docker

```bash
docker build -t splash-critters .
docker run --rm -p 3000:3000 -v splash-data:/data splash-critters
```

For Railway, Fly.io, or Render, deploy the Dockerfile, expose the platform-provided `PORT`, and mount persistent storage at `/data`. TLS should terminate at the platform proxy; the browser automatically selects `wss://` on HTTPS pages.

## Controls

- Move: `WASD` or arrow keys
- Drop balloon: `Space`
- Revenge Duck lob: `E`
- Emotes: `1` through `4`
- Mute: `M`

Key bindings, sound levels, colorblind splashes, and reduced shake are configurable in Settings. The account is tied to the device token in local storage; clearing it loses access to that guest account.

## Architecture

- `packages/shared`: dependency-free deterministic simulation, seeded maps, protocol, configuration, and Elo
- `packages/server`: Express, `ws`, SQLite migrations/queries, rooms, matchmaking, bots, and the authoritative 30 Hz loop
- `packages/client`: Vite, vanilla TypeScript, Canvas 2D rendering, prediction/interpolation, procedural pixel art, and Web Audio

The server sends only dynamic snapshots plus the public castle grid. Hidden power-up contents remain authoritative and are revealed only when their sandcastles are washed away.
