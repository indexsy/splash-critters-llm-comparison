<!-- Full audit report for kimi-k2.7, produced by an independent Claude Fable 5 subagent, 2026-07-17. -->

# Audit Report: `results/kimi-k2.7` — Splash Critters submission

All paths relative to `/Users/jackychou/splash-critters-llm-comparison/results/kimi-k2.7/packages/`. All claims verified by reading source; the SQL crash was additionally reproduced empirically against the vendored better-sqlite3.

---

## 1. SPEC FIDELITY — SCORE 4/10

**Implemented (real):**
- Core sim: grid movement, balloon placement, cross splash blocked by boulders, stops at first castle (`shared/src/sim.ts:278-311`), splash linger 12 ticks, fuse 90 ticks (`shared/src/config.ts:26-27`).
- Chain bursts in one tick via a real queue: `while (toDetonate.length > 0)` with a `detonated` set (`sim.ts:268-321`); chained balloons use their own range (`sim.ts:279` uses `b.range`).
- Power-ups pre-rolled at map gen from the round seed: `map.ts:34-37` rolls `castle.powerUp` inside `generateMap` — deterministic per seed (test-verified). But see Security: the "unguessable" half is violated.
- Rising tide: correct timing (start 3600 ticks = 2:00, ring per 45 ticks ≈ 1.5s, `config.ts:44-45`), floods inward, soaks players and dissolves castles (`sim.ts:400-430`), rendered by client (`client/src/render/sprites.ts:27-38`).
- Matchmaker widening ±100 → +50/10s → cap 400 (`server/src/matchmaker.ts:41-44` with `config.ts:69-72`), live `queue_status` (matchmaker.ts:46-50). *But the resulting match never starts — see Correctness #1.*
- Pairwise FFA Elo with K′=K/3 and K=64→32 at 10 games (`shared/src/elo.ts:55`, `elo.ts:7-9`, `config.ts:76-78`); tiers match spec bands (`config.ts:81-88`).
- XP/levels/unlocks: `xpForLevel(n)=100+25n` (`config.ts:148-150`), level-gated animal/hat unlock rows written in `db/index.ts:182-199`; leaderboard + profile REST (`server/src/index.ts:64-80`).
- Room GC (`rooms.ts:231-237`), 60 msg/s rate limit (`net.ts:78-86`), bots with per-slot Easy/Medium/Hard and a chain-propagating danger map (`server/src/bots/dangerMap.ts:63-71` inherits `min` fuse).

**Missing / stubbed / broken:**
- **Balloon kick: effectively unreachable** — balloons are solid to everyone but the owner (`sim.ts:124-129`), movement clamps you outside the tile (`sim.ts:150-155`), and the kick trigger requires standing *on* the balloon's tile (`sim.ts:170-174`). With `ENABLE_KICK: true`, a booted player walking into an enemy balloon just stops. Only your own ≤5-tick-old balloon can ever be kicked. Bots never kick (`bot.ts:60` `kickPressed: false` always).
- **Revenge ducks: dead code.** `revengeDuck = true` is never assigned anywhere (grep across all packages), `revenge_lob` exists only as a type (`shared/src/types.ts:118`), `REVENGE_LOB_COOLDOWN_TICKS` never referenced. Soaked players just watch.
- **Reconnect grace / forfeit / bot conversion: absent.** `RECONNECT_GRACE_MS` (`config.ts:100`) is never used; on `ws close` the player is removed immediately (`server/src/index.ts:99-106`); `rooms.ts:131` literally says `// If running match, convert to bot after grace (handled elsewhere)` — it is handled nowhere. `addConnectionToMatch`/`removeConnectionFromMatch` (`gameLoop.ts:207-213`) are never called.
- **Emotes: no-op.** Server handler: `// handled in snapshot via emote fields; simplistic` then `break` (`index.ts:220-224`); no client screen ever sends `emote` (grep); `EMOTE_COOLDOWN_TICKS` unused; `emoteUntilTick` never set.
- **Rematch vote: unreachable + wrong.** Server logic exists (`rooms.ts:218-229`, majority = `Math.ceil(humans/2)`) but no client code ever calls `net.rematchVote` (grep of `client/src` — zero call sites; ResultsScreen exits to menu on any key, `results.ts:41-47`). It also only returns to lobby, it doesn't restart the match.
- **Settings: shell.** No keybind remap, colorblind palette, reduced shake, or volume sliders — grep for `colorblind|shake|remap|keybind|volume` in client returns nothing; `settings.ts` shows nickname prompt + "M: toggle mute" text only.
- **Tutorial: 6 text slides** (`tutorial.ts:7-14`), not the spec's scripted playable arena vs an Easy bot.
- **Profanity filter: 5-word stub** — `["bad", "evil", "hate", "kill", "damn"]` (`db/index.ts:95-98`).
- Also missing: `roundsToWin` option ignored (gameLoop hardcodes `CONFIG.ROUND_WIN_FIRST_TO`, `gameLoop.ts:176`), `/#/room/CODE` links (no `location.hash` anywhere), room-browser mode filter never set (`browser.ts:8` `mode` never assigned), locker never persists (client comment `// In real app, send to server; here update locally`, `locker.ts` onKey Enter; `updateSelection` in `db/index.ts:171` has zero callers), castles-washed XP never counted (`gameLoop.ts:133-135` comment "no owner attribution"; `stats.castles` always 0), no kill feed / VS card / fun-stat awards, no artificial-latency flag.

