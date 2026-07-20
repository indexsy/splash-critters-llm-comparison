# 💦 Splash Critters

An **8-bit online water-balloon battler**. Cute pixel animals drop water balloons that
burst into cross-shaped splashes, washing away sandcastles and soaking opponents.
Last critter dry wins. Up to 4 players online, server-side AI bots in casual play,
ranked Elo matchmaking for 1v1 and 4-player free-for-all, a public room browser,
guest accounts, XP/levels, and cosmetics — all original, no external assets.

This is a complete, shippable game: one Node process serves the built client, a
WebSocket game server, a REST API, and a SQLite database.

---

## Quick start

```bash
npm install            # installs workspaces (builds native better-sqlite3)
npm run dev            # server on :3000, client (Vite) on :5173 with hot reload
```

Open **http://localhost:5173**. A guest account is created automatically.

Production (single port):

```bash
npm run build          # builds client (Vite) + bundles server (esbuild)
npm start              # serves everything on PORT (default 3000)
```

Other scripts:

```bash
npm test               # Vitest: sim (chains/splash/determinism) + Elo fixtures
npm run soak           # headless bot-vs-bot soak: full matches, no crash/desync
npm run typecheck      # tsc project references across all packages
```

---

## How to play

- **Move**: WASD or Arrow keys
- **Drop a balloon**: Space or E (fuse = 3s, bursts into a cross-shaped splash)
- **Emotes**: 1–4 (quack / ribbit / squeak / honk)
- **Mute**: M

Splashes wash away the first sandcastle per direction and stop; some castles hide
power-ups (Extra Balloon, Big Splash, Flippers, Rubber Boots). A splash that touches
another balloon bursts it instantly — line them up for **DOUBLE / TRIPLE SPLASH!**
At 2:00 the **Rising Tide** floods the arena inward. Eliminated players in casual ride
**Revenge Ducks** around the border and can lob balloons to stay in the fun.

---

## Architecture

npm-workspaces monorepo, TypeScript (strict, ES modules) everywhere.

```
packages/
├─ shared/   zero-dep pure TS — the deterministic core
│  ├─ config.ts     single typed CONFIG (all tunables)
│  ├─ types.ts      GameState + entities
│  ├─ rng.ts        mulberry32 seeded PRNG (only source of randomness)
│  ├─ map.ts        deterministic arena + pre-rolled hidden power-ups
│  ├─ state.ts      round state construction + deep clone (for prediction)
│  ├─ burst.ts      balloon burst + splash + chain cascade (BFS + union-find)
│  ├─ tide.ts       rising tide + revenge ducks
│  ├─ sim.ts        simulateTick(state, inputs) — runs identically on both sides
│  ├─ elo.ts        duel + pairwise-FFA Elo (pure, unit-tested)
│  └─ protocol.ts   discriminated-union wire messages + DTOs
├─ server/  ws + express + SQLite + bots + matchmaker + Elo
│  ├─ index.ts      one process: static client + REST + /health + /ws
│  ├─ net.ts        per-connection rate limiting + held-input tracking
│  ├─ room.ts       lobby, slots (human/bot/closed), disconnect grace, rematch
│  ├─ match.ts      per-match runtime: snapshots (15Hz), events (30Hz), rounds
│  ├─ gameLoop.ts   central fixed 30Hz tick + matchmaker + GC + ping
│  ├─ matchmaker.ts ranked queues, widening rating window, humans-only
│  ├─ results.ts    placements, awards, Elo, XP, persistence
│  ├─ bots/         dangerMap.ts (chain-propagating) + bot.ts (BFS AI)
│  └─ db/           better-sqlite3 (WAL), numbered migrations, typed queries
└─ client/  Vite + vanilla TS, Canvas 2D, Web Audio (no framework)
   └─ src/
      ├─ prediction.ts   client prediction + replay reconciliation + interpolation
      ├─ render/         procedural pixel sprites, particles, world, HUD
      ├─ audio.ts        chiptune synth (oscillators + noise)
      └─ screens/        title, tutorial, menu, browser, lobby, queue, game,
                         results, leaderboard, locker, settings, howto
```

### Netcode (server-authoritative)

- Server simulates at a fixed **30Hz**; snapshots stream at **15Hz**.
- Clients send inputs only. The **local player** is predicted with the exact shared
  sim and replay-reconciled against snapshots (no rubber-band drag); **remote**
  entities interpolate at `serverTime − 100ms`.
- Anti-cheat: the server validates movement/collision/tile occupancy, rate-limits
  messages, and never trusts client-reported positions.
- Same map seed ⇒ identical grid **and** identical hidden power-up contents on both
  sides (pre-rolled at map generation), so prediction and replays always agree.

### Bots (casual & practice only — never ranked)

A **danger map** is recomputed each tick: for every live balloon (including sliding
kicked ones) it marks splash tiles with a chain-propagated time-to-burst; tide tiles
are permanently unsafe. Each bot flees imminent danger, never drops a balloon without
a verified reachable escape (budgeted against the *chain-effective* burst, not just
the fuse), then farms / collects / hunts. Easy misjudges danger and places recklessly;
Hard makes no mistakes and hunts — so **Hard reliably beats Easy** (~70% over the soak).

---

## REST API

- `GET /health` → `{ ok, tick, rooms }`
- `GET /api/leaderboard?mode=duel|ffa` → top 100 with tier + winrate
- `GET /api/profile/:id` → ratings, level, unlocks, recent matches

---

## Deploy

Single Node process behind a reverse proxy that supports `wss://`. SQLite persists at
`$DATA_DIR/splash.db` (mount a volume for durability).

### Docker

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data splash-critters
```

The image builds the client + server, reinstalls production deps (rebuilding native
`better-sqlite3`), and runs on `PORT` (default 3000) with `/data` as a volume.

### Railway / Fly / Render

- Build: `npm run build`  ·  Start: `npm start`
- Set `PORT` (most platforms inject it) and `DATA_DIR=/data` with a mounted volume.
- Ensure WebSocket upgrades are allowed (they share the HTTP port at `/ws`).

Environment variables:

| var        | default | purpose                                    |
|------------|---------|--------------------------------------------|
| `PORT`     | `3000`  | HTTP + WebSocket port                      |
| `DATA_DIR` | `./data`| SQLite location (mount a volume in prod)   |
| `CLIENT_DIR` | `packages/client/dist` | built client to serve      |

---

## Accounts

Lightweight and password-free: the first visit generates a device token stored in
`localStorage`; the server keeps a hash and issues a guest account
(e.g. `SoggyOtter#4821`). Set a nickname before ranked play. **Losing the token means
losing the account** — noted in Settings.

---

## Testing

- **Vitest** (`npm test`): 3-balloon chain bursts in one tick, splash stops at the
  first sandcastle, boulders block, identical seed ⇒ identical map + hidden power-ups,
  full sim determinism under scripted inputs, and Elo fixtures (duel + 4-player
  pairwise).
- **Soak** (`npm run soak`): headless bot-vs-bot — a mixed FFA and a 4-Hard FFA
  complete without crashing or freezing, Hard bots almost never soak themselves, and
  Hard reliably beats Easy over 30 duels.

---

## License

Original work. All art is procedural / embedded pixel data; all audio is synthesized.
No third-party game assets, names, or characters are referenced.
