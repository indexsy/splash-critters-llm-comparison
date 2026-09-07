# Splash Critters

Small critters. Big splashes. An original, desktop-browser water balloon arena game with procedural pixel art, synthesized chiptunes, casual rooms, bots, ranked matchmaking, and persistent guest accounts.

## Run

Requires Node.js 20 or newer (Node 22 LTS is recommended) and npm. Native SQLite builds may need a C++ compiler, Python, and Make if a prebuilt binary is unavailable.

```bash
npm ci
npm run build
npm start
```

Open **http://localhost:3000**. Express serves the compiled client, WebSocket endpoint, REST API, and health check from that one port.

For development:

```bash
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/ws`, `/api`, and `/health` to the authority on port 3000. The dev command first builds shared code, then watches shared/server/client together; the client uses shared source directly during development.

The Vite dev listener is bound to loopback intentionally. The requested Vite 5 line has outstanding development-server security advisories; do not expose it to an untrusted network. Production runs Express, not Vite. Production dependencies pass `npm audit --omit=dev`.

## Play

- Move with WASD or arrows. Drop a balloon with Space or E. Your own splashes can soak you.
- Keys 1-4 play animal emotes; M toggles mute. Remap movement and balloon controls in Settings.
- Duel uses a 13x11 arena. Four-player free-for-all uses 15x13. Ranked matches are first to three; casual hosts can choose two, three, or five.
- Each balloon has a three-second fuse. Splash chains resolve in one tick, using each balloon's individual range. Rocks stop splashes; the first sandcastle in each direction washes away and stops that ray.
- Find Extra Balloons, Big Splash, Flippers, and rare kick-enabling Rubber Boots. At two minutes, Rising Tide floods inward.
- In casual play, eliminated humans become border-riding Revenge Ducks. Move around the perimeter and press the balloon key to lob every five seconds. Revenge soaks count as soaks, not round wins.
- Practice starts a private match against Hard bots. Splash School teaches movement, castle destruction, pickups, chains, and soaking an Easy opponent. It is skippable; completing all five server-verified objectives awards 50 XP once.
- All animals and hats are cosmetic. Levels unlock the roster, ending with Capybara at level 20.

### Two-Player Testing

Accounts use an unguessable device token in localStorage. **Two ordinary tabs share the same account**, so use separate browser profiles, a private window, or `/?guest=1` for the second player. `guest=1` stores that tab's independent identity in sessionStorage. A second connection using the same identity takes over the old connection instead of allowing duplicate ranked entries.

1. Player A: Room Browser, Create a Room, select four players, and add two Hard bots to slots three and four.
2. Player B: find the room in the public browser, join, and mark ready.
3. Player A starts the match. Results award and persist XP for both humans.
4. For ranked, both players choose nicknames, leave their rooms, and queue for the same mode. Ranked never fills with bots.

Private invitations use `/#/room/CODE`. Reloading during a match reconnects to the authoritative room and restores the current terrain and dynamic snapshot.

### Developer Harnesses

- `/debug.html`: fully local, account-free simulation lab, one keyboard player against one Hard bot, first to three. Uses the same simulation and bot controller as online play.
- `/?latency=150`: injects 150 ms round-trip latency, split across incoming and outgoing WebSocket messages. Add `&guest=1` for a second identity.
- `/?dev=1`: displays client FPS, simulation tick, and configured artificial latency during play.
- `npx tsx scripts/bot-trace.ts ffa 2 2`: print a deterministic decision trace for mode, seed-fixture round, and player slot.

## Verify

```bash
npm run typecheck
npm test
npm run build
npm run test:soak
npm run test:integration
npx playwright install chromium
npm run test:browser
npm run test:tutorial
```

The suites cover deterministic RNG/maps/hidden contents, chained bursts, castle obstruction, pickups, kicks, simultaneous draws, tide, Elo fixtures, bot danger forecasts and mid-tile escape regressions, input validation, SQLite persistence, one-time tutorial XP, prediction reconciliation, and remote interpolation.

The soak script completes seeded Duel and FFA bot matches and replays every input against a second authority, asserting no desync, no self-soaks in those fixtures, and more round wins for Hard than Easy overall. This is regression coverage, not a guarantee that any bot can escape an adversarially created trap or that Hard wins every match.

The integration script uses real HTTP/WebSocket sessions and temporary SQLite databases. It accelerates full match simulation in-process, then exercises XP/results/rematches, ranked Duel matchmaking, reconnect, grace expiry, rating persistence, leaderboard updates, and invalid actions. No production cheating/debug endpoint is exposed.

Playwright checks the desktop and mobile layouts, two-session public room flow, two Hard bot slots, keyboard input, 150 ms latency mode, refresh/reconnect, Locker selection, settings persistence, and key remapping. Screenshots are written to `test-results/`. Mobile layouts work, but v1 gameplay requires a desktop keyboard. Network feel, audio balance, competitive balance, and the tutorial's completion time still warrant human playtesting on target hardware and real WAN connections.

The separate tutorial browser test completes all five objectives through actual keyboard events, collects the one-time XP reward, and returns to the menu. Its final opponent encounter is driven by the Hard bot policy through browser controls, not by modifying player positions or granting objectives. The verified automated journey completed in 57 seconds; human learning time will vary.

## Architecture

```text
packages/shared/src/        Pure TypeScript rules, CONFIG, types, protocol, RNG, maps, Elo
packages/server/src/        Express/ws authority, fixed game loop, rooms, matchmaking
packages/server/src/bots/   Shared-sim future danger forecast and timed BFS controllers
packages/server/src/db/     Numbered SQL migrations, queries, account/progression storage
packages/client/src/        Vanilla TypeScript screens, Canvas 2D, Web Audio, netcode
design/assets.csv          Procedural art/audio manifest and visual style contract
scripts/                   Soak, integration, browser, and bot diagnostic harnesses
```

