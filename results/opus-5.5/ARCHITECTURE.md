# Splash Critters: Architecture & Contracts

This is the binding design document every contributor (human or agent) builds against.
`packages/shared/src/{types,config,protocol,cosmetics}.ts` are the typed contract; this
file explains semantics, module ownership and cross-module interfaces.

> This repo is standalone. It is NOT the dondi app: no Convex, Firebase, React, shadcn,
> Zustand. Only these house rules apply: **every source file stays under 500 lines**
> (split by function: `render/sprites-animals.ts`, `rooms/slots.ts`, ...), no placeholder or
> dummy implementations in the final product, no orphaned code, production quality.
> Running `npm run dev`, `npm run build`, `npm start`, tests and scripts here is allowed.
> Port 3000 may be busy on this machine: use `PORT=3020` (or any free port) for local runs.

## 1. Layout & commands

```
packages/shared   zero-dep TS: types, CONFIG, rng, grid, map, state, movement, burst, tide,
                  ducks, sim, snapshot, elo, progression, protocol, cosmetics
packages/server   express + ws on one PORT, better-sqlite3 (DATA_DIR/splash.db), bots,
                  matchmaker, rooms, game loop; bundled by esbuild to dist/index.js
packages/client   Vite 5 + vanilla TS, Canvas 2D (256x224 backbuffer), Web Audio
```

- `@splash/shared` ships as TS source (`main: src/index.ts`): Vite, tsx, vitest and esbuild
  all consume it directly. Inside shared, import siblings extensionless (`./config`).
- `npm run dev` = server (tsx watch, :3000 or $PORT) + Vite (:5173, proxies /ws /api /health).
- `npm run build && npm start` = one port serving client dist + REST + WS + /health.
- `npm test` (vitest, `packages/*/test/**/*.test.ts`), `npm run typecheck`,
  `npm run soak` (headless bot-vs-bot), `npm run e2e` (real-WebSocket acceptance flows),
  `npm run build && npm run e2e:browser -w @splash/client [-- flow1 ...]` (Playwright browser
  flows; `PLAYWRIGHT_FROM=<dir with playwright>` when the repo has no Playwright install).
- Env (read only by `packages/server/src/index.ts`): `PORT` (3000), `DATA_DIR` (./data),
  `CLIENT_DIST` (auto), `DEV_LAG_MS` (server-side artificial latency per direction, dev only),
  `PROXY_HOPS` (1: proxies appending to X-Forwarded-For; 2 behind a CDN plus a platform proxy).
  The Docker image also sets `NODE_ENV=production`; only express reads it, no app code branches
  on it.

## 2. Shared module API

Every export of the sim modules. `types.ts`, `config.ts`, `protocol.ts` and `cosmetics.ts` are
the typed contract and are read directly. `index.ts` re-exports all of them: server and client
import only from `@splash/shared`.

