<!-- Audit of the 'Muse Spark 1.3' submission by an independent Claude subagent, 2026-09-02, under the
     SAME neutral rubric the rivals got, PLUS a second independent fact-checker. The orchestrator
     (Fable 5) additionally verified firsthand: playable to Round 2, round 1 renders, the one-packet
     crash + its root cause, the seed leak, the rate-limit self-DoS, and the fake ping. -->

# Splash Critters audit: Muse Spark 1.3

Environment: copied the tree to scratchpad (source untouched), `npm install` + `npm run build` green, `npm test` 11/11 green, `npm run soak` prints `SOAK PASS`. All probes below ran against the built `dist/` output.

---

## 1. SPEC FIDELITY: SCORE 4/10

Structurally almost every spec item has a file, but a large share is stubbed, dead, or only looks implemented.

**Implemented for real**
- Chain bursts in one tick via BFS queue: `sim.ts:309-339` (`while (queue.length > 0) { const b = queue.shift()! ... o.fuse = 0; queue.push(o)`), chained balloons use own `b.range` (`sim.ts:184`). Verified: 3-chain test and my probe [4] (splash stops at castle, balloon behind it survives).
- Power-ups pre-rolled at map gen from the round seed: `map.ts:71-75` (`if (rng() < CONFIG.POWERUP_BLOCK_CHANCE) crow.push(pickWeighted(rng, ...))`); contents are not in `round_start.castles` (`net.ts:480` sends `tiles` only).
- Balloon kick: `sim.ts:126-153` sets `slideX/slideY/slideT`, `sim.ts:281-304` slides tile-by-tile and stops on boulder/castle/balloon/player. Probe [3]: kicked balloon slid 4>5>6>7>8>9>10 keeping fuse. Bots never kick, and `dangerMap.ts:63-71` marks only the balloon's current tile, not its slide path.
- Rising tide: `sim.ts:421-449`, ring 1 at tick 3600 is the border boulders (nothing floods until +45 ticks), cap `floor(min(w,h)/2)`.
- Pairwise FFA Elo with K'=K/3 and K 64→32 after 10 games: `elo.ts:8-10` (`games < ELO_NEW_GAMES ? 64 : 32`), `elo.ts:51` (`kFor(...) / 3`), tie groups built in `eloApply.ts:52-62`, `peak` maintained in `db.ts:121`.
- Matchmaker widening ±100 → +50/10s → cap 400: `matchmaker.ts:34,59` (`min(400, 100 + floor(elapsedS/10)*50)`). ETA is a fake formula: `net.ts:444` `etaS: Math.max(2, 12 - elapsed)`.
- Rematch majority: `net.ts:266-268` `votes > voters / 2`. Emote rate limit 1.5s: `net.ts:255`. Profanity: 10-word substring list `db.ts:89-96`. Settings really are read by render code: keybinds `game.ts:47-52`, colorblind `game.ts:112,208-210`, shake gate `particles.ts:52-55`.
- 15s reconnect grace + ranked forfeit timer: `net.ts:371-385`.