The authority runs at 30 Hz and emits dynamic snapshots at 15 Hz. Clients submit only sequenced directional inputs and action edges. Local prediction uses the shared simulator and a one-second buffer, rewinds to the snapshot acknowledgement, and replays outstanding inputs. Remote players interpolate 100 ms behind estimated server time. Heartbeats measure RTT and clock offset every two seconds.

Terrain is sent on round start and on reconnect. Destructions arrive as events; snapshots contain players, balloons, splashes, exposed pickups, tide, and countdown. The server **never** serializes hidden pickup contents. The public map seed generates terrain only. Production rolls independent, cryptographically sourced, server-only seeds for each tile's hidden contents, so observing one drop does not disclose the rest. Numeric loot seeds remain available for deterministic fixtures; arrays of private tile seeds are deterministic too.

Bots forecast the actual shared simulation into the future, including earlier castle destruction, chain bursts, lingering splashes, moving balloons, and tide. A timed BFS checks an exit before placement. Escape timing is re-evaluated every tick; strategic decisions have separate difficulty cadences. Hard bots consider future opponent positions, chain attacks, contested escape routes, and emergency kicks. Conservative safety can cause intentional waiting for a splash to clear; this is different from a frozen input loop.

## Identity And Persistence

The SQLite database is `DATA_DIR/splash.db`, with WAL mode, foreign keys, and transactional numbered migrations at boot. The default data directory is the project's `data/` folder. Guest tokens are UUIDv4 secrets; only their SHA-256 hash is stored in SQLite. Never expose or log the raw token.

There are no passwords, OAuth, recovery emails, or account recovery. **Losing the browser token loses access to the account.** Clearing local storage creates a new guest and does not delete historical public match records. Settings communicates this limitation.

Ranked Elo starts at 1000, K=64 for the first ten games in each mode and 32 afterward. FFA uses pairwise results with K divided by three, including shared placements. Match completion stores before/after ratings, updates games/wins/peak, grants XP and level unlocks, and is idempotent inside one SQLite transaction.

Connection loss allows 15 seconds to reconnect. Expired ranked grace produces a forfeit; in FFA the leaver takes last place and remaining players continue. Casual players become Medium bots. A deliberate Leave requests the same handling immediately. Casual rematches need a majority of connected human votes; departed slots become Medium bots. Empty rooms expire after ten idle minutes.

### HTTP And WebSocket API

| Endpoint                              | Description                                          |
| ------------------------------------- | ---------------------------------------------------- |
| `GET /health`                         | Readiness, active room and connected player counts   |
| `GET /api/leaderboard?mode=duel\|ffa` | Top 100 players with completed ranked matches        |
| `GET /api/profile/:id`                | Public profile, ratings, unlocks, and recent matches |
| `/ws`                                 | Authoritative JSON WebSocket protocol                |

Discriminated unions are in `shared/src/protocol.ts`. Alongside the requested messages, `equip`, `tutorial_complete`, `profile_updated`, `queue_left`, and `room_left` support the full UI lifecycle. Payloads are validated, capped at 4 KiB, and rate-limited to 60 messages/sec per socket. Position injection and invalid sequence/field values are rejected. Emotes have a separate cooldown. Slow consumers are disconnected before send buffers grow unbounded.

## Deploy

Deploy **one process and one replica** with a persistent volume. SQLite and room authority are intentionally single-process. Do not run clustered workers or multiple replicas against this database. Active matches/queues are in memory and reset on a process restart; completed accounts, matches, ratings, and unlocks persist. Drain active games before a deploy. Back up the database with SQLite's backup mechanism, not by copying only `splash.db` while WAL writes are active.

### Docker

```bash
docker build -t splash-critters .
docker volume create splash-data
docker run --name splash-critters --rm -p 3000:3000 \
  -v splash-data:/data \
  -e DATA_DIR=/data \
  splash-critters
```

The image builds on Node 22, prunes development dependencies, exposes port 3000, and provides a health check. Its startup command initializes ownership of the mounted data directory, then drops to the non-root `node` user via `gosu`. Existing database files on a bind mount must also be writable by UID 1000. Numbered SQL migrations are included in the image.

### Railway

Import the repository using the supplied `railway.json`/Dockerfile. Attach a persistent volume at `/data`, set `DATA_DIR=/data`, and keep one replica. Railway supplies `PORT`. Generate an HTTPS domain and confirm `/health` returns `ok: true`.

### Render

Use the included `render.yaml` Blueprint. It requests a persistent 1 GB disk at `/data`; a paid service/disk plan is needed. The health check is `/health`. Keep one instance.

### Fly.io

Change the globally unique app name in `fly.toml`, then:

```bash
fly launch --no-deploy
fly volumes create splash_data --region sea --size 1
fly deploy
fly scale count 1
```

### Reverse Proxy

Terminate TLS at the platform/proxy, preserve `Host` and WebSocket Upgrade headers, route `/ws` to the same process, and keep the idle timeout above 30 seconds. HTTPS pages automatically use `wss://`. If a proxy rewrites `Host`, add the exact public origin to comma-separated `ALLOWED_ORIGINS`. Do not use `*`.

For public launch, additionally configure edge/IP-level abuse limits and database backups, choose a nearby region, run sustained multi-room load tests on the chosen instance, and conduct real-player balance/accessibility testing. Repository delivery does not create a public hosted service or a marketplace listing.