| file | exports |
|---|---|
| `rng.ts` | `mulberry32(seed): () => number` in [0,1); `hashSeed(...n: number[]): number` (uint32 mix); `randInt(rng, n)` |
| `grid.ts` | `idx(w,x,y)`, `tileOf(sub)`, `tileCenter(t)`, `DIR_DX`, `DIR_DY` (indexed by DirCode), `ALL_DIRS` ([Up,Down,Left,Right]), `ringIndex(w,h,x,y)` = min(x,y,w-1-x,h-1-y), `inBounds(w,h,x,y)` |
| `map.ts` | `interface GeneratedMap { w; h; tiles: Uint8Array; hidden: Uint8Array; spawns: {slot; tx; ty}[] }`; `generateMap(mode, seed, contentSeed = hashSeed(seed, CONTENT_SALT)): GeneratedMap` (`contentSeed` only rolls the hidden items, see section 3; `CONTENT_SALT` is module-private); `spawnTilesFor(mode): {slot,tx,ty}[]`; `buildTutorialMap(): GeneratedMap`; `encodeTiles(tiles): string`; `decodeTiles(s): Uint8Array`; `rollPowerUp(rng): PowerUpKind` |
| `state.ts` | `makeRules(opts: {ranked: boolean; tutorial?: boolean}): SimRules`; `createRoundState(map: GeneratedMap, present: boolean[], rules: SimRules): RoundState`; `cloneState(s): RoundState`; `activeBalloonCount(s, slot)` (thrown balloons only, duck lobs excluded); `balloonAt(s, tx, ty): Balloon | undefined`; `playerBoxOverlapsTile(p, tx, ty): boolean` (center +/- `PLAYER_HALF`); `passMaskForTile(s, tx, ty): number` (alive players overlapping the tile); `spawnBalloon(s, {owner, tx, ty, burstTick, range, fromDuck}): Balloon` (stationary balloon at the tile center, id from `s.nextId`) |
| `movement.ts` | `isSolidFor(s, slot, tx, ty): boolean`; `movePlayer(s, p, dir, allowKick): { kickedId: number }` (kickedId -1 if none); `updatePassMasks(s)`; `playerTile(p): {tx,ty}`; `slideBalloons(s, events)` (tick step 3, id order, emits `balloon_stopped`) |
| `burst.ts` | `computeArms(s, tx, ty, range): [u,d,l,r]` (pure, uses current tiles/balloons; used by bots); `splashTiles(cx,cy,arms): {x,y}[]`; `resolveBursts(s, events)` |
| `tide.ts` | `isFlooded(s, tx, ty)`; `advanceTide(s, events)`; `maxTideLevel(w,h)`; `fizzleFloodedBalloons(s, events)` (runs every tick after the tide step, so a balloon kicked into flood water fizzles too) |
| `ducks.ts` | `borderLoopLength(w,h)` (sub-units); `duckTile(w,h,pos): {tx,ty,side}` side 0 top,1 right,2 bottom,3 left,-1 corner; `duckXY(w,h,pos): {x,y}` sub-units; `nearestDuckPos(w,h,x,y)`; `stepDuck(s, p, input, events)` |
| `sim.ts` | `simulateTick(s, inputs: (PlayerInput|null)[]): GameEvent[]` (mutates `s`); `stateHash(s): number` (FNV over all state, for desync checks); `survivedTicks(s, p)` |
| `snapshot.ts` | `type SnapshotBody = Omit<SnapshotMsg,'type'|'serverTime'|'ack'|'pings'>`; `snapshotBody(s): SnapshotBody`; `applySnapshotToState(s, snap: SnapshotBody)` (client: overwrite dynamic state from a snapshot); `toPlayerSnap(s,p): PlayerSnap` |
| `elo.ts` | `expectedScore(ra, rb)`; `kFactor(games)`; `duelDeltas(winner: EloPlayer, loser: EloPlayer): [number, number]`; `ffaDeltas(players: (EloPlayer & {placement:number})[]): number[]`; `tierFor(rating): TierId`; `tierBand(rating): TierBandInfo` (band + `max`, `next`, `progress` 0..1); `computePlacements(rows: PlacementRow[]): Map<number, number>` with `PlacementRow = {slot; roundsWon; soaks; forfeited}`. `EloPlayer = { rating; games }`. Deltas are rounded to integers (Math.round) |
| `progression.ts` | `xpForLevel(n) = 100 + 25n` (xp to go from n to n+1); `levelFromXp(total): LevelInfo {level, xpIntoLevel, xpForNext}` (level starts at 1); `computeMatchXp(input: MatchXpInput): MatchXp {earned, breakdown: XpLine[]}`; `unlocksBetween(levelBefore, levelAfter): string[]` |

## 3. Simulation rules (authoritative; client prediction runs the same code)

Integer fixed point: `SUB = 3000` per tile, `HALF = 1500`. Speeds are integer units/tick
(`speedUnitsPerTick`, 400 at base, +40 per Flippers, cap 700). No floats in state, no RNG after
map generation. Iterate players by slot, balloons by id: fully deterministic.

**Map.** Border ring = boulders; pillars (boulders) at every (x,y) with x and y both even.
Spawns: slot0 (1,1), slot1 (w-2,h-2), slot2 (w-2,1), slot3 (1,h-2). Spawn tile plus
`SPAWN_CLEAR`=2 tiles in each direction stay clear (for every spawn of the mode, even empty
slots). Every other floor tile becomes a castle with p = `CASTLE_DENSITY`. Then, in row-major
order, each castle rolls `rng() < POWERUP_BLOCK_CHANCE` and, if so, a weighted pick from
`POWERUP_WEIGHTS` (balloon, range, speed, boots order). Same seed => identical tiles and
hidden contents. Hidden contents come from an INDEPENDENT `contentSeed` stream
(`generateMap(mode, seed, contentSeed)`, default derived from `seed` for tests): the server passes
a fresh crypto-random contentSeed per round so the public castle layout can never be used to
brute-force the items. `hidden` never leaves the server (clients get zeros;
`round_start.mapSeed` is a separate cosmetic seed).

**Tick order** (`simulateTick`): if `s.over`, only `tick++` and return. Otherwise:
1. `tick++`.
2. For each present player in slot order: alive -> movement (`movePlayer`, kick allowed if
   `rules.kick && p.canKick`), then balloon placement on `input.balloon`; soaked with a duck ->
   `stepDuck` (move along border, lob on `input.balloon`). `null` input = no movement, no press.