**Fake / dead / stubbed**
- **Revenge ducks do not ride the border.** `sim.ts:474-477` flips `isDuck` in place, `sim.ts:111-116` then clamps to the whole arena and ignores tiles. Probe: duck spawned at its death tile (7.5,5.5), walked through pillar row, lobbed 3 tiles from mid-arena (`sim.ts:237-239`). Ghost mode, not a border ride.
- **Casual disconnect → Medium bot is dead.** `rooms.ts:337-349 substituteBot` flips the slot to `bot` but never clears `p.disconnected`; `sim.ts:204` (`if (p.disconnected) continue;`) and `sim.ts:228` skip the player. Probe [B2]: after substitution `h2.disconnected=true moved=false balloons placed=0` across 71 live ticks while `game.inputs.h2={dx:-1...}` was being computed every tick.
- **Tutorial is not "vs an Easy bot".** `tutorial.ts:103-116` drives a dummy that picks a random direction every 40 ticks at `speed = 1.2` (`tutorial.ts:48`) and never drops a balloon; no chain step is required (`tutorial.ts:127-130`).
- **Bot fill toggle ignored**: `botFill` exists only in `protocol.ts:10` and the client; `net.ts:151-171` never reads it. "Practice vs Bots" is a `sessionStorage` hack (`lobby.ts:67-73`).
- **Unlocks**: `unlocks` table is created (`001_init.sql:44-49`) and never written or read; `/api/profile` omits `unlocks` (verified live: keys `id,nickname,tag,level,xp,animal,hat,ratings,recent`). Level gating is client-only (`locker.ts:49,61`); server accepts any cosmetic (`net.ts:109-116`), verified: level-1 guest set `capybara/crown`.
- **Results screen stubs**: `results.ts:30` literally renders "Castle Crusher & Longest Survivor & Biggest Chain tracked in stats feed"; `results.ts:36` "XP bar ... (refreshes on next welcome)" and no welcome is re-sent after a match, so the level shown is stale.
- No VS card / countdown gate: `game.ts:90` shows a text banner while the sim already runs (fuzz log shows `balloon_placed ... tick: 4`).
- Hit-stop is dead: `particles.ts:57-59` sets `hitStop`, nothing ever pauses the loop. Showdown "speed-up" never changes tempo: `audio.ts:114` fixes the interval at `startMusic` time.
- `nickSet` is per-connection only (`net.ts:130-133`, comment at :131 admits it): a player must re-save their nickname every session before ranked. Nickname uniqueness is not enforced: `db.ts:103` plain `UPDATE players SET nickname=?` with no unique index; the "taken" catch at `db.ts:105-107` can never fire.
- Room GC can kill a live match: `rooms.ts:400` destroys any room with `now - lastActive > 20min` regardless of `status`, and `lastActive` is never touched during play (only `rooms.ts:153,165,189,201,385`); `destroy` clears the timer and drops the room with no `match_end`.

---

## 2. SECURITY & ANTI-CHEAT: SCORE 2/10

**(a) Seed probe: confirmed, 100%, and gratuitous.** `net.ts:476` ships `mapSeed: game.state.seed` (the real seed from `rooms.ts:250`) with the castle grid. `map.ts:51` opens one `mulberry32(seed)` stream and `map.ts:71-75` rolls castle placement *and* hidden contents from it. Probe: `generateMap(mode, leakedSeed)` reproduced 13/13 (duel) and 19/19 (ffa) hidden power-ups, including the 0.05-weight Boots tile. The shipped client bundle contains the mulberry32 constant and the weight table, so no extra code is needed. The in-match client never reads `mapSeed` (only `tutorial.ts:32`, a hard-coded `42`), so the leak buys nothing.

**(b)+(f) Malformed frames crash the process.** `net.ts:72` parses JSON, then `net.ts:78` reads `msg.kind` and `net.ts:79` calls `handleHello(ws, msg.token)` **before** the `try` at `net.ts:96`. `db.ts:41` does `createHash('sha256').update(token)` with no type check. No `process.on('uncaughtException')` anywhere. Booted the built server and observed, each on a fresh process:

| pre-auth frame | result |
|---|---|
| `{not json` | `error:bad_json`, alive |
| `null` (5 bytes) | **process exit 1** (`TypeError` reading `kind` of null) |
| `{"kind":"hello","token":12345}` | **process exit 1** `ERR_INVALID_ARG_TYPE` |
| `token:{"a":1}` / `token:["x"]` / `token:true` | **process exit 1** each |
| `123` / `"str"` / `[]` / `{}` / `kind:5` / `kind:"__proto__"` | `no_auth`, alive |
| 2 MB and 20 MB text frames, binary frame | `bad_json`, alive (no `maxPayload` set, `index.ts:77`) |

Five distinct unauthenticated one-frame remote DoS vectors. Post-auth garbage (`set_nickname:123`, `set_slot slot:'a'`, `input dx:1e308`, etc.) is caught by the `net.ts:96-280` try/catch and answered with `server_error`, no desync observed. `set_slot difficulty:'godlike'` is accepted (`net.ts:221`, `rooms.ts:199`) and yields a bot with `undefined` interval, i.e. one that decides every tick.

**(c) Rate limiting** is real but post-auth only (`net.ts:87-94`): 200-msg burst → 140 `rate_limit` replies, socket never closed (reply amplification). Pre-auth there is none: 500 bad-JSON frames → 500 error replies; 100 token-less `hello`s on one socket → 100 `welcome`s = 100 guest rows + 200 rating rows, unbounded.

**(d) Tokens**: sha256 hashed (`db.ts:40-42`) and REST coerces via `String()` (`index.ts:53`), but the WS path does not (crash above). Worse, `db.ts:67` `const raw = token || randomUUID()` lets the client choose its own credential: verified `hello{token:"a"}` → `welcome.token:"a"`. `/api/tutorial` (`index.ts:52-65`) has no idempotency: 5 calls → `xp:125, level:2`, unlimited XP farming.

