# Splash Critters

An 8-bit online arena battler: cute pixel animals drop **water balloons** that
burst into cross-shaped **splashes**, washing away **sandcastles** and soaking
opponents. Last critter dry wins. Up to 4 players online, server-side bots,
ranked Elo matchmaking (1v1 + 4-player FFA), a public room browser, guest
accounts, XP/levels, and cosmetic unlocks. Original game — no third-party
assets, all art and audio are procedural.

## Quick start

```bash
npm install
npm run dev        # server on :3000, Vite client on :5173  → open http://localhost:5173
```

Production (one process, one port):

```bash
npm run build && npm start    # everything on http://localhost:3000
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Builds shared, runs server (tsx watch, :3000) + Vite client (:5173) |
| `npm run build` | Compiles shared + server (tsc) and client (Vite) |
| `npm start` | Serves the built client + WS + REST on `PORT` (default 3000) |
| `npm test` | Vitest: sim (chains, splash rules, determinism) + Elo fixtures |
| `npm run soak` | Headless bot-vs-bot matches; asserts completion & Hard ≥ Easy |
| `node scripts/e2e.mjs` | Full acceptance test over real WebSockets (spawns its own server) |
| `npm run typecheck` | Strict TS across all three packages |

Dev flags: `LATENCY_MS=150 npm run dev` adds artificial latency to every
message (test prediction/interpolation). `SPLASH_DB=:memory:` for a throwaway
database, `DATA_DIR=/somewhere` to relocate SQLite.

## Architecture

npm workspaces, three packages:

- **`packages/shared`** — zero-dependency pure TS: `CONFIG` (every tunable),
  seeded PRNG (mulberry32), deterministic map generator (castle contents are
  **pre-rolled at map gen** and never sent to clients until revealed),
  `simulateTick(state, inputs)`, protocol types, Elo math. Identical code runs
  on the server (authority) and client (prediction).
- **`packages/server`** — Node 20+, `express` + `ws` on one port. 30Hz
  authoritative sim, 15Hz snapshots, input validation + rate limiting,
  multi-room lobby system with a public browser, ranked matchmaker
  (±100 widening +50/10s to ±400), pairwise-Elo FFA, SQLite via
  `better-sqlite3` (WAL, numbered migrations at boot, stored in
  `DATA_DIR/splash.db`). Bots run server-side on a chain-aware danger map.
- **`packages/client`** — Vite + vanilla TS, Canvas 2D at 256×224 (integer
  scaled, pixelated). Client prediction with rewind/replay reconciliation for
  the local player; remote entities interpolate 100ms behind; Web Audio
  synth SFX + chiptune loops. No React, no Phaser, no assets.

### Netcode

Clients send inputs only (`{seq, tick, dir, balloon}` at 30Hz). The server
validates movement/collisions/balloon availability and never trusts client
positions. Snapshots carry dynamic state + per-client input ack; castle grids
arrive once per round; destruction/reveals stream as events. Ranked
disconnects get a 15s reconnect grace, then forfeit; casual disconnects
convert to a Medium bot (reconnect to take back over).

### Game rules (see `shared/src/config.ts` for every number)

13×11 (duel) / 15×13 (FFA) arenas; ~75% castle density; 3.0s fuses; splashes
linger 0.4s and chain-burst through other balloons in a single tick; power-ups
(Extra Balloon / Big Splash / Flippers / Rubber Boots kick) hide inside
castles at 30%; at 2:00 the **Rising Tide** floods one ring every ~1.5s;
soaked players in casual ride **revenge ducks** and lob from the border.
Ranked: Elo starts at 1000, K=64 first 10 games then 32, six tier badges
(Puddle → Tsunami).

## Deploy

Single Node process, works behind any `wss://`-terminating proxy
(Railway / Fly.io / Render):

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data splash-critters
```

- Set `PORT` if the platform injects one; mount a volume at `/data` (or set
  `DATA_DIR`) so SQLite persists across deploys.
- `GET /health` is the readiness probe.
- Desktop web only for v1 (keyboard controls, no touch).

## Controls

WASD / arrows to move · Space / E to drop · 1-4 emotes · M mute ·
Esc leaves (press twice in a match). Keys are remappable in Settings, which
also has a colorblind-safe splash palette and reduced screen shake.

## Accounts

Passwordless guest accounts: a device token in localStorage (plus a per-tab
session token so two tabs can play each other). Nickname (3-16 chars,
filtered, `#tag` suffix) required only for ranked. Losing the token loses the
account — Settings says so and offers a token copy button.
