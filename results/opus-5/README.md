# Splash Critters

An 8-bit online water balloon battler. Cute pixel animals drop water balloons that burst into
cross-shaped splashes, washing away sandcastles and soaking opponents. Last critter dry wins.

Up to four players online, server-side bots in casual play, ranked Elo matchmaking for 1v1 and
4-player free-for-all, a public room browser, lightweight accounts, progression and cosmetics.

```
Duel        13x11 arena, 1v1, first to 3 round wins
Free-for-All 15x13 arena, 4 players, first to 3 round wins
```

---

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` runs three watchers: the shared package compiler, the game server on
**http://localhost:3000**, and the Vite client on **http://localhost:5173** (which proxies
`/api` and `/ws` to the server). Open the client URL and play.

For a production-shaped run on a single port:

```bash
npm run build
npm start          # http://localhost:3000 serves the client, the API and the WebSocket
```

---

## Repository layout

```
splash-critters/
├─ package.json            npm workspaces root
├─ tsconfig.base.json      strict TS shared by every package
├─ Dockerfile              single Node process, SQLite on a volume
├─ scripts/dev.mjs         the three-process dev runner
└─ packages/
   ├─ shared/              zero dependencies, runs on server AND client
   │  └─ src/  config.ts types.ts rng.ts map.ts sim.ts sim/ protocol.ts elo.ts names.ts
   ├─ server/              express + ws + better-sqlite3
   │  └─ src/  index.ts net.ts rooms.ts room.ts match.ts snapshot.ts gameLoop.ts
   │           matchmaker.ts elo.ts players.ts env.ts soak.ts db/ bots/
   └─ client/              Vite + vanilla TS, Canvas 2D, Web Audio
      └─ src/  main.ts net.ts prediction.ts audio.ts router.ts store.ts stage.ts
               settings.ts render/ screens/ ui/
```

### Why `shared` matters

`packages/shared` is pure, dependency-free TypeScript. The **same** `simulateTick` runs on the
server as the authority and in the browser for prediction, which is what keeps the two in
agreement. It also owns `CONFIG`, the single typed object holding every tunable number in the
game, the seeded map generator, the Elo maths and the wire protocol.

---

## How the netcode works

| Thing | Rate |
| --- | --- |
| Server simulation | 30 Hz fixed tick |
| Snapshots to clients | 15 Hz (every second tick) |
| Client input sampling | 60 Hz, sent at 30 Hz |
| Interpolation delay | 100 ms |

The server is authoritative and clients send **inputs only**, never positions. The client
predicts its own critter immediately and, when a snapshot arrives, resets to the authoritative
state and replays every input the server has not acknowledged yet, so local movement feels
instant with no rubber-banding. Remote critters interpolate between the two most recent
snapshots, held back by the interpolation delay. Balloon fuses render from server tick stamps
rather than local timers, so a balloon never bursts early or late on screen.

The server validates speed, collision, balloon availability and tile occupancy, ignores
impossible inputs, and rate limits each socket.

### Testing with latency

```bash
ARTIFICIAL_LATENCY_MS=150 npm run dev
```

Every outbound server message is delayed by that many milliseconds. Local movement should stay
instant and remote critters should stay smooth.

---

## Gameplay reference

**Controls.** WASD or arrows to move, Space or E to drop a balloon, 1-4 for emotes, M to mute,
Escape to leave a match. Everything is rebindable in Settings.

**Balloons.** Fuse is 90 ticks (3.0s). A burst throws a cross-shaped splash up to your
`splashRange` in each direction. It is blocked by boulders, washes away the **first** sandcastle
per direction and stops there, and lingers about 0.4s. Any balloon caught in a splash bursts
immediately, and the whole cascade resolves inside one server tick, so chains are instant.
Chained balloons use their own range.

**Power-ups** are buried inside sandcastles, pre-rolled from the round's seed at map generation.
Contents are never sent to a client until the castle is washed away, so they cannot be guessed
or datamined, and the same seed always produces the same map with the same contents.

| Power-up | Effect | Weight |
| --- | --- | --- |
| Extra Balloon | +1 simultaneous balloon (cap 8) | 0.38 |
| Big Splash | +1 splash range (cap 10) | 0.38 |
| Flippers | +0.4 tiles/sec (cap 7.0) | 0.19 |
| Rubber Boots | Kick balloons, once per round | 0.05 |

30% of sandcastles hide something.

**Balloon Kick.** With Rubber Boots, walking into a balloon slides it tile by tile until it hits
a boulder, sandcastle, balloon or player, keeping its fuse the whole way.

**Rising Tide.** At 2:00 the water rises and floods inward one ring at a time. Flooded tiles are
solid, soak anyone standing in them and dissolve sandcastles, and rising water nudges critters
clear of the tiles it takes. Every interior tile eventually floods, so a round always resolves.

Two critters soaked on the same tick is a **drawn round**, which is what makes a mutual knockout
feel fair. Sudden death is the one exception: critters walk through each other, so a closing
arena piles them onto the same tile, and one flooding tile was taking the last survivors
together. When the water would claim everyone left at once, the strongest round survives to win
it (most soaks, then castles washed, then time survived). Sudden death exists to break ties, not
to make them. Before this rule, 17 of 17 free-for-all draws were exactly that pile-up, and only
7 of 20 bot free-for-all rounds reached a decision; now every round does.

**Revenge Ducks** (casual only). Soaked critters paddle the arena border on a rubber duck and can
lob a balloon straight in every 5 seconds. Revenge soaks count in your stats but score no points.

---

## Ranked and Elo

Separate queues and separate ratings for Duel and Free-for-All. Everyone starts at **1000**.
K is **64** for a player's first 10 games in a mode, then **32**.

- **Duel** uses standard Elo.
- **Free-for-All** uses pairwise Elo: final placement (round wins, then total soaks, with true
  ties sharing a placement) scores you against each of the other three, summed at `K/3`. A clean
  sweep therefore moves your rating exactly as much as winning a duel.

The matchmaker ticks every 2 seconds and pairs players within ±100 rating, widening by 50 every
10 seconds up to ±400. Bots never enter ranked. A ranked disconnect has a 15 second reconnect
grace; after that it is a forfeit loss, and in free-for-all the leaver takes last place.

| Tier | Rating |
| --- | --- |
| Puddle | below 1000 |
| Pond | 1000 - 1149 |
| River | 1150 - 1299 |
| Lake | 1300 - 1499 |
| Ocean | 1500 - 1749 |
| Tsunami | 1750+ |

---

## Accounts and progression

First visit generates a device token, and the server creates a guest such as `SoggyOtter#4821`.
The token is stored in localStorage and only its hash is stored server-side. There are no
passwords in v1: **losing the token means losing the account**, which Settings says plainly.
Set a nickname (3-16 characters, profanity filtered, made unique with a `#tag`) before playing
ranked.