3. Slide kicked balloons.
4. Power-up pickup (alive player's center tile has an exposed item).
5. Bursts (`resolveBursts`).
6. Tide (`advanceTide`) when `rules.tide && tick >= nextTideTick`.
7. Soak check: alive player whose center tile is flooded or has `splashUntil > tick`.
8. Round-over check (skipped when `rules.sandbox`).
9. `updatePassMasks`.

**Movement** (lane snapping with corner assist). Moving on one axis requires the other
coordinate to sit on a lane center. Let `c` be the perpendicular coordinate, `L` the center of
the tile containing `c`, `N` the neighbour lane on the side `c` is offset toward.
- If `c != L`: target lane = current lane if the tile ahead (in `dir`) of the current lane is
  open; else `N` if both `N`'s tile at the player's current axis tile and the tile ahead in `N`
  are open (corner assist); else the current lane (**re-center**, never get stuck straddling
  a pillar corner). Spend speed moving `c` toward the target; leftover speed continues along
  the axis in the same tick.
- Aligned: advance along the axis; if the tile ahead is solid, clamp at the current tile's
  center (never push the player backwards if already past it).
- Solid for slot `s`: out of bounds, Boulder, Castle, or a balloon tile whose `passMask` lacks
  `s`. Flooded tiles are walkable (and soak you).
- `facing` = last non-None dir; `moving` = position changed this tick.
- **Kick**: when aligned, pressing into an adjacent stationary balloon tile while clamped at
  (or past) the tile center, with `canKick`, and the tile beyond the balloon is free (not
  Boulder/Castle/balloon/alive player center tile/out of bounds) -> balloon `slideDir = dir`,
  `passMask = 0`, emit `balloon_kicked`.

**Balloons.** Placement: alive, `activeBalloonCount < maxBalloons`, no balloon on the player's
center tile, tile not flooded. Balloon at that tile's center, `burstTick = tick + FUSE_TICKS`,
`range = p.range`, `passMask` = every alive player whose box (center +/- `PLAYER_HALF`)
overlaps the tile. Emit `balloon_placed`. `updatePassMasks` clears a slot's bit once its box
no longer overlaps. Sliding: moves `KICK_SPEED*SUB/TICK_RATE` = 1000 units/tick along
`slideDir`; each time it reaches a tile center it checks the next tile and stops there
(`balloon_stopped`) if blocked (as for kicks, plus other balloons). Balloons on flooded tiles
fizzle (removed, `balloon_fizzled`).

**Bursts** (`resolveBursts`). Seeds = balloons with `burstTick <= tick` or sitting on a tile
with `splashUntil > tick`, sorted by id. Each unprocessed seed starts a cascade (new
`chainId`) resolved with a BFS queue in the same tick. For a bursting balloon, each arm walks
1..range tiles: stop before out-of-bounds/Boulder; a tile that was a Castle **at the start of
this burst phase** is included and stops the arm (castle washed once, even if hit by several
arms); a tile holding another unburst balloon is included, stops the arm, and that balloon
joins the cascade queue (it uses its own range). The center + arm tiles get
`splashUntil = tick + SPLASH_TICKS`, `splashOwner = owner`, `splashDuck = fromDuck`.
A `Splash` entity is added (removed once `tick >= endTick`), `balloon_burst` emitted. A
cascade with >= 2 balloons emits `chain_burst {count}` and updates the seed owner's
`stats.biggestChain`. After all cascades: exposed items on newly splashed tiles are destroyed
(`powerup_destroyed`); then washed castles become Floor (`castle_washed`, owner's
`stats.castles++`) and reveal their hidden item (`powerup_revealed`). Items revealed this tick
survive this tick's splash; only a later burst covering them destroys them.

**Soaks.** `player_soaked {slot, by, cause}`: `by` = `splashOwner` (cause `splash`, or
`revenge` if `splashDuck`), or -1 for tide. Soak credit belongs to whoever set the cascade off:
the seed balloon's owner when its fuse ran out, or the owner of the lingering splash that set it
off. So chaining an opponent's balloon into them credits you, while setting off your own
balloon into a chain that soaks you is a self-soak. Castle credit and the visible splash colour
stay with each balloon's own thrower. Soaker's `stats.soaks++` if by != slot and not a
duck splash; duck splash -> `stats.revengeSoaks++`. Self-soak sets `stats.selfSoaked`.
If `rules.revengeDucks`, the soaked player gets `duckPos = nearestDuckPos(...)` and
`duckCooldownUntil = tick + DUCK_LOB_COOLDOWN_TICKS`.

**Round over.** Present players alive <= 1 -> `over = true`, `winner` = survivor slot or -1
(draw: the last players were soaked on the same tick). Emit `round_over`.

**Power-ups.** Balloon +1 (cap 8), Range +1 (cap 10), Speed `speedUps+1` (while below cap),
Boots sets `canKick` (applies once per round; extra Boots do nothing). Always consumed.

**Tide.** First advance at `rules.tideStartTick`, then every `TIDE_INTERVAL_TICKS`.
`tideLevel++`; every tile with `1 <= ringIndex <= tideLevel` is flooded: castles there dissolve
(`castle_washed` by -1, hidden lost), items removed, balloons fizzle. Emit `tide_advance`.

**Ducks.** The border loop runs clockwise from the top-left border tile (0,0): top edge
left->right, right edge top->bottom, bottom edge right->left, left edge bottom->top; length
`2*(w-1)+2*(h-1)` tiles. Input moves the duck along the loop at `DUCK_SPEED` (on top/bottom
edges Left/Right move it, on left/right edges Up/Down; at corners either axis works).
Lob (on `balloon` press, cooldown elapsed, not on a corner): aim straight inward; landing tile
= the farthest tile at distance `DUCK_LOB_DISTANCE`..1 that is Floor, not flooded, not under
lingering splash (`splashUntil > tick`) and has no balloon (a lob flies over obstacles). Creates a `fromDuck` balloon (`range = DUCK_BALLOON_RANGE`,
`burstTick = tick + DUCK_FUSE_TICKS`), emits `revenge_lob`, resets the cooldown.

## 4. Netcode

- Server sim 30 Hz fixed tick (one global ticker drives all rooms), snapshots every 2 ticks
  (15 Hz) per recipient (`ack` differs per player), `event` messages sent every tick that
  produced events (immediately, not batched to snapshots).
- Client runs its own 30 Hz input clock: each client tick samples the latest direction
  (keyboard state sampled at 60 Hz) plus any balloon press latched since the previous tick,
  assigns `seq++`, applies it locally with `movePlayer` (prediction) and sends
  `input{seq, tick, dir, balloonPressed}` (the spec's field names). Pending inputs are kept (~1 s) until acked.
- Server keeps a FIFO per player (max `SERVER_INPUT_QUEUE_MAX`, dropping the oldest); each
  tick pops one input (if empty, reuse the last dir with `balloon=false`), validates it
  (dir 0..4, boolean balloon, seq strictly increasing) and records `ack = seq`.
- Reconciliation: on each snapshot, the local player's state is reset to the snapshot's and
  every pending input with `seq > ack` is replayed through `movePlayer` against the client's
  world (tiles from `round_start` + `castle_washed`; balloons from the snapshot). Visual error
  is smoothed (render offset decays over ~100 ms) unless larger than 1 tile (snap).
- Remote players interpolate between buffered snapshots `INTERP_DELAY_MS` behind the newest server
  time observed through the network: `serverNow() - observedLateness - INTERP_DELAY_MS`, where
  `observedLateness` is the smoothed (arrival serverNow - snapshot.serverTime). The literal
  `serverNow() - INTERP_DELAY_MS` starves the buffer once one-way latency exceeds ~100 ms.
- Clock sync: server sends `ping{t: serverNow, rtt: lastRtt}` every 2 s; client echoes
  `pong{t}`; server computes RTT (shown per slot in `snapshot.pings`). Client offset estimate:
  `t + rtt/2 - Date.now()` smoothed. Server tick estimate:
  `snapshot.tick + (serverNow() - snapshot.serverTime) / TICK_MS`. Balloon fuses render from
  `burstTick` vs estimated tick.
- Artificial latency: client `?lag=150` delays every inbound and outbound message by 150 ms
  (preserving order); server `DEV_LAG_MS` does the same server-side.
- Diagnostics (`client/src/game/netStats.ts`, shipped in production, off by default): `?netstats=1`
  or F3 during a match turns on a bottom-right overlay (RTT, input-to-ack delay, pending inputs,
  reconciliation correction px last/p95/max and snap count, interpolation buffer depth and lead,
  snapshot interval mean/jitter, fps); F3 toggles it while a match view is on screen. Once turned
  on it also exposes a frozen read-only `window.splashNetStats` = `{ report(), frames(sinceMs?),
  keys(sinceMs?), reset() }`: the report above, a ~20 s per-frame trace of where each critter was
  drawn, and the key edges. The browser feel/netcode flows (`client/e2e/`) measure through it.
  While off, the collector records nothing.
- Anti-cheat: server never accepts positions; validates message shape, value ranges and
  seq; balloon placement/collision/speed are enforced by the sim; 60 msgs/s token bucket per
  socket (violations -> `error rate_limited`, sustained abuse -> close); max message size.

## 5. Server modules

All paths are under `packages/server/`.

```
boot and wire (net/, net.ts, lag.ts, ticker.ts, session.ts)
src/index.ts             entrypoint: reads the section 1 env vars, createGameServer(...).listen(PORT),
                         graceful shutdown on SIGINT / SIGTERM
src/net/gameServer.ts    createGameServer(opts) -> GameServer {db, health(), listen(), close()}: the
                         composition root. openDb, express (/health, /api, built client), http server,
                         ws at /ws, admission, sessions, rooms, matchmaker and the global Ticker
src/net/static.ts        mountClient(app, dist): built client, SPA fallback, cache headers
src/net/address.ts       clientAddress(req, proxyHops), parseProxyHops, isInternalAddress: client IP
                         behind proxies (X-Forwarded-For only from an internal peer)
src/net/admission.ts     Admission: per-address socket cap and new-guest rate (LAN/loopback exempt)
src/net/registry.ts      SessionRegistry: open sockets + each player's current session; is the Outbox
src/net/outbox.ts        Outbox: send to a player id, silently dropped when that player is offline
src/net/rateLimit.ts     RateLimiter: per-socket token bucket -> 'ok' | 'limited' | 'abuse'
src/net/messages.ts      VALIDATORS (one per C2S type: fresh typed object or null), isC2SType
src/net/validate.ts      readers for untrusted JSON fields (intIn, numberIn, bool, oneOf, text, ...)
src/net/errors.ts        ClientError{code} (a rejected request -> `error {code, msg}`), errorMessage()
src/net.ts               parseClientMessage(raw): C2S | null (size cap, JSON, validators; never throws),
                         createSender(socket, lagMs): Sender {send, close, clear} (JSON, DEV_LAG_MS
                         delay, snapshot skip at 256 KiB unsent, terminate at 1 MiB), SocketLike
src/lag.ts               parseLagMs, DelayLine: order-preserving delay FIFO (synchronous at 0 ms)
src/ticker.ts            Ticker: the one 30 Hz fixed-rate loop (absolute grid, bounded catch-up), serverClock()
src/session.ts           Session (one per socket): identity after hello, sender, rate limiter,
                         ping/RTT, keepAlive (10 s hello timeout, silent-socket drop), emote
                         cooldown; close codes (CLOSE_REPLACED 4000, ...)

message handling (handlers.ts + handlers/)
src/handlers.ts          acceptConnection(ctx, socket, info): per-address admission (else 1013), then
                         per message rate limit -> DEV_LAG_MS -> parse -> dispatch; errors -> `error`
src/handlers/context.ts  ServerContext {db, sessions, rooms, matchmaker, admission, roomCodes, clock}, Handler<T>,
                         playerGone() (leave the queue, idle or free the seat)
src/handlers/account.ts  hello (login / guest creation, takeover, match re-attach), set_nickname,
                         set_cosmetics, pong
src/handlers/lobby.ts    create/join/leave room, set_slot, set_ready, start_match, rematch_vote,
                         room_list_request / room_list_watch
src/handlers/queue.ts    queue_join (needs a claimed nickname, no room), queue_leave
src/handlers/play.ts     input, emote, tutorial_start, tutorial_skip
src/handlers/members.ts  memberInfo(db, playerId): current name, looks and level for rooms + matchmaker

rooms (rooms.ts + rooms/)
src/rooms.ts             RoomManager: every room (casual, practice, hidden ranked, tutorial), membership,
                         lobby_state pushes, match start/end, grace, rematch deadlines, GC; tick(now)
src/rooms/room.ts        Room model: seats (human / bot / open / closed), host, phase, votes (pure state)
src/rooms/lobbyOps.ts    setSlot, setReady, requestStart, enterResults, voteRematch, evaluateRematch,
                         backToLobby
src/rooms/presence.ts    disconnect grace, bot take-over (casual), forfeits (ranked), seat removal
src/rooms/views.ts       lobbyStateFor, roomSummary, participantsOf, arenaOf (wire views)
src/rooms/roomList.ts    RoomListFeed: live public list, full list on watch then <= 2 pushes/s on change
src/rooms/options.ts     planRoom: create-room defaults and the practice-room rules
src/rooms/bots.ts        bot seats: unique names, random looks, MatchParticipant view
src/rooms/codes.ts       ROOM_CODE_ALPHABET, uniqueRoomCode, roomLink
src/rooms/hub.ts         RoomHub: what the rooms/* helpers need from RoomManager

matches (gameLoop.ts + match/, tutorial.ts, matchmaker.ts)
src/gameLoop.ts          MatchRunner: one match, intro -> countdown -> live -> settling -> between ->
                         ended; inputs, bots, simulateTick, events, snapshots, results
src/match/types.ts       BotBrain / BotFactory (structural, see below), MemberInfo, MatchParticipant,
                         MatchSetup, MatchHooks, RoomKind
src/match/rounds.ts      createRound (secret map seed per round + crypto-random contentSeed),
                         roundStartMsg, roundSummaries
src/match/inputs.ts      InputQueues: per-player FIFO, strict seq, press carry-over, starvation stop
src/match/results.ts     round tallies, placements, fun stats, persistInput for results.ts
src/match/config.ts      matchConfigFor (match_start payload), playerInfo (match_found roster)
src/match/tutorialSteps.ts  TUTORIAL_STEPS, TutorialProgress, ensurePowerUpAvailable
src/tutorial.ts          TutorialController: scripted steps over a sandbox MatchRunner
src/matchmaker.ts        Matchmaker: ranked queues (duel/ffa), 2 s ticks, widening ranges, hidden
                         ranked rooms; searchRange, pairDuel, groupFfa

accounts and persistence
src/api.ts               createApiRouter(db): GET /api/leaderboard?mode=duel|ffa, GET /api/profile/:id
src/accounts.ts          loginOrCreate, claimNickname, setCosmetics, buildProfile, buildPublicProfile,
                         completeTutorial (XP once), skipTutorial (no XP); throws AccountError{code} -> `error`
src/elo.ts               applyRankedRatings(db, {mode, rows}) -> RatingDelta[] (uses shared elo)
src/progression.ts       awardXp(db, playerId, earned, breakdown, slot) -> XpAward
src/results.ts           persistMatchResults(db, input) -> {ratingDeltas, xp}: the ONE call the game loop
                         makes at match end (single transaction: matches, match_players, ratings, XP, unlocks)
src/db/                  connection.ts openDb (WAL, pragmas, fails fast on an unwritable DATA_DIR),
                         migrations.ts (numbered SQL) + migrate.ts (run at boot), prepared.ts
                         (per-connection statement cache), typed queries in players.ts, ratings.ts,
                         matches.ts, unlocks.ts; index.ts is the public surface

bots
src/bots/bot.ts          createBot(slot, difficulty, seed, opts?) -> BotBrain (the only entry point)
src/bots/dangerMap.ts    DangerMap: per-tile earliest wet tick incl. chains, kicks, tide
src/bots/*.ts            the brain's planners (escape, attack, drops, kick, hunt, endgame, duck, ...)

tooling
build.mjs                esbuild bundle of the server + @splash/shared -> dist/index.js
scripts/soak.ts          headless bot-vs-bot matches (shared sim + bots), determinism/desync + quality
                         gates; helpers in scripts/soak/
scripts/e2e.ts           boots the real server in-process on an ephemeral port + temp DATA_DIR and
                         drives the acceptance flows over real WebSockets; scripts/e2e/ (+ flows/)
```

Bot interface (consumed by the game loop, soak script and tutorial):
```ts
export interface BotBrain {
  readonly slot: number;
  readonly difficulty: Difficulty;
  /** Called once per sim tick BEFORE simulateTick; returns this tick's input. */
  nextInput(state: RoundState): PlayerInput;
  /** Called at each round start. */
  reset(): void;
}
export function createBot(slot: number, difficulty: Difficulty, seed: number,
  opts?: { passive?: boolean }): BotBrain; // passive: never places balloons (tutorial)
```
Bots read only public state (never `hidden`), may use their own seeded RNG, re-decide every
`decisionMs` (converted to ticks) and otherwise keep following their current path.

**Rooms.** Casual rooms: code = 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Size 2 or 4.
Host = creator (reassigned to the next human if the host leaves). Host `set_slot` on non-human
slots: open / closed / bot(difficulty). Start: host only, >= 2 seated participants, every
non-host human ready; `botFill` fills remaining open slots with Medium bots at start. Practice
rooms: private, auto-filled with bots of `practiceDifficulty`, auto-start. Ranked rooms are
hidden (never listed), created by the matchmaker, start immediately, no bots ever.
Rematch: after `match_end` the room enters phase `results`; majority of connected humans
voting yes within `REMATCH_VOTE_MS` restarts the same room; otherwise it returns to `lobby`.
Casual disconnect: slot stays for `RECONNECT_GRACE_MS` (player idles), then becomes a Medium
bot. Ranked disconnect: 15 s grace, then forfeit (duel: opponent wins the match; FFA: leaver is
removed from later rounds and placed last; opponents credited). A reconnecting player
(`hello` with the same token) is re-attached only while their room is `in_match` and their
slot is still theirs; they receive `welcome`, `lobby_state`, `match_start`, and a
`round_start` with the CURRENT tile grid and `resumeTick`. `leave_room`/disconnect outside a
match clears the slot immediately. A second socket saying `hello` with a token that already has a
live socket takes the session over; the old socket is closed. Rooms with no connected humans die after
`ROOM_EMPTY_TTL_MS`; any room idle `ROOM_IDLE_TTL_MS` is GC'd.

**Match flow.** `match_start` -> wait `MATCH_INTRO_MS` -> `round_start` (startTime = now +
`ROUND_INTRO_MS`) -> ticks -> round over -> `ROUND_OVER_DELAY_MS` -> `round_end` ->
`ROUND_END_MS` -> next round ... until someone reaches `roundsToWin` or `MAX_ROUNDS`.
Placement = round wins desc, then total soaks desc; ties share. Theme `random` re-rolls per
round. `match_end` carries placements, ratingDeltas (ranked), XP awards (humans), fun stats.

### Protocol details (as built)
- `round_start.spawns` are TILE coordinates and list only the slots taking part in the round.
- `GET /api/leaderboard` returns a bare `LeaderboardEntry[]`.
- `queue_status.eta` is whole seconds, -1 = unknown. `FunStat.value` is whole seconds for
  `longest_survivor` (summed over the match) and a count for the others.
- `rematch_vote {yes:false}` is a decided "no" ballot; the client only offers "yes" plus Leave.
- Tutorial rooms never send `lobby_state`; they linger 60 s after completion and are released as
  soon as the player starts another activity. Sandbox revives have no event: the next snapshot
  shows the player alive at their spawn.
- Once a match's outcome is decided (deciding round over), leaving or grace expiry is neither a
  forfeit nor a bot take-over: the player is released and their result, XP and rating stand.
- On re-attach the server also sends `player_status` for every other seat that is offline,
  bot-played or forfeited. Snapshots list exactly the present players; clients mark absent
  slots not present.
- Room names go through the same word filter as nicknames (`src/moderation.ts`); a rejected name
  silently falls back to the default "<nick>'s room".
- Ranked pairs players regardless of address by default (two tabs on one machine, households,
  LAN cafes). Operators worried about alt-account rating farming can set
  `RANKED_SEPARATE_ADDRESSES=1`: players sharing a public client address are then never grouped
  (local/LAN clients have no address and are exempt).
- Close codes: 4000 = session taken over by a newer socket, 4001 = no hello within 10 s,
  1008 = policy (bad version / flood), 1013 = per-address limit. The heartbeat drops a silent
  socket after 7 s (+DEV_LAG_MS); the 15 s grace counts from the last message.
- Wrong room codes (`src/net/roomCodes.ts` RoomCodeGuard): 10 in a burst plus 10 per minute, per
  player and per address; when spent, join_room is refused unseen with `rate_limited`, and 10
  refusals in a row close the socket (1008). Room hits and re-joining your own room cost nothing.
- Re-attaching while a round settles: after round_start (resumeTick) the server repeats that
  round's `round_over` event, so the client shows the outcome and stops predicting.
- GO window: inputs are accepted from tick 0 (startTime) on, i.e. also in the countdown's last
  period, and applied from tick 1; earlier inputs are refused so 3-2-1 key presses queue nothing.
  The client goes live at startTime + TICK_MS (+5 ms slack).
- Per-address limits: 24 sockets and 12 new guests in a burst plus 30 per hour (loopback/LAN
  exempt). Client IP = right-most X-Forwarded-For entry when the peer is internal; set
  `PROXY_HOPS=2` behind a CDN plus a platform proxy.
- Outbound backpressure: snapshots are skipped above 256 KiB unsent; the socket is terminated
  above 1 MiB.

## 6. Client modules

All paths are under `packages/client/`.

```
index.html               the app; src/styles.css (+ ui/styles/, screens/parts/styles/) its CSS
sprites.html             dev-only sprite contact sheet (npm run dev, then /sprites.html); not built

boot, shell and state
src/main.ts              boot: key-code fallback, theme tokens, keyboard input, audio settings +
                         unlock, router/controller, network
src/keyFallback.ts       capture-phase listener that fills an empty KeyboardEvent.code from `key`
                         (remote desktop, virtual keyboards, automation) before any other handler
src/app.ts               router (hash routes) + global server-message -> navigation controller
src/net.ts               WebSocket client: token, hello/welcome, reconnect w/ backoff, ?lag=, clock sync
src/identity.ts          per-tab identity slot via Web Locks (tab 2 in the same browser = a different
                         player); ?identity=N forces a slot
src/storage.ts           crash-proof localStorage wrapper (in-memory fallback)
src/store.ts             tiny observable app store (profile, lobby, match, queue, results, roomList)
src/settings.ts          persisted settings (localStorage, try/catch): volumes, mute, keybinds,
                         colorblind, reducedShake
src/input.ts             keyboard: remappable binds, 60 Hz dir sampling, latched balloon/emote edges, M = mute
src/frame.ts             the 256x224 canvas, integer scaling, UI overlay layer sized to the canvas

match view (game/ + prediction.ts)
src/game/view.ts         canvas match view shared by the game and tutorial screens: owns a
                         GameSession and the requestAnimationFrame loop
src/game/session.ts      GameSession: routes server messages into MatchState (netcode) and
                         EventPresenter (juice), runs the 30 Hz input clock, keeps music in step,
                         builds the Scene each frame
src/game/matchState.ts   one match's client state: authoritative + predicted worlds, predictor,
                         interpolation buffer, tick estimate
src/game/world.ts        the client's copy of a round: round_start grid, then snapshots + events
src/game/clock.ts        30 Hz fixed-step input clock, server tick estimate, 3-2-1 intro phases
src/game/inputPacer.ts   input pacing and the go-live gate (first input at the server's tick 1)
src/game/remoteHold.ts   remote soaks shown on the interpolated render clock, at the soak tile
src/game/interpolation.ts remote snapshot buffer sampled INTERP_DELAY_MS behind observed server time
src/prediction.ts        LocalPredictor (prediction + rewind-replay reconciliation), VisualError
                         smoothing, seq counter
src/game/presenter.ts    EventPresenter: server events -> splash visuals, particles, shake,
                         hit-stop, announcer, kill feed, SFX
src/game/scene.ts        read-only Scene the renderer draws (game/ owns state, render/ only draws)
src/game/labels.ts       announcer, kill-feed, clock and name wording (pure, tested)
src/game/verdict.ts      the match winner as far as the client can tell before match_end
src/game/liveness.ts     is a match still being played (the store keeps finished ones for results)
src/game/netStats.ts     opt-in netcode diagnostics: ?netstats=1 or F3, window.splashNetStats (section 4)
src/game/game.css        in-match DOM overlays (tutorial objectives, completion card, net stats)

presentation
src/render/*             palette, bitmap fonts, procedural sprites (animals, hats, balloons, splash,
                         castles, items, ducks, badges), tilesets, world renderer, HUD, particles,
                         fx, announcer, kill feed, cards, camera/shake; gameRenderer.ts composes a frame
src/audio.ts             audio facade: unlock(), applySettings(), sfx(name), music(track), setShowdown()
src/audio/               engine.ts (AudioContext lifecycle), mixer.ts (buses, compressor, limiter),
                         sfx.ts + voice.ts + voicePool.ts (SFX voices: cap, rate limit, stealing),
                         synth.ts + waves.ts (primitives), sfx-game / sfx-critters / sfx-ui /
                         sfx-jingles.ts (recipes), music.ts + sequencer.ts + song.ts + tracks.ts +
                         notes.ts + instruments.ts (looping chiptunes, lookahead scheduler,
                         showdown tempo), types.ts
src/ui/*.ts              DOM kit: h(), controls, panels, modal, toast, banner, layers, hotkeys,
                         pixel titles; ui/theme.ts = DOM color tokens from render/palette
src/screens/*.ts         title, tutorial, menu, browser, lobby, queue, game, results, leaderboard,
                         locker, settings, howto; index.ts = Screen contract + registry
src/screens/parts/*.ts   building blocks the screens share or split out (shell, dialogs, panels,
                         REST reads for the leaderboard, keyboard/arrow navigation, rules text)
src/dev/contactSheet.ts  the sprites.html QA page: every sprite, frame, theme, icon and glyph

tests and tooling
test/*.test.ts           vitest in the node environment (no DOM library): pure modules, plus fakes
                         such as the audio harness
e2e/run.mjs              Playwright browser acceptance flows flow1..flow6 against a built client
                         (`npm run e2e:browser -w @splash/client`); flow*.mjs are the flows,
                         lib/menus/match/layout.mjs shared steps, pilot/tutorialPilot.mjs drive
                         critters with real key presses, feel.mjs scores netcode feel (the last
                         three read window.splashNetStats)
```

Screen contract:
```ts
export interface Screen {
  mount(root: HTMLElement, params: Record<string, string>): void;
  unmount(): void;
}
```
Routes (hash): `#/` title, `#/tutorial`, `#/menu`, `#/browse`, `#/lobby`, `#/room/CODE`
(join link), `#/queue/duel|ffa`, `#/game`, `#/results`, `#/leaderboard`, `#/locker`,
`#/settings`, `#/howto`.

## 7. Presentation

- Backbuffer 256x224, integer-scaled to the largest fit (`image-rendering: pixelated`), letterboxed.
- Tiles are 16x16. FFA arena 15x13 = 240x208, Duel 13x11 = 208x176. HUD occupies the remaining
  strip(s); a tiny 3x5 font plus a 5x7 font are embedded as bitmap data.
- NES-ish limited palette defined once in `render/palette.ts`; colorblind mode swaps the splash
  and player-identity colors for a CVD-safe set (distinct luminance + shapes).
- Themes (backyard / beach / pool) are pure reskins: floor, boulder, castle, border and water.
- Player identity colors per slot (bandana/outline/HUD chip); animals keep natural colors.

## 8. Database (SQLite, WAL, `DATA_DIR/splash.db`)

```
players(id TEXT PK, token_hash TEXT UNIQUE, nickname, tag, created_at, xp, level,
        selected_animal, selected_hat, has_nickname INT, tutorial_done INT)
ratings(player_id, mode, rating, games, wins, peak, PRIMARY KEY(player_id, mode))
matches(id TEXT PK, mode, ranked INT, started_at, ended_at)
match_players(match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
unlocks(player_id, item_id, unlocked_at, PRIMARY KEY(player_id, item_id))
-- migration 002: matches.player_count (bots are not persisted, so RecentMatch.players needs it)
schema_migrations(version INT PK, applied_at)
```
Migrations are numbered SQL strings embedded in `db/migrations.ts` (so the bundle has no
file-path dependency), applied in order inside a transaction at boot.

## 9. Acceptance (see prompt section 13)

1. Fresh browser: guest auto-created -> tutorial completes -> main menu, < 3 min.
2. Tab A creates public 4p room with 2 Hard bots; Tab B sees it, joins; full match completes
   with correct results and XP.
3. Tabs A+B queue ranked Duel -> matched -> finish -> both ratings update in SQLite and the
   leaderboard reflects it after refresh.
4. `?lag=150`: local movement instant, remote players smooth.
5. Vitest: 3-balloon chain in one tick; splash stops at first castle; same seed -> same map
   and hidden contents; Elo fixtures (duel + 4p pairwise).
6. Bots never freeze or self-soak; Hard reliably beats Easy.
7. `npm run build && npm start` on one port; Dockerfile with SQLite on a volume.
