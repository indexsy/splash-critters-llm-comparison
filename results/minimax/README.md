# Splash Critters

An 8-bit online water balloon battler for the browser. Cute pixel critters drop
water balloons that burst into cross shaped splashes, washing away sandcastles
and soaking opponents. The last critter dry wins.

* **Modes** - Duel (1v1, 13x11 arena) and Free-for-All (4 players, 15x13 arena), first to 2/3/5 round wins.
* **Ranked** - Elo matchmaking with separate rating pools per mode, win streaks, tiers from *Puddle* to *Tsunami*.
* **Casual** - public room browser, private rooms with a shareable code, per-slot bots (easy/medium/hard), rematch votes.
* **Progression** - XP, levels, eight animals and five hats. Everything is cosmetic.
* **Netcode** - server authoritative 30 Hz simulation, 15 Hz snapshots, client side prediction with rewind/replay reconciliation and interpolation.

Original game - no third party game assets, names or characters are used.

---

## Quick start

```bash
npm install          # installs the three workspaces
npm run build        # shared -> client -> server
npm start            # http://localhost:3000  (one port, serves the game)
```

Development (server on `:3000`, Vite client on `:5173` with a `/ws` + `/api` proxy):

```bash
npm run dev
```

Open <http://localhost:5173>. A guest account is created automatically on the
first visit - no password, the account lives in the browser's local storage.

### Environment variables

| Variable   | Default | Meaning                                             |
| ---------- | ------- | --------------------------------------------------- |
| `PORT`     | `3000`  | HTTP + WebSocket port                                |
| `DATA_DIR` | `./data`| Directory for `splash.db` (SQLite, WAL mode)         |

---

## Repository layout

```
splash-critters/
├─ package.json / tsconfig.base.json / Dockerfile / vitest.config.ts
├─ scripts/
│  ├─ dev.mjs          development launcher
│  └─ integration.mjs  end to end test against a running server
└─ packages/
   ├─ shared/src/      config, types, rng, map, sim, protocol, elo, progression
   ├─ server/src/      index, net, rooms, gameLoop, matchmaker, elo,
   │                   db/ (migrations + queries), bots/ (dangerMap + bot)
   └─ client/src/      main, net, prediction, audio, state,
                       render/ (sprites, font, hud, particles),
                       screens/ (title, tutorial, menu, browser, lobby, queue,
                       game, results, leaderboard, locker, settings, help)
```

`packages/shared` has **zero dependencies** and is pure TypeScript. The very
same `simulateTick(state, inputs)` runs on the server (authority) and in the
client (prediction), so a replay of the same inputs always produces the same
world.

---

## Gameplay

| Rule | Value |
| ---- | ----- |
| Balloon fuse | 90 ticks (3.0 s) |
| Splash linger | 12 ticks (~0.4 s, visual only - the damage lands on the burst tick) |
| Splash shape | cross, `splashRange` tiles per direction, blocked by boulders, stops at the first sandcastle |
| Base stats | speed 4.0 tiles/s, 1 balloon, splash range 2 |
| Stat caps | speed 7.0, 8 balloons, splash range 10 |
| Power-ups | Extra Balloon, Big Splash, Flippers, Rubber Boots (kick) |
| Hidden power-ups | rolled with the round seed, never sent to the client before they are revealed |
| Chain splashes | every balloon caught in a splash bursts in the same tick, each with its own range |
| Rising tide | starts at 2:00, one ring every 1.5 s, soaks anyone standing in the water |
| Revenge ducks | casual only: soaked players ride a rubber duck and can lob one balloon every 5 s |

### Map generation

The arena is generated from the round seed: the border and every even `(x, y)`
tile are indestructible **boulders**, roughly 75 % of the remaining tiles hold
destructible **sandcastles** and the spawn tiles plus two tiles per direction
stay clear.

> **Deliberate deviation:** the generator only keeps a sandcastle when the free
> space stays connected, otherwise the arena would break into sealed pockets
> (a purely random 75 % layout is not traversable). The effective castle
> density therefore lands between 25 % and 40 % depending on the seed, which is
> the highest density that still produces a playable maze.

---

## Netcode

* The server simulates at a fixed **30 Hz** and sends snapshots at **15 Hz**.
* Clients only send inputs (`seq`, `dir`, `balloon`) at 30 Hz.
* The local player is predicted immediately and reconciled against every
  snapshot by rewinding to the matching history entry and replaying the
  unacknowledged inputs.
