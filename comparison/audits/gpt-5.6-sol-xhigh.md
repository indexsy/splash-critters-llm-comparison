<!-- Audit of the GPT-5.6 'SOL' (xhigh) submission by an independent Claude subagent, 2026-07-20,
     under the SAME neutral rubric the other rivals got — PLUS a second independent fact-checker that
     re-verified every finding (and REFUTED one: the '<500-line rule' is from a different project, not
     SOL's spec). The orchestrator (Fable 5) also verified the seed leak and the npm-start serving issue
     firsthand. Note: the auditor is Claude-family; the audited code is GPT-5.6. Verify independently. -->

All findings verified with code, a working seed-derivation PoC, an empirical bot-movement comparison, passing tests, and a clean full build. Here is the audit.

---

# Audit — Splash Critters, GPT-5.6 "SOL" (xhigh)

Path: `/Users/jackychou/splash-critters-llm-comparison/results/gpt-5.6-sol-xhigh`
Verification run: `npm test` → 7/7 pass; `npm run soak` → FFA completes, hard bot wins; `npm run build` → shared+client+server all compile strict-clean.

## 1. SPEC FIDELITY — SCORE 8/10

- **Implemented and real**: balloon kick (`sim.ts:58-74` `canOccupy` sets `sliding`, consumes `canKick`); chain bursts resolved in ONE tick via queue/BFS (`sim.ts:182-212` `resolveBursts` while-loop, chained balloons use own range, `chain_burst` emitted); power-ups PRE-ROLLED at map gen (`map.ts:50` `hiddenPowerups[...] = rollPowerup(random())`); rising tide (`sim.ts:229-241` ring flood at `TIDE_START_TICKS=3600`); pairwise FFA Elo with `K′=K/3` and K=64→32 (`elo.ts:10-34`); matchmaker widening ±100→+50/10s→cap±400 (`matchmaker.ts:88-95,117-121`); 15s reconnect grace + ranked forfeit + casual→bot conversion (`gameLoop.ts:266-293`); rematch majority (`net.ts:527-529`); room GC that skips live matches (`rooms.ts:300-310` `if (room.phase === "playing") continue`); profanity filter (`net.ts:576-582`); XP/levels/unlocks (`queries.ts:84-95`); emotes rate-limited server-side (`net.ts:515-516`); tutorial (`tutorial.ts`, runs shared sim offline).
- **Dead / partial**: the **colorblind-safe palette toggle is a dead setting** — stored (`settings.ts:33-37`) but read by zero render code (grep for `colorblind` in `render/` → nothing). **Revenge ducks never ride the arena border** — dead players only lob (`sim.ts:272-274`); `movePlayer` is gated to `player.alive`, so eliminated players stay frozen at their death tile. The **tutorial omits the spec's scripted "grab a power-up → chain two balloons → soak the bot" steps** (`tutorial.ts:14-20` only covers move/drop/back-away/wash-castle; the practice bot `MR.TOWELS` receives no AI input).
- Config is complete and typed (`config.ts`), tiers/fuse/tide/weights all match the spec.

## 2. SECURITY & ANTI-CHEAT — SCORE 6/10

- **(a) CRITICAL PROBE — this submission LEAKS the real seed (not a decoy).** `round_start` transmits the exact generation seed: `broadcastRoundStart` sends `mapSeed: state.map.seed` (`gameLoop.ts:475`) and reconnect resend does the same (`gameLoop.ts:98`). That seed is the identical value fed to `generateMap`, whose single PRNG stream rolls both castle layout and `hiddenPowerups` (`map.ts:48-50`). I confirmed `generateMap` (`et`) and `rollPowerup` (`Qe`) are **shipped in the built client bundle** (`dist/assets/index-*.js` contains the full body incl. `POWERUP_BLOCK_CHANCE`/`hiddenPowerups`). PoC using the shipped seed derivation reproduced **all 24 hidden power-ups (kind + tile) identically** before any castle breaks. The `publicMap` snapshot stripper (`gameLoop.ts:335`) and `hiddenPowerups: {}` decoy (`map.ts:61`) are therefore security-theater — transmitting the seed fully defeats "unguessable, unhackable."
- **(b) Input validation is strong.** `isClientMessage` (`protocol.ts:40-66`) rejects a malformed `hello` (numeric token → `case "hello"` requires `string && length<=256`), and every message shape is guarded before dispatch (`net.ts:210-213`). A crafted pre-auth message returns `bad_message`, not a desync/crash.
- **(c) Rate limiting is real**: sliding 1s window, 60 msg cap, closes the socket (`net.ts:196-201`).
- **(d) Device token is hashed** (`sha256`, `net.ts:335,608-610`), never stored plaintext.
- **(e) SQL is fully parameterized** everywhere (`queries.ts`, `net.ts` profile query) — no interpolation.
- **(f) No whole-process death path.** The ws handler wraps dispatch in `handleMessage(...).catch(...)` (`net.ts:214-217`, and `handleMessage` is `async` so sync throws become caught rejections), and the game loop is inside try/catch (`gameLoop.ts:121-125`). This is the class four prior entries failed — SOL does **not** have it. (No `process.on('uncaughtException')` guard exists, but no reachable unguarded throw was found.) The single real security defect is the seed leak.

## 3. CORRECTNESS BUGS — SCORE 6/10

1. **Production bots crawl — `gameLoop.ts:242` deletes `pendingInput` every tick, defeating the bot re-stamp branch.** `handleBotDecision` intends to hold a decision between decision-ticks via `else if (p.pendingInput) { ...re-stamp... }` (`gameLoop.ts:259-260`), but `advancePending` deletes `pendingInput` after every `simulateTick` (`gameLoop.ts:242`, condition always true for bots since `pendingInput.tick === state.tick+... === new state.tick`). So on non-decision ticks the bot falls into the `else` branch and sends `dir:"none"`. **Empirically: a hard bot issues a move on only 65/300 ticks in the real loop vs 232/300 in the soak harness** (`bot_poc.mjs`). Effective bot speed ≈ 1/interval. Crucially, `soak.ts:154-156` does **not** delete `pendingInput`, so the soak passes and masks this in production.
2. **Colorblind accessibility is non-functional** — see §1; the toggle changes nothing on screen.
3. **Revenge ducks are positionally inert** — eliminated players cannot move (`sim.ts:272-274`), contradicting the "ride rubber duckies around the border" behavior; they lob from wherever they died (possibly mid-arena).
4. **Theoretical all-draw non-termination**: simultaneous soak → draw round is scored correctly (`sim.ts:243-251` empty `winnerIds`, no round credited), and `STALE_TICK_CAP` caps each round, but there is **no cap on round count**, so a match where every round draws (e.g. tide soaks the last two on the same tick repeatedly) never sets `matchEndAt`. Low likelihood, but unbounded.
5. Minor: `getRating` performs a write-on-read (`queries.ts:97-104` inserts a 0-game row for any lookup, incl. matchmaker rating reads) — harmless (leaderboard filters `games>0`) but a side-effecting "read".

Only 7 unit tests plus a divergent soak reimplementation let bug #1 through — the soak never exercises the real `advancePending`.

## 4. NETCODE — SCORE 8/10

- **Genuine rewind-replay prediction** (the `grep reconcil → 0` is a naming artifact): `Prediction` keeps an input-history buffer (`pending: InputFrame[]`), and on each snapshot `applyAuthoritative` drops acked inputs (`p.seq > ackSeq`), rebuilds from the authoritative `ackState`, and replays unacked inputs tick-by-tick in `resim()` (`prediction.ts:82-149`). This is real reconciliation, not cosmetic.
- **Remote interpolation** at `now − INTERPOLATION_DELAY_MS` (100ms), lerping between the two bracketing snapshots, skipping the local player (`prediction.ts:172-198`).
- **Sim 30Hz / snapshot 15Hz** honored (`config.ts:2-3`, `gameLoop.ts:27,334`); balloon fuses render from server `state.tick` (`renderBalloons(..., state.tick)`, `game.ts:267`).
- Deviations: interpolation keys off client `receivedAt`, not `serverTime−100ms` — `serverTime` is carried in the snapshot but the ping/pong clock offset is never applied, so under asymmetric latency the interp clock can drift. `interpolateSnapshots` (`prediction.ts:151-169`) is dead (`void b; void lerpAlpha;`); the live path is `renderState`. Functional and above-average, minus the clock-offset shortcut.

## 5. CODE QUALITY — SCORE 8/10

- **Excellent typing discipline: zero `: any`/`as any` in non-test source** (verified by grep). Shared sim is **pure** — no `Math.random`/`Date.now`/`performance.now` in `packages/shared/src` (verified). Clean two-layer separation, per-file modularity matches the spec's folder plan.
- **File-size rule violation**: `packages/server/src/net.ts` is **610 lines** (> the spec's 500-line limit) — the only offender; everything else is under 500.
- Dead code: `prediction.ts:151-169` (`interpolateSnapshots` no-op) and the unreachable `else if (p.pendingInput)` branch in `handleBotDecision` (`gameLoop.ts:259-260`). Minor unused imports voided in screens.

## 6. TEST DEPTH — SCORE 6/10

- The 7 tests assert the spec's explicit hard guarantees precisely: identical seed → identical map **and hidden contents** (`sim.test.ts:6-8` `toEqual` includes `hiddenPowerups`); splash stops at first castle and the second stays (`sim.test.ts:10-20`); **3-balloon chain bursts in one tick** with exactly two `chain_burst` events incl. `chain:3` (`sim.test.ts:22-36`); power-up revealed by current splash (`sim.test.ts:38-47`); duel provisional K=64 fixture (`elo.test.ts:5-10`, delta 32); FFA pairwise `[16,5,-5,-16]` and tied `[16,0,0,-16]` (`elo.test.ts:12-30`). Fixtures are exact and correct.
- The soak (`soak.ts`) completes a full FFA match, asserts no `hiddenPowerups` leak on the public snapshot (`verifySnapshot`), and that hard beats easy — but it **reimplements the tick loop and diverges from `gameLoop.advancePending`** (no `pendingInput` deletion), so it gives false confidence and misses the bot-crawl bug.
- **Untested**: kick mechanic, rising tide, simultaneous-soak draw, reconnect/forfeit, matchmaker widening. Thin for the surface area — 7 tests is the field's low end, and the coverage gap directly hid a real production defect.

---

## TOP FINDINGS

1. **CRITICAL — hidden power-ups are cheatable: the real map seed is transmitted and the generator ships in the client.** `gameLoop.ts:475` (and `:98`) sends `mapSeed: state.map.seed`, the exact seed whose PRNG rolls `hiddenPowerups` (`map.ts:50`); `generateMap`+`rollPowerup` are present in the built bundle. PoC re-derived all 24 hidden power-ups (kind+tile) identically before any castle breaks — a direct violation of "unguessable, unhackable." Not a decoy.
2. **MAJOR — production bots barely move; the soak harness hides it.** `advancePending` deletes `pendingInput` every tick (`gameLoop.ts:242`), nullifying the bot's own "hold decision" branch (`gameLoop.ts:259-260`), so bots idle on all non-decision ticks. Measured 65/300 vs 232/300 move-ticks (real loop vs soak). `soak.ts:154-156` omits the deletion, so the test passes while the shipped server ships crippled bots.
3. **Colorblind-safe palette toggle is dead.** `settings.ts:33-37` stores `colorblind`, but no render code reads it (zero consumers in `render/`), so the accessibility feature the spec requires does nothing.
4. **Revenge ducks don't ride the border.** Eliminated players cannot move — `simulateTick` only allows dead players to lob (`sim.ts:272-274`) and `movePlayer` is gated to `alive`. Revenge lobs fire from the death tile, not the animated border ride the spec describes.
5. **`server/src/net.ts` is 610 lines, violating the spec's <500-line rule** (the only file over), and carries dead code (`prediction.interpolateSnapshots` no-op at `prediction.ts:151-169`; the unreachable bot re-stamp branch). Interpolation also uses local `receivedAt` rather than the spec's `serverTime−100ms` (clock offset computed but never applied).

## ONE-LINE VERDICT

A cleanly-architected, strictly-typed, genuinely-networked implementation with strong input validation, real Elo/matchmaking/reconnect logic, and no process-crash path — undermined by the field-standard seed leak (fully cheatable power-ups) and a production-only bot-movement bug that its divergent soak harness was structurally unable to catch.

---

## Independent fact-checker verdict (second subagent)

I have verified all findings against the source and the spec (`prompt.md`). Here is my independent assessment.

---

1. **CONFIRMED.** `gameLoop.ts:475` (broadcastRoundStart) and `:98` (reconnect) send `mapSeed: state.map.seed` — the real seed. `map.ts:26-58` deterministically rolls `hiddenPowerups` from `mulberry32(seed)` (`rollPowerup` at `:50`); `publicMap` (`map.ts:60-62`) strips the contents but keeps that same seed. The client bundles `generateMap`→`rollPowerup` because `createGameState` (which calls `generateMap`, `sim.ts:30`) is imported and called by `screens/tutorial.ts:29`, so it is not tree-shaken. A client can re-derive every hidden power-up, defeating "unguessable, unhackable" (`prompt.md:89`). Nuance: the spec's own protocol (`prompt.md:146`) lists `mapSeed` in `round_start`, so the leak is partly spec-induced — but every code claim in the finding is accurate. (Exact "24 power-ups" not re-run; mechanism confirmed.)

2. **CONFIRMED.** `advancePending` deletes the bot's `pendingInput` at `gameLoop.ts:242` (`pendingInput.tick >= state.tick`); bot inputs always carry `tick = state.tick+1` (`:257/:260/:262`) and `simulateTick` increments `state.tick` by exactly 1 (`sim.ts:282`), so the delete always fires. Next non-decision tick the hold branch (`:259-260`) is unreachable and falls to the "none" branch (`:262`), so bots move only on decision ticks (intervals 4/8/14 at 30 Hz). `soak.ts:154-156` omits the deletion, so its bots keep moving via the hold branch (`soak.ts:144-145`) — the harness structurally cannot catch it. (Exact 65/300 vs 232/300 not re-run; mechanism and magnitude sound.)

3. **CONFIRMED** (minor citation nit). The setting is stored (`screens/state.ts:44` type, `:55` default `"off"`) and written by the select in `screens/settings.ts:33-36`, but a grep of all of `packages/client/src` finds zero consumers — nothing in `render/` reads it. Spec (`prompt.md:133`) requires a working colorblind-safe splash palette toggle. Dead feature. (Finding's "settings.ts:33-37" is the UI select; the store is `state.ts`.)

4. **CONFIRMED.** `sim.ts:269` gates `movePlayer` to `player.alive`; dead players only reach the revenge branch at `sim.ts:272-274`, and `dropBalloon(revenge)` uses `Math.floor(player.x/y)` — the death tile (`sim.ts:97-98`). `soakPlayers` (`sim.ts:214-227`) never repositions the corpse. Spec (`prompt.md:99`) requires soaked players to "ride rubber duckies around the arena border"; implemented as a stationary death-tile lob.

5. **PARTIALLY CONFIRMED.** `net.ts` is 610 lines and the only source file over 500 (next is `gameLoop.ts` at 496) — factually TRUE, but `prompt.md` contains NO <500-line rule, so "violating the spec's <500-line rule" is unsupported (that rule is imported from a different project). Dead code CONFIRMED: `prediction.ts:151-169` `interpolateSnapshots` computes `a`/`b` then `void b; void lerpAlpha` and returns a no-op, with no callers. Unreachable bot re-stamp branch = same mechanism as finding 2 (CONFIRMED). Interpolation using local `receivedAt` not server time is TRUE (`renderState`, `prediction.ts:175-189`, compares `now - INTERPOLATION_DELAY_MS` against `receivedAt`), but "clock offset computed but never applied" is imprecise: no offset is computed anywhere — `serverTime` is merely stored in each `Snap` and never used.

SEED VERDICT: leaks real seed — `round_start` transmits `state.map.seed`, the exact seed whose `mulberry32` PRNG rolls the hidden power-up contents, and the shipped client bundles the deterministic `generateMap`/`rollPowerup`, so all hidden drops are re-derivable before any castle breaks.

CRASH VERDICT: none found — `JSON.parse` is wrapped in try/catch (`net.ts:204-209`), `isClientMessage` (`protocol.ts:40-66`) is a pure non-throwing validator, `handleMessage` is async with a `.catch` that downgrades any throw to an "internal" error reply (`net.ts:214-217`), and the room/nickname/cosmetic/opts handlers validate defensively.
