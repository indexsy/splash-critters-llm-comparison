# Splash Critters 💦

An 8-bit online arena battler: cute pixel animals drop **water balloons** that burst into
cross-shaped splashes, washing away sandcastles and soaking opponents. Last critter dry wins.

- Up to 4 players online (Duel 1v1 · Free-for-All 4p)
- Server-authoritative 30 Hz simulation with client prediction & interpolation
- Ranked Elo matchmaking (humans only) + casual rooms with server-side bots
- Hidden power-ups pre-rolled per map seed, chain bursts, balloon kick,
  Rising Tide sudden death, Revenge Ducks, emotes
- Accounts (device token), XP/levels, cosmetic unlocks, leaderboards — SQLite persistence

Original game — no third-party assets or names.

## Quick start

```bash
npm install

# dev: API+WS on :3000, Vite HMR on :5173
npm run dev            # → open http://localhost:5173

# production: everything on one port
npm run build && npm start   # → open http://localhost:3000
```

## Tests

```bash
npm test               # Vitest: sim determinism, splash/chain rules, Elo fixtures
npm run soak           # headless bot-vs-bot full match (no crash / completes)
```

Key verified behaviours:
- identical seed → identical map + identical hidden power-up contents
- 3-balloon chain resolves in a single tick; splash stops at first sandcastle
- last two players soaked on the same tick = draw round
- Duel Elo and pairwise FFA Elo fixtures; placement ties share rank

## Deploy (Railway / Fly / Render / any Node host)

Single Node process serves the REST API, WebSocket (`/ws`) and the built client
on `$PORT`. Put a reverse proxy with `wss://` support in front.

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data splash-critters
```

SQLite lives at `$DATA_DIR/splash.db` (WAL mode) — mount a volume to persist
accounts, ratings and matches.

## Architecture

```
packages/
  shared/    zero-dep pure TS: CONFIG, types, mulberry32 RNG, map gen,
             deterministic simulateTick(), protocol, Elo
  server/    ws + express on one port; rooms, 30Hz game loop, matchmaker,
             SQLite migrations, danger-map bots (easy/medium/hard)
  client/    Vite + vanilla TS canvas renderer, prediction, chiptune audio,
             screens (title/tutorial/menu/browser/lobby/queue/game/results/
             leaderboard/locker/settings)
```

### Netcode
- clients send inputs only (`{seq,tick,dirX,dirY,balloonPressed}` @30 Hz)
- snapshots @15 Hz; remote entities interpolate at `serverTime − 100 ms`
- local player predicted client-side with soft reconciliation (feels instant at
  ~150 ms latency); fuses render from server tick timestamps
- anti-cheat: server validates movement/collisions/drops, rate-limits 60 msg/s,
  never trusts client positions

### Ranked
- start 1000, K=64 for first 10 games/mode then 32; ±100 range widening +50/10s (cap 400)
- FFA uses pairwise placements with K′ = K/3; ties share placement
- tiers: Puddle · Pond · River · Lake · Ocean · Tsunami
- `GET /api/leaderboard?mode=duel|ffa` · `GET /api/profile/:id` · `GET /health`

## Known tuning notes (v1)

- Bot difficulty spread is functional but still being tuned: Hard occasionally
  over-commits to its own splash in tight corridors (it will never freeze — it
  scrambles to the safest reachable tile). Human play is unaffected.
- Desktop web only in v1 (keyboard controls).

## Scripts

| command        | purpose                                  |
| -------------- | ---------------------------------------- |
| `npm run dev`  | server :3000 + client :5173 with HMR     |
| `npm run build`| typecheck + build shared/client          |
| `npm start`    | single-port production server (:3000)    |
| `npm test`     | shared sim + Elo unit tests              |
| `npm run soak` | headless bot-vs-bot full match soak test |
