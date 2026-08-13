<!-- Audit of the Grok 4.6 submission by an independent Claude subagent, 2026-08-12, under the
     SAME neutral rubric the rivals got, PLUS a second independent fact-checker that re-verified
     every finding (incl. booting the server and reproducing the crash + the 22/22 seed leak).
     The orchestrator (Fable 5) also reproduced BOTH critical findings firsthand and verified the
     netcode (no server ack; INTERP_DELAY_MS dead) and the fake ping (ping pinned to 40).
     Scoring note: the auditor gave Security 2/10; the orchestrator set it to 3 for consistency
     with the identical leak+crash profile of Opus 4.8 and Grok 4.5 (both Security 3), which is a
     slightly MORE generous adjustment to the rival, not less. -->

I have all the evidence I need. Final verification complete: 16 tests pass, soak completes (Hard 4/Easy 0), typecheck clean, server empirically crashes on a malformed pre-auth frame, and the seed leak reproduces byte-identical (22/22 hidden power-ups). Here is the audit.

---

# Splash Critters — Grok 4.6 Audit

## SPEC FIDELITY — SCORE 8/10
Nearly the entire spec is implemented as real, wired features, not stubs. Balloon kick is fully server-simulated (`sim.ts:118 tryKick`, `sim.ts:135 slideBalloons`) and bots account for sliding balloons. Revenge ducks genuinely **ride the border** rather than lobbing from a death tile — `tickRevenge` flips soaked→`revenge` and each tick sets `p.x/p.y` via `perimeterPos` (`sim.ts:419-424`); it is casual-only via the ranked override. Rising tide (`advanceTide` floods rings, dissolves castles, soaks), pre-rolled hidden power-ups (`map.ts:104-110`), pairwise FFA Elo, matchmaker widening, profanity list, XP/levels/unlocks, and a scripted tutorial vs an Easy bot (`tutorial.ts:36`) are all present. Colorblind and reduced-shake settings are actually read by render code (`game.ts:216,225`). Genuine gaps: **keybind remap has no UI** — `settings.binds` is read by `game.ts:147` and persisted but the Settings screen exposes only SFX/MUS/colorblind/shake buttons (`settings.ts:9-17`), so remap is dead; the revenge "lob" spawns an instant splash 3 tiles away instead of a traveling balloon (`sim.ts:405-416`); emotes ride only the global 60 msg/s limit with no dedicated cooldown; and room GC never frees finished rooms (see Top Findings).

## SECURITY & ANTI-CHEAT — SCORE 2/10
Both flagship vulnerabilities from the 4.5 predecessor are **still present and empirically confirmed**. (a) **Seed leak CONFIRMED**: `round_start` ships `mapSeed: seed` (`gameLoop.ts:207`) and the client calls `createRound(msg.mapSeed, …)` (`game.ts:65`), which runs `generateMap(seed)` and populates `round.hidden` with every hidden power-up; my probe showed `hiddenPowerupsForSeed(seed,15,13,4)` returns all 22 contents byte-identical to the server. (f) **Server DIES on a malformed pre-auth frame** — I booted the built server and sent `{type:"hello",token:12345}`; it crashed with `ERR_INVALID_ARG_TYPE` at `hashToken` (`db/index.ts:20`) because `handle()` is not wrapped in try/catch (only `JSON.parse` is, `net.ts:63-67`) and there is **no `process.on('uncaughtException')` guard**. Positives keep this off zero: (c) rate limiting is real (`net.ts:85 rateOk`, 60/s sliding window), (e) **every SQL statement is parameterized**, and input `dir` is whitelisted (`net.ts:210`). But an unauthenticated one-frame remote DoS that kills every live match, plus a trivially cheatable "unguessable" power-up system, is a failing grade.

