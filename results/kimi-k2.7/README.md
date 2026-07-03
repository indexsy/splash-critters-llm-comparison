# Splash Critters

8-bit online water balloon battler. TypeScript monorepo with shared deterministic simulation, Node.js + WebSocket server, SQLite, and Vite vanilla client.

## Tech stack

- TypeScript 5.x strict, ES modules
- Node.js >= 20
- npm workspaces
- Server: `ws` + `express`, SQLite via `better-sqlite3`
- Client: Vite 5 + vanilla TS, Canvas 2D, Web Audio API

## Quick start

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000`.

For development with hot reload:

```bash
npm run dev
```

This runs the server on `:3000` and the Vite client dev server on `:5173` (proxies `/ws`, `/api`, `/health`).

## Tests

```bash
npm test
```

## Soak test

```bash
npm run build
npm run soak
```

Runs headless bot-vs-bot matches and verifies determinism/no crash.

## Deploy

A `Dockerfile` is included. SQLite persists on the `/data` volume.

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data splash-critters
```

Environment variables:

- `PORT` — server port (default 3000)
- `DATA_DIR` — SQLite path (default `./data`)

## Controls

- Move: WASD or Arrow keys
- Drop balloon: Space or E
- Mute: M
- Menu: Arrow keys + Enter / mouse click

## Architecture

- `packages/shared/` — pure TS: CONFIG, types, RNG, map generator, deterministic sim, protocol, Elo math, tests
- `packages/server/` — WebSocket/HTTP server, rooms, matchmaker, game loop, bots, SQLite persistence
- `packages/client/` — Vite canvas client, prediction, screens, audio

## License

Original game — do not copy Bomberman assets or names.