---

## 2. SECURITY & ANTI-CHEAT — SCORE 3/10

- **(a) CRITICAL PROBE: CONFIRMED CHEATABLE.** `gameLoop.ts:64` `const seed = Math.floor(Math.random() * 0x7fffffff)` → `createRoundState(mode, roundNo, seed, …)` (line 66-69) → `generateMap(mode, mapSeed, theme)` (`sim.ts:20`) which rolls **hidden power-up contents from that same seed** (`map.ts:25` `mulberry32(seed)`, `map.ts:34-37`). That exact seed is then sent to every client: `send(c.ws, { type: "round_start", roundNo, mapSeed: seed, castleGrid: grid, theme })` (`gameLoop.ts:87`). Worse than derivable: the legit client *already reconstructs the full hidden contents* — `game.ts:119` calls `createRoundState(this.mode, msg.roundNo, msg.mapSeed, …)`, so every castle's `powerUp` sits in client memory from tick 0. The spec's "contents are never sent to clients until revealed (unguessable, unhackable)" is violated outright; the server's separate `castleGrid` (booleans only) is stored but never even used (`game.ts:121`, `castleGrid` has no other reference).
- **(b) Input validation: shallow.** `validateInput` (`net.ts:98-109`) checks types only. `typeof NaN === "number"`, so `dir: {x: NaN, y: 0}` passes; `normalize` (`sim.ts:106-110`) then returns NaN components (`Math.hypot(NaN,0)` ≠ 0), `p.pos` becomes NaN, and since `onTile` (`sim.ts:116-118`) and `isFlooded` (`sim.ts:432-436`) both compare against `Math.floor(NaN)`, the cheater **can never be soaked by splashes or tide and the round can never end** (`checkRoundEnd` counts them alive, `sim.ts:438-448`). `create_room` opts are entirely unvalidated (`index.ts:156-163` passes `msg.opts` straight to `createRoom`) — arbitrary-type/length room `name`, junk `mode`/`theme` accepted.
- **(c) Rate limiting: real** — 60 msgs/s per connection, enforced first thing in `handleMessage` (`index.ts:115-118`, window logic `net.ts:78-86`), plus a 4096-byte message cap (`index.ts:90-93`). Gap: `hello` arrives before a `Connection` exists (`c` undefined skips the limiter), and each token-less `hello` mints a fresh DB player row (`index.ts:121-127`, `db/index.ts:106-113`) — unbounded DB-fill once the crash bug is fixed.
- **(d) Token: hashed.** SHA-256 before storage and lookup (`db/index.ts:81-83`, `:103`, `:113`). Good.
- **(e) SQL: all parameterized** — every other `db.prepare` uses `?` placeholders (checked all 24 call sites); no injection. The two landmines are `db/index.ts:132-133`: `db.prepare("INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at)").run(id, "animal:duck", now)` (and the `hat:none` twin) — missing `VALUES (?, ?, ?)`. **Empirically reproduced**: `prepare()` on that string throws `SqliteError: incomplete input`. No other malformed statements found.
- **(f) No error boundary: any throw kills the server.** The only try/catch in the entire server is JSON parsing (`net.ts:89`) and the soak script (`soak.ts:7`). `handleMessage` (`index.ts:113-245`) has none, there is no `uncaughtException`/`unhandledRejection` handler (grep: zero), and the game/matchmaker `setInterval` loops (`index.ts:299-335`) are equally unguarded. So the first `hello` → `findOrCreatePlayer` → `SqliteError` → **process exit**. Even after fixing the SQL, any future throw in a message or tick path is fatal.