**(e) SQL**: every statement in `db.ts` is `?`-parameterized; `mode` is whitelisted at `index.ts:22`. Good.

---

## 3. CORRECTNESS: SCORE 2/10

1. **Every bot suicides on its own first balloon.** `dangerMap.ts:85` defines unsafe as `v <= escapeTicks + SPLASH_TICKS` (≤22 ticks), so a fresh 90-tick balloon is "safe". `bot.ts:95-101` BFS pred `!isUnsafe(d2,x,y,10)` is true on the start tile, `bfs` returns `{dx:0,dy:0,dist:0}` at `bot.ts:52`, the bot places and sets `m.dirX=m.dirY=0` (`bot.ts:187-188`), then only notices danger when ≤22 ticks remain, too late to travel 3 tiles at 0.133 tiles/tick. Measured: easy/medium/hard mirror duels 35/38/38 self-soaks in 20 rounds each; **Hard 0 / Easy 12** in 12 first-to-3 matches; **an idle human who never presses a key beats 3 Medium bots 8/8**, average round 99 ticks (3.3s). This is the failure mode the "Bots never freeze or soak themselves; Hard reliably beats Easy" acceptance criterion exists to catch.
2. **Bots go stale between rounds.** `bot.ts:113` gates on `s.tick - m.lastDecisionTick < interval` and `rooms.ts:237` calls `resetBot` only in `startMatch`, never in `startRound` (`rooms.ts:246-273`). After a 1500-tick round, round-2 Hard bots placed their first balloon at tick 1501 (fresh bots: tick 4). A long round 1 leaves bots walking into walls for the same duration in round 2.
3. **Voluntary leave never forfeits.** `net.ts:211-217` → `rooms.ts:174-178` only marks `disconnected`; `forfeitRanked` lives solely inside the `onClose` timer (`net.ts:371-385`). Probe [B3]: after `leaveRoom` during play `room.status=playing`, player still in slots. In ranked the opponent must wait for the tide to soak a frozen player three times (~7 min); the leaver can queue again immediately with `roomCode` still pointing at the old room. FFA forfeit also ends the whole match for the other three (`net.ts:570` `this.rooms.endMatch(room)`).
4. **Round-1 client render race (code analysis, not browser-verified).** `net.ts:464-465` broadcasts `match_start` and `round_start` back-to-back synchronously; `lobby.ts:81-82` / `queue.ts:29-32` call `nav('#/game')` on the preceding message, and `main.ts:19-22` only mounts on the async `hashchange`. `round_start` is dispatched to the old screen, `game.ts:87` never fills `localCastles`, and `game.ts:200-205` draws no castles or boulders for round 1 (invisible walls), with `session.w/h` defaulting to 13×11 even in FFA.
5. **Self-soaks are credited as kills.** `sim.ts:478` excludes `killerId === p.id`, but `net.ts:526` `if (e.t === 'player_soaked' && e.b) live[e.b]++` does not; `eloApply.ts:23` prefers `live`, so a self-soak adds +15 XP (`eloApply.ts:79`) and a placement tiebreak point (`eloApply.ts:26`). Probe [1]: same-tick mutual soak yields `winner=["p1","p2"]` (draw handled correctly at `sim.ts:461-465`, `rooms.ts:321`) but events `p1<-p1, p2<-p1` credit p1 twice. Also `sim.ts:349-351` credits every castle in a cascade to `burstOrder[0].ownerId` regardless of whose balloon reached it.

Ranked does start (`createRankedRoom` slots are humans, `startMatch` guard passes) and `round_start` is not double-sent (`rooms.ts:372` `onSnapshot` fires `sendRoundStart` once via `net.ts:489`, then `lastRoundSent` matches).

---

## 4. NETCODE: SCORE 3/10

