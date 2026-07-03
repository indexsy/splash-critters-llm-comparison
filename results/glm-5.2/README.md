# Splash Critters 🌊🎈

An 8-bit online water-balloon arena battler. Drop balloons that burst into cross-shaped splashes, wash away sandcastles, chain bursts for combos, and soak your friends. Last critter dry wins.

Original game — no third-party assets. All art is procedural pixel data; all audio is Web Audio synthesis.

> Working title. The deterministic shared simulation, server authority, bots, Elo, and full client are implemented end-to-end and verified by automated tests.

---

## Tech stack

- **TypeScript 5** strict, ES modules everywhere
- **Monorepo** (npm workspaces): `shared` · `server` · `client`
- **shared** — zero-dep pure TS: deterministic sim, seeded map gen, Elo, protocol. Same code runs on server (authority) and client (prediction)
- **server** — Node ≥ 20, `ws` + `express` on one port, **SQLite via better-sqlite3** (WAL, numbered migrations)
- **client** — Vite 5 + vanilla TS, Canvas 2D, Web Audio (no React, no Phaser)
- **Testing** — Vitest (sim + Elo), headless bot-vs-bot soak, WS integration test

## Quick start

```bash
npm install          # workspaces install all three packages

# Development (two ports): server :3000, client :5173 with proxy
npm run dev

# Production (single port): builds shared → client → stages into server/public → server
npm run build && npm start        # serves on :3000 (PORT env to override)
```

Open `http://localhost:3000` (prod) or `http://localhost:5173` (dev).

### Scripts
| script | what it does |
|---|---|
| `npm run dev` | server (:3000) + vite client (:5173) concurrently |
| `npm run build` | build shared, client, stage client into server/public, build server |
| `npm start` | run the single-port production server |
| `npm test` | Vitest (sim chains, splash stop, seed determinism, Elo fixtures) |
| `npm run soak` | headless 4-bot FFA match — must complete with a winner, no crash |
| `npm run build:stage-client` | copy client dist → server/public |

## How to play

- **Move:** WASD or Arrow keys
- **Drop balloon:** Space or E
- **Mute:** M
- Balloons fuse for 3s, then burst into a **cross-shaped splash**. Splash washes the first sandcastle per direction and stops; boulders block it. Anyone caught in the splash is **soaked** (eliminated).
- **Chain bursts:** a balloon caught in another balloon's splash bursts in the same tick — set up cascades for "DOUBLE!" / "TRIPLE!" combos.
- **Power-ups** hide inside sandcastles: Extra Balloon, Big Splash, Flippers (speed), Rubber Boots (kick).
- **Rising Tide:** at 2:00 the arena floods inward — don't get caught.
- First to **3 round wins** takes the match.

## Modes
- **Duel (1v1)** — 13×11, ranked Elo.
- **Free-for-All (4p)** — 15×13, ranked with pairwise Elo.
- **Casual** — public room browser, private rooms (6-char code `/#/room/CODE`), create with options (size/theme/rounds/bot-fill/per-slot difficulty).
- **Practice** — instant solo room filled with bots.

Ranked uses humans-only matchmaking (±100 widening to ±400). Casual disconnects convert to a Medium bot after a grace period.

## Architecture

```
shared/src
  config.ts     single typed CONFIG (all tunables)
  types.ts      pure data types
  rng.ts        mulberry32 seeded PRNG (deterministic)
  map.ts        arena + boulders + sandcastles + HIDDEN pre-rolled power-ups
  sim.ts        simulateTick — movement, balloons, cross-splash, single-tick
                chain cascade (BFS), power-ups, kick-sliding, rising tide
  elo.ts        pure Elo (duel + FFA pairwise)
  protocol.ts   C→S / S→C discriminated unions

server/src
  db/           SQLite (WAL) + numbered migrations + queries (accounts, ratings, matches)
  bots/         dangerMap (per-tile time-to-burst w/ chain inheritance) + 3 difficulties
  rooms.ts      Room (lobby slots) + MatchRun (authoritative 30Hz sim loop)
  matchmaker.ts ranked queues, ±range widening, queue_status
  net.ts        WS validation, rate limiting, message dispatch, room registry
  index.ts      one-port entry: ws + express + REST + /health

client/src
  net.ts        WS reconnect + typed protocol
  prediction.ts local-player prediction + rewind-replay reconciliation
  audio.ts      Web Audio chiptune SFX (drop/burst/chain/pickup/soak/tide/victory)
  render/       procedural pixel sprites, HUD, particles
  screens/      title/menu/browser/create/join/lobby/queue/game/results/leaderboard/locker/settings/howto
  main.ts       wiring: net → profile → screen router → game screen
```

### Netcode (server-authoritative)
Server sim at **30Hz**; snapshots at **15Hz**; clients send inputs only (sampled 60Hz, sent 30Hz). The local player predicts with the shared sim and reconciles on each snapshot by rewinding and replaying the unacked input buffer (~1s). Remote entities interpolate at `serverTime − 100ms`. Anti-cheat: server validates movement/collision/balloon availability/tile occupancy and rate-limits 60 msgs/sec; it never trusts client positions.

### Hidden power-ups (unguessable)
Power-up contents are **pre-rolled at map generation** from the round's seeded PRNG and stored server-side. They are never included in client snapshots until a sandcastle is washed away and a `powerup_revealed` event fires. Identical seed ⇒ identical contents (replay/test-friendly), but clients cannot know them ahead of time.

## Persistence & accounts
Lightweight, token-based (no passwords in v1). First visit mints a device token (localStorage) + a guest name like `SoggyOtter#4821`. SQLite stores players, ratings, matches, unlocks. `DATA_DIR` (default `./.data`, `/data` in Docker) holds `splash.db` — mount a volume to persist.

## Deploy (Docker / Railway / Fly / Render)
```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data splash-critters
```
Behind a reverse proxy, terminate TLS and proxy `wss://` to the single port. `DATA_DIR` must point at a mounted volume so SQLite persists.

## Verification (acceptance criteria)
```bash
npm test          # 12 sim + Elo tests
npm run soak      # full bot match completes, no crash/desync
# integration test (needs a running server):
PORT=3470 DATA_DIR=./.data node packages/server/dist/index.js &
npx tsx packages/server/src/scripts/e2e.ts 3470
```
- **Sim:** 3-balloon chain bursts in one tick; splash stops at the first sandcastle; identical seed ⇒ identical map + hidden contents.
- **Elo:** duel + FFA pairwise match fixture values; FFA is zero-sum; tied placements yield equal deltas.
- **Bots:** never freeze or soak themselves; Hard reliably wins (soak-test winner is a Hard bot).
- **Full flow:** two WS clients → room browser join → bot-filled match → snapshots flow.
- **One port:** `npm run build && npm start` serves client + API + health on a single port.

## Status & next steps
This is a complete, runnable vertical slice implementing every milestone layer (M1–M6) of the spec: deterministic sim, server authority, three bot difficulties, matchmaking, Elo, accounts, the room system, client prediction, full screen flow, procedural art, and audio. Remaining polish for a "1.0" release is incremental and localized to existing modules: tutorial scripting, emotes broadcast, revenge-duck lob controls, and deeper bot chain-burst engineering — none of which require re-architecting what's here.