## CORRECTNESS — SCORE 5/10
The deterministic sim core is genuinely solid and two 4.5 regressions are **fixed**: same-tick mutual soak now correctly yields a **DRAW** (`applySplashes` snapshots splash tiles then soaks all; `checkRoundEnd:452` sees `alive===0`→`draw=true`), and Easy bots run the escape check before dropping like every other tier (`bot.ts:279 canEscapeOwnBalloon` gates all drops). But real defects remain: the HUD ping is fake (see Findings), reconnect grace can't actually reconnect (see Findings), a Rubber Boots player phases onto un-kickable balloons (`sim.ts:52` returns "not solid" for *any* balloon when `hasKick`, even when `tryKick` failed), and finished rooms leak. `gameLoop.ts:74` also carries a nonsense `tier: rating !== undefined ? undefined : undefined`. Ranked does start and persist (`persistElo`→`updateRating`→leaderboard reflects after refresh), so the "ranked never starts" class is not present.

## NETCODE — SCORE 4/10
Prediction is partially genuine, not purely cosmetic: there is a real input buffer (`prediction.ts:26 pending`) and rewind-replay reconciliation that re-simulates buffered inputs on top of each snapshot base (`reconcile:44-59`). However the server never acknowledges a processed input — `lastAck` is only ever reset to 0 and snapshots carry no `ackSeq`, so `pending.filter(i.seq > lastAck)` never trims by ack and replay leans on tick-window trimming instead. Interpolation is **cosmetic**: `interpRemotes` just exponentially eases `r.x += (r.tx-r.x)*k` (`prediction.ts:64`); there is no `serverTime−100ms` buffer and `INTERP_DELAY_MS` / `clockOffset` are computed-but-unused dead values. The **ping readout is fake** (Finding 3). Sim 30Hz / snapshot every 2 ticks (`gameLoop.ts:264`) and server-tick fuses (snapshots carry `fuseLeft`) are correct.

## CODE QUALITY — SCORE 8/10
Strong discipline. The shared sim is **pure** — grep finds zero `Math.random`/`Date.now`/`performance.now` in `packages/shared/src`, preserving determinism (bot RNG lives server-side, acceptably). There are **zero** `any`/`as any` occurrences across all three packages, and `npm run typecheck` passes cleanly in strict mode for shared, server, and client. Architecture follows the spec's orchestrated-function style with discriminated-union protocols and focused files. Deductions for dead code: `net.pingMs`, `clockOffset`, `INTERP_DELAY_MS`, and `lastAck` are declared/computed but never used, `destroyExposedAt` has an empty `/* destroyed */` if-body (`sim.ts:246`), and the always-undefined ternary at `gameLoop.ts:74`.

## TEST DEPTH — SCORE 7/10
The 16 tests assert real properties, not padding: `seed → identical map AND identical hidden power-ups` (`sim.test.ts:44-48`), splash stops at the first sandcastle with an explicit "no splash at tile 6" check (`sim.test.ts:76-96`), a **3-balloon chain bursting in one tick** verifying all balloons gone and `chain_burst.count >= 3` after a single `simulateTick` (`sim.test.ts:98-125`), plus cross-instance determinism and cloneRound isolation. Elo tests use exact fixtures: duel +32/-32 first game and +16/-16 established, 4p pairwise **32/11/-11/-32**, tied-placement equality, provisional K 64→32, and tier bands (`elo.test.ts`). The soak (`server/src/soak.ts`) ran 5 duel bot matches to completion with Hard 4 / Easy 0 / 1 draw, but it is light: **duel-only (never 4p FFA)**, its "desync" check only confirms `tick` advanced by 1 rather than comparing two parallel sims, and there is no networked e2e test and no test for chain propagation through a kicked/sliding balloon.

---

## TOP FINDINGS

1. **[CRITICAL] Unauthenticated single-frame server crash (unchanged from 4.5).** Sending `{type:"hello",token:12345}` reaches `findByToken`→`hashToken` (`db/index.ts:20`), where `createHash("sha256").update(<number>)` throws `ERR_INVALID_ARG_TYPE`; `handle()` at `net.ts:67` is outside the only try/catch (which wraps `JSON.parse`) and there is no `uncaughtException` guard, so the process exits. I booted the built server and it died on this exact frame, taking down all rooms/matches — a trivial remote DoS.