- Rates are right: `rooms.ts:242` `1000 / CONFIG.TICK_RATE` (30 Hz), `rooms.ts:312` `tickCount % 2` (15 Hz). Client samples per rAF and sends every 2nd frame (`game.ts:172-181`), so both are display-refresh dependent.
- **Prediction is cosmetic.** `prediction.ts:38-50 pushLocal` moves `px/py` by `speed/60` with zero collision (walks into castles), pushes to `buf` which is **never read** (`prediction.ts:47-48`); `reconcile` (`prediction.ts:52-68`) is "snap if err > 1.2 else lerp 0.35". No ack: server sends `input.tick: 0` (`net.ts:249`) and snapshots carry no `lastSeq`. No rewind-replay exists.
- **Interpolation is at local-receive-time − 100 ms**, not serverTime − 100: `prediction.ts:83` `performance.now() - INTERP_DELAY_MS + this.clockOffset` with `clockOffset = 0` assigned at `prediction.ts:26` and never updated.
- **Ping readout is fake.** Server sends `ping{t: Date.now()}` (`net.ts:54`); client sets `pingMs = Date.now() - t` on receipt (`net.ts:38`), i.e. one-way latency plus inter-machine clock skew (can be negative). The `pong` only stamps `lastPong` (`net.ts:274-276`), which nothing reads. `lastPing` (`client/net.ts:11`) is unused.
- Fuses render from the last 15 Hz snapshot value (`game.ts:209` `drawBalloon(..., b.fuse, ...)`), not from server tick timestamps.
- `latency=150` flag delays only outgoing inputs (`game.ts:78`), not inbound snapshots.

---

## 5. CODE QUALITY: SCORE 5/10

- Folder layout matches the spec exactly; strict TS (`tsconfig.base.json`), zero `any`.
- **Shared sim is pure**: grep of `packages/shared/src` for `Math.random|Date.now|performance.now|setTimeout` returns nothing; probe [8] confirms 200-tick determinism. All randomness lives in server (`rooms.ts:61,68,250`, `db.ts:48-50`, `bot.ts:105` default `rng = Math.random`).
- Typing escapes: 8× `as unknown as` (`net.ts:527`, `eloApply.ts:14` smuggling `soaksLive` onto `RoomGame`; `rooms.ts:215` `null as unknown as GameState`; `tutorial.ts:48,109-113` monkey-patching `wx/wy` onto a `PlayerState`), 1× `as never` (`bot.ts:88`), ~34 non-null assertions, 9× `void x;` suppressors (`net.ts:215,572`, `rooms.ts:262`, `bot.ts:91`, `eloApply.ts:81-82`, `boot.ts:22`, `game.ts:258`, `client/net.ts:58`).
- Dead / no-op code: `rooms.ts:303-305` and `:322-324` accumulate `totalSoaks` with `+ 0`; `rooms.ts:259-262` computes `revenge` then voids it; `sim.ts:127` unused `tx`; `types.ts:84 tideTick` and `PredState` (`prediction.ts:6-10`) unused; `session.castles` unused; `uuid` dependency unused (`server/package.json:15`); `soak.ts:53-55` empty `if` block; `ready` flags collected but never gated (`rooms.ts:205-210`).
- `001_init.sql` is not copied to `dist/db` (only `db.js`), so production silently uses `fallbackSql()` (`db.ts:16-23`, `:30-34`); the two schemas happen to match today.
- No `process.on('uncaughtException')`; comments repeatedly narrate uncertainty (`rooms.ts:325-326`, `sim.ts:388-393` "acceptable approximation").

---

## 6. TEST DEPTH: SCORE 4/10

Unit tests (11) are honest for what they cover:
- `sim.test.ts:14-39` splash stops at first castle (asserts (2,1),(3,1) hit, (4,1) not, castle cleared): real.
- `sim.test.ts:41-61` 3-balloon chain bursts in one tick (`balloons.length === 0`, `chain_burst count 3`): real.
- `sim.test.ts:63-70` identical seed → identical `tiles` and `contents`: real. `:72-76` is the same assertion again (padding). `:78-94` fuse = 90 ticks: real.
- `elo.test.ts:16-23` exact ±16, `:25-32` exact K=64 → +32/−16, `:59-72` exact FFA fixture 16/5/−5/−16: real fixtures. `:5-14`, `:34-45`, `:47-57` are inequality-only.
- Nothing covers kick, tide, ducks, draws, power-up destroy-on-splash, danger map, bots, matchmaker, rooms, net, or DB.

**Soak script verifies completion only** (`soak.ts:41-57`: loop until `roundOver` or throw), never `Hard ≥ Easy`, never self-soak, never a desync check (single sim, no second instance to compare). It prints `SOAK PASS` while every round ends in 98/194/290 ticks, i.e. it certifies the suicide bug rather than catching it; it also never calls `resetBot` between rounds, which is why its round lengths climb by ~96 ticks each round (the stale-memory bug visible in the output).

---

## TOP FINDINGS