XP comes from participation, placement, soaks and castles washed. Levels unlock animals (Frog
and Duck to start, then Otter, Penguin, Cat, Raccoon, Turtle and Capybara at level 20) and hats,
all purely cosmetic. Pick them in the Locker with a live 8-bit walk-cycle preview.

---

## HTTP API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness, uptime, room and client counts |
| `GET /api/leaderboard?mode=duel\|ffa` | Top 100: rank, name, rating, tier, games, winrate |
| `GET /api/profile/:id` | Ratings, recent matches, level, unlocks |
| `WS /ws` | The game protocol (see `packages/shared/src/protocol.ts`) |

---

## Testing

```bash
npm test          # Vitest: shared sim, map/seed determinism, Elo fixtures, bots, accounts
npm run typecheck # strict TypeScript across all three packages
npm run soak      # headless bot-vs-bot matches to completion, non-zero exit on any failure
```

The suite pins the behaviour that is easy to break silently: a three-balloon chain bursting in a
single tick, a splash stopping at the first sandcastle, identical seeds producing identical maps
*and* identical hidden power-up contents, `cloneState` being a true deep copy so client rollback
cannot corrupt state, and the Elo fixtures for both duel and 4-player pairwise maths.

---

## Deployment

Single Node process, no external services, SQLite in a file.

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data splash-critters
```

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and WebSocket share it |
| `DATA_DIR` | `<repo>/data` | `splash.db` lives here; mount a volume |
| `CLIENT_DIR` | `packages/client/dist` | Built client to serve |
| `ARTIFICIAL_LATENCY_MS` | `0` | Dev only, delays outbound messages |

The image is Debian-slim rather than Alpine so `better-sqlite3` uses its published prebuilt
binary instead of compiling against musl, and dev dependencies are pruned in place so the native
binding that ships is the one that was built. The Dockerfile has not been built on this machine
(no Docker daemon available here); the production path it runs, `npm run build` followed by
`node packages/server/dist/index.js` serving everything on one port, is verified locally.

**Railway / Fly / Render:** deploy the Dockerfile, attach a persistent volume at `/data`, and
expose the single port. The server sits behind the platform's TLS proxy and the client picks
`wss://` automatically from `location.protocol`, so no extra configuration is needed. Health
checks should point at `/health`.

Desktop web only for v1: there are no touch controls.

---

## License and originality

This is an original game. The characters, art, audio, names and code are all written for this
project, and nothing is derived from any existing title.