2. **[CRITICAL] Hidden power-up contents are derivable from the leaked map seed.** `round_start` broadcasts `mapSeed: seed` (`gameLoop.ts:207`), the client feeds it to `createRound(msg.mapSeed, …)` (`game.ts:65`) which runs `generateMap(seed)` and fills `round.hidden`, and `hiddenPowerupsForSeed` is even exported from shared; my probe reproduced all 22 hidden contents byte-identical, directly violating the spec's "never sent to clients until revealed (unguessable, unhackable)."

3. **[HIGH] Fake HUD ping and dead clock-sync (unchanged from 4.5).** In `game.ts` the ping is a local constant `let ping = 40` smoothed as `ping*0.95 + 40*0.05`, which is mathematically pinned to 40 and passed to `drawHud`; `net.pingMs` is declared but never assigned, and `clockOffset` (`net.ts:27`) and `INTERP_DELAY_MS` are computed/configured but never read. The displayed latency is cosmetic and always ~40ms regardless of real RTT.

4. **[HIGH] "15s reconnect grace" cannot actually reconnect.** On ws close, `leaveRoom` clears `client.roomCode` and calls `markForfeit`/`replaceWithBot` (`rooms.ts:139-163`); `checkDisconnects` (`gameLoop.ts:130`) only ever *expires* the grace into a forfeit or bot-swap, and no `hello`-with-token path re-attaches a returning client to its in-progress room. The grace merely delays the loss — a dropped ranked player can never resume, contradicting the spec's reconnect-grace requirement.

5. **[MEDIUM] Rubber Boots players phase onto un-kickable balloons.** `solidForMove` returns "not solid" for *any* balloon whenever `mover.hasKick && ENABLE_KICK` (`sim.ts:52`), so when `tryKick` fails (balloon blocked behind by a boulder/castle/player) the mover still walks onto the balloon's tile and overlaps it instead of being blocked. Combined with `gcRooms` unconditionally skipping every room that has a session (`rooms.ts:243`) while `tickRooms` deliberately keeps finished sessions alive, abandoned finished rooms are also never freed (memory leak).

## ONE-LINE VERDICT
A remarkably complete, cleanly-typed, deterministic game whose sim core fixed 4.5's mutual-soak and self-soak bugs — but it regressed nothing on the two headline vulnerabilities: it still hard-crashes on a single malformed frame and still leaks the hidden-power-up seed to the client, so it fails the security bar despite strong engineering elsewhere.

---

## Independent fact-checker verdict (second subagent)

I have everything I need. The spec (prompt.md) confirms both the "unguessable, unhackable" power-up requirement (line 89), the "15s reconnect grace" (line 61), and "rooms GC after 10 min idle" (line 68). Let me kill the stray note and finalize.

Final independent fact-check report below.

---

**FACT-CHECK: grok-4.6 (all findings independently traced + server booted and attacked)**

**1. Unauthenticated single-frame crash — CONFIRMED (empirically reproduced).** `hashToken` does `createHash("sha256").update(token)` at `db/index.ts:20`; the `hello` handler calls `findByToken(db, msg.token!)` at `net.ts:99` whenever `msg.token` is truthy, and `handle()` (called at `net.ts:69`) sits outside the only try/catch, which wraps just `JSON.parse` (`net.ts:63-68`). No `uncaughtException`/`unhandledRejection` handler exists anywhere (grep of both packages is empty). I built and booted the server (`PORT=39117`, temp DATA_DIR), sent `{"type":"hello","token":12345}`, and the process died with `TypeError [ERR_INVALID_ARG_TYPE] ... Received type number (12345) at Hash.update → hashToken (db/index.js) → findByToken → handle (net.js) → WebSocket.emit`. On a fresh server, `}{not json` was caught (returns `bad_json`) and an unknown `type` was a no-op, but an object token (`{"a":1}`) crashed identically — proving the guard covers only JSON.parse, not the dispatch. Trivial pre-auth remote DoS taking down all rooms.

**2. Hidden power-ups derivable from leaked seed — CONFIRMED.** `round_start` broadcasts `mapSeed: seed` (`gameLoop.ts:208`, seed from `randomInt` at `:178`), the same seed passed to `createRound(seed,…)` at `:195`. The shipped client re-runs `createRound(msg.mapSeed, msg.width, msg.height, msg.theme, plist)` at `game.ts:65`, and `createRound` calls `generateMap(seed,…)` and stores `hidden: gen.hidden` (`sim.ts:70,92`); `generateMap`'s hidden rolls depend only on the seeded RNG (`map.ts:98-106`), independent of theme. `hiddenPowerupsForSeed` is exported from `sim.ts:530` via `index.ts`'s `export * from "./sim.js"`. Directly violates prompt.md:89 ("contents are never sent to clients until revealed (unguessable, unhackable)").

