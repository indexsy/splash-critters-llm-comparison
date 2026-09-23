# Splash Critters

An 8-bit online arena battler: cute pixel critters drop **water balloons** that burst into
cross-shaped **splashes**, wash away **sandcastles** and soak opponents. Last critter dry wins.

- Up to 4 players online, server-authoritative 30 Hz simulation with client prediction
- Casual rooms (public browser, private codes + share links, bots with Easy/Medium/Hard per slot,
  rematch votes), Practice vs Bots, a skippable 2-minute tutorial
- Ranked Duel (1v1) and Free-for-All (4p) with separate Elo ratings (pairwise Elo for FFA),
  matchmaking with widening search ranges, tiers from Puddle to Tsunami, leaderboards
- Chain splashes, pre-rolled hidden power-ups, Rubber Boots kicks, the Rising Tide sudden death,
  Revenge Ducks (casual), animal emotes
- Accounts without passwords (device token), XP and levels unlocking 8 animals and 5 hats
- Everything is procedural: pixel art is embedded as code, audio is synthesized with Web Audio

## Controls

| Action | Default keys |
|---|---|
| Move | WASD or arrow keys |
| Drop a water balloon (ducks: lob) | Space or E |
| Emotes: quack, ribbit, squeak, honk | 1, 2, 3, 4 |
| Mute | M |

Every binding can be remapped in Settings. Desktop web only (no touch controls in v1).

## Stack

TypeScript (strict, ES modules) in an npm-workspaces monorepo:

| package | what |
|---|---|
| `packages/shared` | Zero-dependency deterministic sim (`simulateTick`), map generator, seeded PRNG (mulberry32), CONFIG, protocol types, Elo, progression. Runs on the server (authority) and in the browser (prediction). |
| `packages/server` | Node >= 20, `express` + `ws` on one port, SQLite via `better-sqlite3` (WAL, numbered migrations at boot), rooms, matchmaker, bots, game loop. Bundled by esbuild. |
| `packages/client` | Vite 5 + vanilla TypeScript, Canvas 2D at 256x224 integer-scaled, Web Audio. No frameworks. |

Design and contracts: [ARCHITECTURE.md](ARCHITECTURE.md). Original spec: [docs/SPEC.md](docs/SPEC.md).

## Develop

```bash
npm install
```

```bash
npm run dev
```

Server on http://localhost:3000 (tsx watch) and Vite on http://localhost:5173 with `/ws`, `/api`
and `/health` proxied to the server. Open the Vite URL. If port 3000 is taken, start both with
another port, e.g. `PORT=3020 npm run dev`.

Useful flags:

- `?lag=150` on the client URL delays every inbound and outbound message by 150 ms (artificial
  latency; a badge shows it is on). `DEV_LAG_MS=150` does the same on the server.
- Several tabs in one browser are several players: the first tab uses the browser's main account,
  extra simultaneous tabs get their own guest accounts (Web Locks). `?identity=N` forces one.
- `?netstats=1` on the client URL, or F3 during a match, shows a small netcode overlay in the
  bottom-right corner: round-trip time, input-to-ack delay, pending inputs, prediction corrections,
  interpolation buffer and snapshot jitter. F3 toggles it. It ships in production builds but is off
  (and records nothing) until turned on. Once on, `window.splashNetStats` gives automated tests a
  read-only handle: `report()`, `frames(sinceMs)` (where each critter was drawn, per frame),
  `keys(sinceMs)` and `reset()`. The browser flows below measure input latency and smoothness
  through it.

## Test

```bash
npm test
```

Vitest across all packages: the sim acceptance tests (a 3-balloon chain bursts in one tick, a
splash stops at the first sandcastle, identical seeds give identical maps and hidden power-ups),
Elo fixtures (duel and 4-player pairwise), movement/kick/tide/duck rules, the data layer,
server rooms/matchmaker/match runner/tutorial, and client prediction/interpolation.

```bash
npm run typecheck
```

```bash
npm run soak
```

Headless bot-vs-bot matches (no server): checks for crashes, desyncs (every match is re-simulated
from its recorded inputs and must hash identically), bot freezes and unforced self-soaks, and that
Hard reliably beats Easy. Prints `SOAK PASSED` or exits 1.

```bash
npm run e2e
```

Boots the real server on a temporary port and database and drives the acceptance flows over real
WebSockets (guest -> tutorial, public 4p room with Hard bots joined from a second client, ranked
duel with Elo persisted to SQLite and visible on the leaderboard, forfeits, reconnects).

```bash
npm run build && npm run e2e:browser -w @splash/client -- flow1 flow4
```