1. **Unauthenticated one-frame remote crash, five vectors.** `net.ts:78-79` handles `hello` outside the `try` at `:96` and `db.ts:41` calls `createHash().update(token)` unchecked; with no `uncaughtException` handler the built server exits 1 on `null`, or on `hello` with a number/object/array/boolean token (observed live, each on a fresh process).
2. **Every bot difficulty suicides on its first balloon.** `dangerMap.ts:85` treats any burst > 22 ticks away as safe, so `bot.ts:95-101` returns a zero-length escape and the bot stands on its balloon; measured Hard 0/12 vs Easy and an idle human beating 3 Medium bots 8/8 with 3-second rounds, while `soak.ts` reports PASS.
3. **Hidden power-ups are fully derivable and the leak is gratuitous.** `net.ts:476` sends the real `mapSeed`, `map.ts:51-75` rolls layout and contents from one stream, the client bundle ships mulberry32 and the weights (100% reproduction in probe), and no in-match client code reads `mapSeed` (only `tutorial.ts:32`).
4. **Disconnect and leave handling is largely dead.** `rooms.ts:337-349 substituteBot` never clears `disconnected`, so `sim.ts:204/228` ignore the "bot" forever (probe: 0 movement over 71 ticks); `net.ts:211-217 leave_room` never triggers `forfeitRanked` (only the `onClose` timer at `:371-385` does), so the in-game Forfeit button stalls ranked opponents for minutes.
5. **Bots freeze for the previous round's duration and round-1 castles are invisible.** `bot.ts:113` gates on a `lastDecisionTick` that `rooms.ts:246-273 startRound` never resets (first round-2 balloon at tick 1501 after a 1500-tick round 1); separately `net.ts:464-465` emits `round_start` synchronously after the message that makes `lobby.ts:82`/`queue.ts:32` navigate via async `hashchange` (`main.ts:19-22`), so `game.ts:87` misses the grid for round 1.

## ONE-LINE VERDICT

A complete-looking scaffold with a genuinely pure, deterministic shared sim and correct Elo math, undermined by a trivially crashable pre-auth path, a 100% seed leak, and a danger map that makes every bot kill itself in three seconds while the soak script certifies it as passing.

---

## Independent fact-checker verdict (second subagent)

Nothing further is needed: every finding has been verified against the cited lines, exercised live (built server, headless sim harnesses, real browser), and the test server and browser tab are cleaned up. Final report follows.

1. **CONFIRMED.** `net.ts:78-79` dispatches `hello` before the `try` at `:96`, and `handleHello` (`:283-287`) passes the raw token straight into `db.ts:41` `createHash('sha256').update(token)`; `index.ts` has no `uncaughtException` handler. Booted the built server 14 times on fresh ports/temp `DATA_DIR`: token `12345`, `{"a":1}`, `["x"]`, `true` each threw `ERR_INVALID_ARG_TYPE` at `db.js:38` and the process exited code 1; raw frame `null` threw `Cannot read properties of null (reading 'kind')` at `net.js:61` (source `net.ts:78`) and exited code 1. In all five, `/health` went from 200 to connection failure. Refutation attempts that survived: non-JSON (`bad_json`), raw `42`/`"hi"` (`no_auth`), pre-auth `queue_join`/`start_match`/`input` (`no_auth`), token `""`/`0` (falsy, guest created) all left the process alive.

2. **CONFIRMED on effect, PARTIALLY CONFIRMED on mechanism.** `dangerMap.ts:85` marks a tile safe when `v > 10 + SPLASH_TICKS(12) = 22`, so with `FUSE_TICKS=90` `canEscapeAfterPlace` (`bot.ts:95-101`) returns the start tile (`bfs` line 52, `dx=dy=0`) and the auditor's numbers reproduce exactly: idle human beat Easy/Medium/Hard 12/12 each (rounds 94-132 ticks), beat 3 Medium bots in FFA 8/8 (rounds 98-106 ticks, all three bots soaked by their own balloon), Hard 0/12 vs Easy. But the per-decision trace shows the bot does not "stand on its balloon": it wanders one tile off (x=11.10) and then cannot move in any direction because `sim.ts:219` clears `passThrough` once `floor(x)` leaves the tile while the 0.35-radius hitbox (`sim.ts:120`, `160-173`) still overlaps it, so its own balloon becomes solid. That wedge is universal: a human placing a balloon and walking off stops at x=2.03 (right) / y=2.03 (down) / 9.03 interior, all 4 directions plus diagonal blocked for 40 ticks, and dies at tick 90 in the headless sim; live in the browser, Space + held D produced "BubblyDuck soaked BubblyDuck!" and a duck icon. The auditor's "genuinely pure, deterministic shared sim" verdict misses that every balloon drop is fatal to its owner; the 11 vitest sim tests never walk a player off a balloon (they inject balloons with empty `passThrough`). `soak.ts` indeed prints `SOAK PASS` regardless (it never asserts round length).