**3. Fake HUD ping + dead clock-sync — CONFIRMED.** `game.ts:46` `let ping = 40`, smoothed at `:171` as `clamp(ping*0.95 + 40*0.05)` (fixed point = 40, so pinned to 40 forever), passed to `drawHud` at `:295`. `net.pingMs` is declared (`net.ts:9`) and never assigned; `clockOffset` is declared (`:10`) and assigned (`:27`) but never read anywhere; `INTERP_DELAY_MS` (`config.ts:5`) is never read in any package (grep confirms single occurrences). Displayed latency is cosmetic and always ~40ms.

**4. "15s reconnect grace" cannot reconnect — CONFIRMED.** `leaveRoom` (`rooms.ts:175-212`) nulls `client.roomCode` (`:178`), deletes the client from `room.clients` (`:180`), and calls `replaceWithBot` (casual, `:192`) or `markForfeit` (ranked, `:194`). `checkDisconnects` (`gameLoop.ts:146-172`) only waits during grace then expires into forfeit+`endMatch` or bot-swap. The `hello` handler (`net.ts:96-107`) never looks up an in-progress room, never re-adds to `room.clients`, never clears `disconnectAt`; and `joinRoom` rejects with "Match already in progress" when `room.session` (`rooms.ts:167`). `RECONNECT_GRACE_MS=15000` exists (config), and prompt.md:61 requires a 15s reconnect grace, so this is a real spec gap — the grace only delays the loss. (Auditor's cited line numbers 139-163/130 are stale vs this build's 175-212/146, but the logic matches exactly.)

**5. Rubber Boots phasing + finished-room leak — CONFIRMED (both halves).** In `movePlayer` (`sim.ts:335-356`) a boots player attempts `tryKick`; when the balloon is blocked behind (boulder/castle/player), `tryKick` returns false (`:128-131`), yet `solidForMove` still returns "not solid" via `if (mover.hasKick && CONFIG.ENABLE_KICK) return false;` (`sim.ts:52`, and `ENABLE_KICK:true`), so the mover walks onto/overlaps the un-kickable balloon. Second half: `gcRooms` skips every room with a session — `if (room.session) continue;` (`rooms.ts:277`) — and `tickRooms` deliberately keeps finished sessions (`:300-307`); nothing ever nulls a finished `session` (only two `rooms.delete` sites: `:209`, guarded by `!room.session`, and `:278` inside gcRooms). So an abandoned finished room (session set, all humans gone) is never freed, violating prompt.md:68 ("rooms GC after 10 min idle"). Memory leak confirmed.

---

**SEED VERDICT: leaks real seed.** `round_start.mapSeed` is the exact `randomInt(1, 2^31-1)` seed fed to `createRound`/`generateMap`; the shipped client re-derives the full `round.hidden` layout by calling `createRound(msg.mapSeed,…)` (`game.ts:65`), and `hiddenPowerupsForSeed` is additionally exported from shared. No decoy, no omission — the real seed is broadcast and hidden contents are 100% reproducible client-side.

**CRASH VERDICT: triggerable pre-auth crash at db/index.ts:20 (hashToken), reached via net.ts:99 (findByToken in the hello handler), dispatched by the un-guarded handle() at net.ts:69.** Verified live: I ran `npm run build` then booted `packages/server/dist/index.js` on a free port with a temp DATA_DIR; a single `{"type":"hello","token":12345}` frame (and equally an object-valued token) killed the process with `ERR_INVALID_ARG_TYPE`, while malformed JSON and unknown message types were handled gracefully. No global exception guard exists.

(Note: I created and then removed a throwaway probe script inside the audited dir and killed the two test servers I started; `git status` confirms no tracked source was modified. A pre-existing unrelated node server, pid 72157, was left untouched.)