* Remote players are interpolated at `serverTime - 100 ms`.
* Ping/pong every 2 s gives the client the server clock offset.
* Anti cheat: the server owns the positions, validates tile occupancy, the
  balloon budget, the input sequence and rate limits every connection to 60
  messages per second.

### Protocol

`packages/shared/src/protocol.ts` contains the discriminated unions for both
directions:

```
C -> S  hello, set_nickname, set_cosmetics, queue_join, queue_leave,
       create_room, join_room, room_list_request, leave_room, set_slot,
       set_ready, start_match, input, emote, rematch_vote, pong
S -> C  welcome, error, queue_status, match_found, room_created, room_list,
       lobby_state, match_start, round_start, snapshot, event, round_end,
       match_end, ping, profile
```

### Artificial latency

Append `?latency=150` to the websocket URL (or use the slider in the settings)
to simulate a slow connection:

```
ws://localhost:3000/ws?latency=150
```

---

## Bots

Bots run on the server and use the same simulation as the humans.

* A **danger map** is recomputed every tick: every live balloon marks the
  tiles its splash will reach, balloons inside another balloon's splash
  inherit the earlier burst time (chain reactions included) and the rising tide
  is permanently unsafe.
* The decision loop is a breadth first search: flee when the current tile is
  dangerous, never drop a balloon unless a safe exit exists, otherwise farm
  sandcastles, collect power-ups or attack.

| Difficulty | Decision interval | Danger awareness | Behaviour |
| ---------- | ----------------- | ---------------- | --------- |
| Easy       | ~450 ms           | 10-15 % mistakes | farms, wanders, rarely attacks |
| Medium     | ~250 ms           | full             | balanced farming and attacks within 4 tiles |
| Hard       | ~120 ms           | zero mistakes    | hunts, predicts movement, engineers chains, uses the boots |

---

## Elo

* Start rating 1000, `K = 64` for the first ten games in a mode, then 32.
* **Duel**: standard Elo, win = 1 / loss = 0.
* **Free-for-all**: pairwise Elo. The final placement (round wins, tiebreak
  total soaks, unresolved ties share a placement) gives every pair a score
  (1 / 0.5 / 0) and every delta is `sum(K' * (S - E))` with `K' = K / 3`.
* Tiers: Puddle < 1000, Pond 1000, River 1150, Lake 1300, Ocean 1500,
  Tsunami 1750.
* Ranked disconnects get a 15 s reconnect grace, afterwards the leaver takes
  last place. Ranked never substitutes bots.

---

## API

| Endpoint | Description |
| -------- | ----------- |
| `GET /health` | uptime, room count, connection count |
| `GET /api/leaderboard?mode=duel\|ffa&limit=100` | rank, nickname#tag, rating, tier, games, win rate |
| `GET /api/profile/:id` | ratings, recent matches, level, unlocks |
| `GET /api/rooms?mode=duel\|ffa` | public rooms |

---

## Tests

```bash
npm test                 # vitest: simulation, chains, RNG, map, Elo fixtures
npm run soak             # headless bot versus bot matches
node scripts/integration.mjs 3000   # end to end against a running server
```

The Vitest suite covers the acceptance criteria of the simulation: a three
balloon chain bursts inside a single tick, a splash stops at the first
sandcastle, an identical seed produces an identical map with identical hidden
power-up contents and the Elo fixtures match the expected values.

The soak script plays complete bot matches on the real server loop and checks
the world invariants after every tick. The integration script walks through
the whole player journey: guest account, public room creation, the room
browser, joining, a finished match with XP, the ranked queue, a forfeit and
the leaderboard.

---

## Deployment

The game is a single Node process that serves the API, the websocket and the
built client on one port, so any host that can run a container or a Node
process works.

### Docker

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data splash-critters
```

The SQLite database lives in `DATA_DIR` (`/data` inside the image), so mount a
volume to keep the accounts and ratings.

### Railway / Render / Fly

* **Railway**: `npm run build` as the build command, `npm start` as the start
  command, add a volume mounted at `/data` and set `DATA_DIR=/data`.
* **Render**: a web service with the same build/start commands and a disk
  mounted at `/data`.
* **Fly**: `fly launch --now` with a volume on `/data`.

Behind a reverse proxy make sure websocket upgrades are forwarded - the server
listens on `/ws` and supports `wss://` out of the box.

---

## Licence

Original work. All sprites, sounds and mechanics were written from scratch for
this project.
