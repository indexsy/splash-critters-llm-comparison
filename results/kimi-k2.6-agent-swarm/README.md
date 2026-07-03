# Splash Critters

An 8-bit online arena battler where cute pixel animals drop water balloons that burst into cross-shaped splashes, washing away sandcastles and soaking opponents. Last critter dry wins!

## Tech Stack

- **Language:** TypeScript 5.x, strict mode, ES modules
- **Runtime:** Node.js ≥ 20 LTS
- **Monorepo:** npm workspaces (`shared`, `server`, `client`)
- **Server:** Express + WebSocket (`ws`), SQLite via `better-sqlite3`
- **Client:** Vite 5 + vanilla TypeScript, Canvas 2D rendering, Web Audio API
- **Testing:** Vitest (shared sim + Elo math)

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode (server :3000, client :5173)
npm run dev

# Build for production
npm run build

# Start production server (serves everything on one port)
npm start

# Run tests
npm test

# Run soak test (headless bot-vs-bot)
node scripts/soak-test.mjs
```

## Project Structure

```
splash-critters/
├── package.json
├── tsconfig.base.json
├── Dockerfile
├── plan.md
├── SPEC.md
├── scripts/
│   └── soak-test.mjs
└── packages/
    ├── shared/
    │   └── src/
    │       ├── config.ts      # All game constants
    │       ├── types.ts       # Domain types
    │       ├── rng.ts         # Mulberry32 PRNG
    │       ├── map.ts         # Map generator
    │       ├── sim.ts         # Deterministic tick simulation
    │       ├── protocol.ts    # C→S / S→C message types
    │       ├── elo.ts         # Elo math + tests
    │       └── index.ts       # Re-exports
    ├── server/
    │   └── src/
    │       ├── index.ts       # Express + WS entry point
    │       ├── net.ts         # WebSocket connection manager
    │       ├── rooms.ts       # Room lifecycle
    │       ├── gameLoop.ts    # Server tick loop (30Hz)
    │       ├── matchmaker.ts  # Ranked queue matching
    │       ├── elo.ts         # Elo apply/persist
    │       ├── db/
    │       │   ├── migrations/
    │       │   │   ├── 001_initial.sql
    │       │   │   └── 002_indices.sql
    │       │   └── queries.ts # All SQLite queries
    │       └── bots/
    │           ├── dangerMap.ts # Tile danger computation
    │           └── bot.ts      # Easy/Medium/Hard AI
    └── client/
        ├── index.html
        ├── vite.config.ts
        └── src/
            ├── main.ts         # Entry point, screen manager
            ├── net.ts          # WebSocket client
            ├── prediction.ts   # Client prediction + interpolation
            ├── audio.ts        # Web Audio API synthesizer
            ├── render/
            │   ├── sprites.ts  # Procedural pixel art
            │   ├── hud.ts      # In-match HUD
            │   └── particles.ts # Particle effects
            └── screens/
                ├── title.ts
                ├── tutorial.ts
                ├── menu.ts
                ├── browser.ts
                ├── lobby.ts
                ├── queue.ts
                ├── game.ts
                ├── results.ts
                ├── leaderboard.ts
                ├── locker.ts
                └── settings.ts
```

## Game Modes

- **Duel (1v1):** 13×11 arena, first to 3 round wins
- **Free-for-All (4p):** 15×13 arena, first to 3 round wins
- **Ranked:** Separate Elo queues for Duel and FFA, matchmaker with widening search
- **Casual:** Public room browser, private rooms with codes, bot fill

## Key Features

- **Server-authoritative netcode:** 30Hz tick, 15Hz snapshots, client prediction with rewind-replay
- **Chain splashes:** Balloons touched by splashes burst immediately, cascading up to huge combos
- **Rising Tide:** Sudden death at 2:00, water floods inward from the perimeter
- **Balloon Kick:** Rare Rubber Boots power-up lets you kick sliding balloons
- **Revenge Ducks:** Eliminated players ride rubber duckies and lob revenge balloons (casual only)
- **Progression:** XP per match, levels unlock animals and hats in the Locker
- **Bots:** Easy/Medium/Hard AI with full danger map awareness and escape verification

## Deploy

### Docker

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data -e DATA_DIR=/data splash-critters
```

### Railway / Fly / Render

1. Push repo to Git
2. Connect to platform
3. Set `DATA_DIR` environment variable (e.g., `/data`)
4. Add a persistent volume mounted at `DATA_DIR`
5. Deploy — the server listens on `PORT` (default 3000)

The single Node process serves the static client build and WebSocket API on the same port, suitable for deployment behind any reverse proxy.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP + WebSocket server port |
| `DATA_DIR` | `./data` | SQLite database directory |
| `NODE_ENV` | `development` | Set to `production` for optimized builds |

## Acceptance Criteria

- ✅ Fresh browser: guest auto-created → tutorial completes → main menu
- ✅ Tab A creates public 4p room with bots; Tab B joins via browser; match completes
- ✅ Tabs A+B queue ranked Duel → matched → finish → ratings update in SQLite
- ✅ 150ms artificial latency: local movement feels instant, no rubber-banding
- ✅ Vitest passes: 3-balloon chain, splash stops at first sandcastle, determinism, Elo fixtures
- ✅ Bots never freeze or soak themselves; Hard reliably beats Easy
- ✅ `npm run build && npm start` serves everything on one port
- ✅ Dockerfile deploys with SQLite persisting on a volume

## License

MIT — original game, do not reference or copy Bomberman assets, names, or characters.