3. **CONFIRMED.** `net.ts:476` sends `mapSeed: game.state.seed`, which `sim.ts:62` copies from the exact seed `generateMap` consumed at `map.ts:51`; layout and contents are one `mulberry32` stream (`map.ts:71-75`). `generateMap(mode, seed)` reproduced tiles and all 20 hidden power-ups of a sample FFA map byte-for-byte, mode is provided by `match_start` (`net.ts:464`), and the shipped client bundle (`dist/assets/index-*.js`) contains the mulberry32 constant (`1831565813` / `0x6d2b79f5`) and `extra_balloon:.38,big_splash:.38,flippers:.19,boots:.05`. `grep mapSeed packages/client/src` hits only `tutorial.ts:32` (hard-coded 42); `game.ts:83-93` reads `roundNo/w/h/castles` and ignores `mapSeed`, so the leak buys the client nothing.

4. **CONFIRMED.** `rooms.ts:337-349 substituteBot` flips the slot to bot and adds `botDifficulties[pid]` but never clears `disconnected`; harness: 60 ticks after substitution the player sat at (1.5,1.5) with `disconnected=true` while `botInput` emitted non-zero input every tick, and clearing the flag by hand moved it 0.4 tiles in 20 ticks (`sim.ts:204/228` skip it). `net.ts:211-217 leave_room` calls only `leaveRoom` → `rooms.ts:174-178`, which marks disconnected; no `forfeitRanked`, no timer. In a ranked room after `leaveRoom('P1')`, 3000 ticks (100 s) later the match was still `playing`, P1 alive and idle; worse, `leaveRoom` nulls `conn.roomCode`, so a later socket close hits `net.ts:363` and never arms the `onClose` forfeit timer either. Since the opponent gets wedged by their own balloon (finding 2), rounds realistically resolve by the 2:00 tide, so "minutes" is fair.

5. **PARTIALLY CONFIRMED.** (a) Confirmed: `bot.ts:113` gates on `lastDecisionTick`, `rooms.ts:246-273 startRound` never calls `resetBot` (only `startMatch:237` does); with hard-vs-hard ids reused, round 2's first balloon landed at tick 97 (round 1 lasted 94 ticks) versus tick 5 after `resetBot`, and the round took 186 ticks instead of 94. (b) Refuted empirically: `net.ts:464-465` does emit `round_start` synchronously after `match_start` while `lobby.ts:82`/`queue.ts:32` navigate via async `hashchange` (`main.ts:19-22`), but in 4/4 valid Chromium trials the game screen received round 1's `round_start`: the canvas was already resized to 208x176 within 20 ms of mount (the handler at `game.ts:88-89` resizes synchronously) and screenshots showed castles plus the "ROUND 1" banner. It is a latent ordering race, not an observed defect; one apparent miss was an artifact of `document.visibilityState === 'hidden'` throttling RAF during scripted polling.

SEED VERDICT: leaks real seed (`net.ts:476 mapSeed: game.state.seed`; client re-derives tiles + hidden contents 100% from shipped `generateMap`/mulberry32; no in-match client code reads `mapSeed`, only `tutorial.ts:32` uses a constant).

CRASH VERDICT: triggerable pre-auth crash at `packages/server/src/net.ts:78` (raw JSON `null` → `msg.kind` TypeError, outside the try) and `net.ts:79` → `db/db.ts:41` (`hello` with number/object/array/boolean token → `Hash.update` `ERR_INVALID_ARG_TYPE`); process exits code 1 and `/health` stops responding. Non-JSON, raw primitives, and pre-auth `queue_join`/`start_match`/`input` are handled gracefully.

ROUND-1 VERDICT: renders (4/4 trials; canvas resized and castles drawn for round 1).

Probe scripts and outputs: `/private/tmp/claude-501/-Users-jackychou-dondi/4ba8524d-7c29-4114-90a8-dab39e377ab3/scratchpad/fc/{crash_test.mjs,bot_harness.mjs,bot_trace.mjs,wedge_test.mjs,wedge2.mjs,room_harness.mjs}` (built copy under `.../fc/app`; source tree untouched).
