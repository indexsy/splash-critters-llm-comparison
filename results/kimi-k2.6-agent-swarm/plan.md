# Splash Critters Build Plan

## Architecture
Monorepo: `shared` (pure TS, zero deps) → `server` (Express + ws + better-sqlite3) + `client` (Vite + vanilla TS + Canvas 2D)

## Phase 1: Shared Package (Foundation)
**Goal:** All core game logic, types, protocol, config, RNG, Elo math — Vitest green.

- **Agent Shared_Foundation** → `packages/shared/src/`:
  - `config.ts` — single typed CONFIG object with all game constants
  - `types.ts` — all domain types (Player, Balloon, Splash, PowerUp, Arena, GameState, etc.)
  - `rng.ts` — mulberry32 seeded PRNG
  - `protocol.ts` — C→S and S→C discriminated union message types
  - `elo.ts` — pure Elo functions (Duel standard, FFA pairwise) + unit tests
  - `index.ts` — exports all shared modules

- **Agent Shared_Core** → `packages/shared/src/`:
  - `map.ts` — map generator from seed (arena layout, boulders, sandcastles, spawn zones, hidden power-ups)
  - `sim.ts` — deterministic tick simulation: player movement, balloon placement, fuse countdown, splash propagation (BFS chains), power-up collection, tide rising, kick physics, collision resolution
  - Vitest tests for sim: chain bursts, splash stopping at first sandcastle, determinism, RNG consistency

## Phase 2: Server + Client (Parallel)
**Goal:** Full networked game, lobby system, ranked matchmaking, bots, UI screens.

- **Agent Server** → `packages/server/src/`:
  - `db/` — SQLite migrations, query helpers
  - `index.ts` — Express + ws server, static file serving, health check
  - `net.ts` — WebSocket validation, rate limiting, message parsing
  - `rooms.ts` — room lifecycle, casual/public/private rooms, slot management, rematch voting
  - `gameLoop.ts` — server tick loop (30Hz), snapshot generation (15Hz), input application
  - `matchmaker.ts` — ranked queues, Elo-based matching, widening search
  - `elo.ts` — apply/persist Elo changes, update ratings/leaderboard
  - `bots/dangerMap.ts` — tile danger computation with chain propagation
  - `bots/bot.ts` — Easy/Medium/Hard bot decision loops

- **Agent Client** → `packages/client/src/`:
  - `main.ts` — entry point, screen router, game loop
  - `net.ts` — WebSocket connection, message handling, ping/pong
  - `prediction.ts` — client-side prediction, rewind-replay reconciliation, interpolation
  - `audio.ts` — Web Audio API sound synthesis (oscillators, noise, chiptunes)
  - `render/sprites.ts` — procedural pixel art (animals, hats, balloons, tiles, power-ups)
  - `render/hud.ts` — in-match HUD, kill feed, round score
  - `render/particles.ts` — splash droplets, soak effects, castle crumble particles
  - `screens/` — title, tutorial, menu, browser, lobby, queue, game, results, leaderboard, locker, settings

## Phase 3: Integration
**Goal:** Deployable, tested, playable end-to-end.

- Dockerfile, soak-test script, README with deploy steps
- Fix any compilation issues, run tests, verify acceptance criteria

## Build Order per Milestones
1. M1: Core sim (shared + local debug) → Phase 1
2. M2: Netcode (2 tabs, prediction) → Phase 2 server/client net
3. M3: Bots online → Phase 2 server bots
4. M4: Lobby system → Phase 2 server rooms + client screens
5. M5: Ranked → Phase 2 server matchmaker + db + client screens
6. M6: Full product → Phase 3 + all client screens + audio + cosmetics