---

## 3. CORRECTNESS BUGS (beyond the known SQL crash) — SCORE 3/10

1. **Ranked matches can never start (Elo is unreachable).** The matchmaker path (`index.ts:302-320`) does `createRoom(host, opts)` then `joinRoom` for the others — and `joinRoom` sets `openSlot.ready = false` (`rooms.ts:105`). `startRoomMatch` → `canStart` requires every human slot ready (`rooms.ts:165`) → returns `null` (`rooms.ts:169`). So `if (rm) rm.match.ranked = true` (`index.ts:319`) never runs and `match_found` is never sent (protocol defines it, `protocol.ts:28`; client waits for it, `queue.ts:46`; server has zero senders — grep). Matched players are dumped into a hidden lobby; even if they manually press R/S, the `start_match` handler (`index.ts:200-206`) starts it with `ranked: false` (`rooms.ts:177`), so `onMatchFinish` takes the casual branch (`index.ts:252`) and no Elo is ever applied. Acceptance criterion 3 is impossible.
2. **Players with 0 round wins vanish from results, XP, and Elo.** Placements are built from `Object.entries(rm.match.roundWins)` (`index.ts:255`, `server/src/elo.ts:6,12`), but `roundWins` only gains a key when a player *wins* a round (`gameLoop.ts:163`). A 4p player who wins nothing gets no placement, no XP, no `match_players` row. In a ranked 3-0 duel, `placements` has one entry and `const [a, b] = placements; … b.placement` (`elo.ts:21-25`) throws `TypeError: Cannot read properties of undefined` — inside the unguarded tick interval → whole-server crash (latent behind bug #1).
3. **The balloon's own tile is never splashed.** Splash tiles are generated only for `step = 1..range` in the four directions (`sim.ts:279-281`); no splash is pushed at `(b.tx, b.ty)`. A player standing on a balloon — trivially its owner, who just doesn't move after placing — is immune to that burst and to any chain passing through it. The bots' danger map is consistent with the same blind spot (`dangerMap.ts:55`), so bots also treat balloon tiles as safe.
4. **Client prediction input aliasing.** `GameScreen` keeps one `input` object (`game.ts:33`) and pushes *the same reference* every tick (`game.ts:58` → `prediction.ts:17-19`), so `inputHistory` is up to 60 aliases of one object whose `tick` is overwritten each frame. On every snapshot, `filter((i) => i.tick > snap.tick)` (`prediction.ts:42`) matches all-or-nothing, replaying up to 60 identical ticks — and the client starts simulating at `round_start` while the server waits out a 90-tick delay (`gameLoop.ts:36,96-99`), guaranteeing the client clock runs ahead. Result: constant multi-tick fast-forwards, fuses bursting early locally, warping.
5. **Room GC kills live matches.** `gcRooms` deletes any room idle >10 min with no `runningMatch` check (`rooms.ts:231-237`), and `lastActivityAt` is not refreshed during play (only lobby actions and `startRoomMatch`, `rooms.ts:214`). A match exceeding 10 minutes is silently dropped from `getAllRunningMatches()` (`rooms.ts:267-269`) and freezes forever for its players.
6. (Minor) `player_soaked` particles read `ev.tx/ev.ty` (`game.ts:164`) which the event never carries (`types.ts:114`), and `chain_burst` fires for any ≥2 balloons expiring the same tick even if unconnected (`sim.ts:262,268-270,323-325` — `chainCount` counts all detonations, not chain links).

---

## 4. NETCODE — SCORE 3/10

- **Prediction is structurally real but functionally broken.** `Predictor` (`prediction.ts`, 54 lines) does keep input history, apply the server snapshot as a rewind (`applySnapshot`, `prediction.ts:39`), and re-simulate "unacked" inputs (`prediction.ts:42-52`) — genuine rewind-replay shape, not pure cosmetics. But there is **no server ack**: snapshots carry no last-processed-seq (see `Snapshot`, `types.ts:128-147`), so reconciliation keys off the client's own tick numbering, which the aliasing bug (Correctness #4) and the round-start delay mismatch corrupt.
- **Interpolation: absent entirely.** Grep for `INTERP|interp|serverTime` in `client/src` returns nothing; `INTERP_DELAY_MS` (`config.ts:6`) is dead. Remote players' `pos` is overwritten raw on each 15Hz snapshot (`sim.ts:497`) and frozen (dir `{0,0}`) during local prediction ticks (`prediction.ts:29,47`) — i.e., remote entities stutter-teleport 15 times a second; the spec's "serverTime − 100ms" buffer does not exist.
- **Rates are right**: 30Hz sim (`index.ts:323-328`), snapshots every 2nd tick = 15Hz (`gameLoop.ts:139-144`), ping every 2s (`index.ts:330-335`) — but the measured `latency` (`index.ts:233`, `net.ts` client) is never used for anything (no clock offset, no fuse rendering from server timestamps).
- Server consumes only the **latest** buffered input per tick (`gameLoop.ts:113` `c.inputBuffer[c.inputBuffer.length - 1]`), discarding intermediate presses; `setPlayerInput`/`rm.inputs` (`gameLoop.ts:203-205`) is written but never read. No artificial-latency dev flag (spec M2/acceptance #4).

---

## 5. CODE QUALITY — SCORE 5/10

- **Layout matches the spec folder-for-folder** (shared: config/types/rng/map/sim/protocol/elo; server: index/net/rooms/gameLoop/matchmaker/elo/db/bots; client: all 11 screens + render/ + prediction/audio) and all files are modest (largest `sim.ts` at 515 lines).
- **Shared sim is pure**: grep for `Math.random|Date.now` in `shared/src` (non-test) returns nothing; bots use seeded `mulberry32(hashString(id) + tick)` (`bot.ts:49`) so bot matches replay deterministically (soak verifies this). Strict TS is on (`tsconfig.base.json` `"strict": true` plus `noUnusedLocals` etc.).
- **Typing discipline is mixed**: `any` leaks at boundaries — `profile: any` (`net.ts:10`), `(b as any).placedTick` bolted onto `Balloon` outside its type (`sim.ts:126,195`), `room.ranked = true as any` (`index.ts:317`), `as any[]` throughout db reads.
- **Notable dead code**: `updateSelection`, `levelForXp`, `placementsFromRounds`, `assignRandomBotNames`, `encodeMsg/decodeMsg`, `setPlayerInput`/`rm.inputs`, `addConnectionToMatch`/`removeConnectionFromMatch`, `castleGrid` on the client, and config keys `CLIENT_INPUT_BUFFER_MS`, `INPUT_SEND_RATE`, `EMOTE_COOLDOWN_TICKS`, `REVENGE_LOB_*`, `RECONNECT_GRACE_MS`.
- **"Numbered SQL migrations" is a façade**: `db/migrations/001_init.sql` exists but nothing reads it (grep `migrations|readFile` in server src: zero); boot runs the inline `MIGRATION_SQL` string with a token `schema_version` insert (`db/index.ts:9-79`). The inline schema also drops the spec's `level` denormalization gracefully (computed from xp — fine), and `matches.started_at` is recorded as end-time (`db/index.ts:232-238`). Presentation is far below the spec's 8-bit bar: players are 12px rectangles with a white strip for any hat (`sprites.ts:79-97`), no walk cycles/tile art/soak animation; `built dist/` folders are committed into the repo.

---

## 6. TEST DEPTH — SCORE 4/10

7 tests, all pass (verified: `vitest run` → "Tests 7 passed (7)").
- `sim.test.ts` (5): boulder layout (`:8-13`); **seed determinism incl. hidden power-ups** — two `generateMap(dup seed)` calls compared cell-by-cell on `powerUp` (`:15-23`); splash stops at first castle (`:27-50`, though its final comment admits it doesn't assert the castle *behind* survives — no second castle placed); **3-balloon chain bursts in one tick** — one `simulateTick` then asserts `chain_burst.count === 3` and `balloons.length === 0` (`:52-74`); mulberry32 determinism over 10 draws (`:78-82`).
- `elo.test.ts` (2): `duelDelta(1000,1000,1,0) === 32` — correct for provisional K=64 but the test name "equal ratings gives zero net" is wrong (`:5-8`); FFA pairwise sum-to-zero + winner-positive/loser-negative signs (`:10-24`). **No fixture pins actual pairwise delta values, no K′=K/3 assertion, no K 64→32 transition test** — the spec's "Elo fixtures … match expected values" is only half-met.
- The soak script (`soak.ts`) is better than the unit suite: full bot-vs-bot duel+FFA runs with a **full replay determinism check** (`JSON.stringify(snap1) !== JSON.stringify(snap2)` → desync, `:39-43`) — but it requires `npm run build` first and isn't part of `npm test`. Nothing tests players being soaked, kick, tide, reconnection, matchmaker, or the DB layer — which is exactly why the first-hello crash and the ranked-never-starts bug shipped.

---

## TOP FINDINGS

1. **Server dies on the first client hello** — `db/index.ts:132-133` prepare `"INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at)"` with no `VALUES` clause (reproduced: `SqliteError: incomplete input`), thrown inside a ws message handler with zero try/catch or process-level handlers (`index.ts:87-245`) → process exit. The game is unplayable as shipped.
2. **Hidden power-ups are fully client-known** — the round seed that rolls castle contents (`map.ts:25,34-37`) is broadcast in `round_start` (`gameLoop.ts:64,87`) and the client itself regenerates contents from it (`game.ts:119`), violating the spec's "unguessable, unhackable" requirement by construction.
3. **Ranked mode is unreachable end-to-end** — matchmade rooms fail `canStart` because joiners are never marked ready (`rooms.ts:105,165,169`), `match_found` has zero senders, and the `ranked` flag is only set on the null-returning path (`index.ts:314-319`), so Elo/forfeit code can never execute; reconnect grace (`RECONNECT_GRACE_MS`) is defined but wired to nothing.
4. **Result-corruption: zero-round-win players are erased** from placements/XP/Elo because standings derive from `roundWins` keys (`gameLoop.ts:163`, `index.ts:255`, `elo.ts:6-25`), and a 3-0 duel would crash `finalizeRankedMatch` on `b.placement`.
5. **Signature mechanics are stubs behind real config flags** — kick is unreachable (solid-balloon collision vs on-tile trigger, `sim.ts:124-129,170-174`), revenge ducks never activate (no `revengeDuck = true` anywhere), emotes are a server no-op (`index.ts:220-224`), and standing on a balloon grants burst immunity (`sim.ts:279-281` never splashes the center tile).

## ONE-LINE VERDICT

A spec-shaped skeleton with a genuinely deterministic shared sim and correct Elo math at its core, but it crashes on the first connection, leaks the "hidden" power-up seed to every client, can never start a ranked match, and ships its depth mechanics (kick, revenge ducks, emotes, reconnect) as dead code — roughly M1.5 of 6 milestones actually works.