Browser acceptance flows in headless Chromium against the built client, with real clicks and key
presses: flow1 tutorial, flow2 4-player casual match with Hard bots (8 to 35 minutes), flow3 ranked
duel, flow4 netcode feel at `?lag=150`, flow5 audio, flow6 screen layouts. No flow names = all six.
Needs Playwright, either installed in the repo or borrowed from another project with
`PLAYWRIGHT_FROM=<dir>`. Screenshots go to `output/wave3` (`E2E_OUT` changes it).

## Build and run (one port)

```bash
npm run build && npm start
```

Serves the built client, the REST API, the WebSocket at `/ws` and `/health` on `PORT` (3000).

Environment:

| var | default | meaning |
|---|---|---|
| `PORT` | 3000 | HTTP + WebSocket port |
| `DATA_DIR` | `./data` | Directory for `splash.db` (SQLite). Mount a volume here in production. |
| `CLIENT_DIST` | `packages/client/dist` | Built client to serve |
| `PROXY_HOPS` | 1 | Trusted proxies appending to X-Forwarded-For (2 for a CDN in front of the platform proxy) |
| `RANKED_SEPARATE_ADDRESSES` | off | `1` = ranked never matches players who share a public IP (blocks alt-account rating farming, but also two players in one household) |
| `DEV_LAG_MS` | 0 | Artificial server-side latency per direction (dev only) |

REST: `GET /api/leaderboard?mode=duel|ffa`, `GET /api/profile/:id`, `GET /health`.

## Deploy

The app is a single Node process with a SQLite file, so give it **one instance** and a
**persistent volume** mounted at `DATA_DIR` (`/data` in the Docker image); anything outside the
volume is lost on redeploy. Reverse proxies must allow WebSocket upgrades on `/ws` (Railway, Fly
and Render do by default); behind TLS the client automatically uses `wss://`. Point the platform
health check at `/health`.

### Docker

```bash
docker build -t splash-critters .
```

```bash
docker run -d --name splash -p 3000:3000 -v splash-data:/data --restart unless-stopped splash-critters
```

- The database is `/data/splash.db`. The image declares no `VOLUME` (Railway rejects Dockerfiles
  that do), so always mount one: without `-v` the data lives in the container and dies with it.
- The server runs as the unprivileged `node` user (uid 1000). The entrypoint starts as root only to
  hand `/data` to `node` (platform volumes and host bind mounts arrive owned by root), then drops
  privileges with `setpriv`. Started with `--user` it skips that step, so `/data` must already be
  writable by that uid.
- Before starting the server, the entrypoint checks that `/data` and the `splash.db*` files in it
  are writable by the server's user. If not (for example a read-only mount), the container exits 1
  with `[entrypoint] /data or its database files are not writable ...`. Without this check SQLite
  would open the database read-only, `/health` would pass and every write would fail.
- The image builds for `linux/amd64` (what Railway, Fly and Render build on) and `linux/arm64`:
  `npm ci` installs better-sqlite3's prebuilt binary for the build platform, and the build stage
  keeps python3/make/g++ in case it has to compile from source. To build for an amd64 host from an
  arm64 machine, use `docker buildx build --platform linux/amd64 -t splash-critters --load .`.
- `docker stop` sends SIGTERM: the server closes its sockets and the database, then exits 0.
- A `HEALTHCHECK` polls `/health`, so `docker ps` shows `(healthy)`.

### Railway

1. Create a service from this repo; Railway builds the `Dockerfile`.
2. Attach a volume mounted at `/data`. `RAILWAY_RUN_UID` is not needed: the entrypoint hands the
   root-owned volume to the `node` user.
3. Railway injects `PORT`; no other variable is required. Generate a domain under Settings >
   Networking and set the healthcheck path to `/health`.
4. Replicas cannot be used with volumes, so the service stays at one instance, and a redeploy has a
   short downtime while the volume moves to the new deployment.

### Fly.io

```bash
fly launch --no-deploy
```

```bash
fly volumes create splash_data --size 1 --region <primary_region from fly.toml>
```

Add the mount below to the generated `fly.toml`, check that its existing `[http_service]` section
has `internal_port = 3000` (edit that value rather than adding a second `[http_service]` table),
then run `fly deploy`:

```toml
[mounts]
  source = "splash_data"
  destination = "/data"
```

With a volume mounted, Fly starts a single Machine. Keep it at one (`fly scale count 1`): volumes
are not replicated between Machines.

### Render

Create a Web Service from the repo with the Docker runtime, add a persistent disk mounted at
`/data` (disks need a paid instance type) and set the health check path to `/health`. A service
with a disk runs as one instance, and each deploy briefly stops the old instance before the new
one starts. Render sets `PORT` (10000 by default) and the server listens on it.

## Accounts

There are no passwords in v1. The first visit creates a guest account (e.g. `SoggyOtter#4821`)
bound to a random device token kept in the browser's localStorage; the server stores only its
SHA-256 hash. Clearing site data loses the account. A custom nickname (3-16 characters, filtered,
unique with a `#tag`) is required before playing ranked.
