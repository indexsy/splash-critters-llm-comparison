<!-- Audit of the Opus 4.8 'ultracode' submission by an independent Claude Fable 5 subagent, 2026-07-19,
     under the SAME neutral rubric the five rivals got — PLUS a second independent Fable 5 fact-checker
     that re-verified every top finding against source (verdict appended below). The orchestrator (Fable 5)
     additionally reproduced the two critical findings firsthand (seed leak + one-packet server crash).
     Note: both this entry and the #1 entry are Claude-family, audited by Claude-family — verify independently. -->

Audit complete. All findings verified by reading and executing the code.

---

# Splash Critters Audit — Claude Opus 4.8 "ultracode"

Location: `packages/{shared,server,client}` · 8,367 LOC across ~60 hand-authored source files (89 counting build artifacts/dist-types). Tests: 22 vitest (all pass), soak script (passes). `tsc -b` clean.

## 1. SPEC FIDELITY — SCORE 9/10

Nearly the entire spec is implemented AND wired end-to-end (no stubs, no dead events — every `SimEvent` variant is consumed in `game.ts:74-121`).

- **Chain bursts in ONE tick via BFS/union-find:** `burst.ts:62-192` — single queue pass with union-find grouping; verified by test (`sim.test.ts:7` 3-balloon chain → `s.balloons.length === 0`, count 3).
- **Power-ups PRE-ROLLED at map gen:** `map.ts:96-107` rolls `castleContents` from the round seed in one deterministic stream; contents stored server-side and revealed on wash (`burst.ts:126-131`).
- **Balloon kick:** fully simulated (`sim.ts:46-55, 118-139`), in bot danger map, and tested (`determinism.test.ts:57`).
- **Rising Tide** (`tide.ts:42-52`, ring-per-1.5s), **Revenge Ducks** (`tide.ts:87-158`, casual-only via `revengeDucksEnabled`), **emotes rate-limited server-side** (`match.ts:231-240`, 45-tick cooldown).
- **Pairwise FFA Elo** with `K' = K/(n-1)` and provisional K=64→32 (`elo.ts:47-68`, `config.ts:165-169`); **matchmaker** widening ±100 +50/10s cap ±400 (`matchmaker.ts:52-59`).
- **Reconnect grace 15s → forfeit (ranked) / Medium bot (casual)** (`room.ts:127-147`, `match.ts:243-258`); **rematch vote**, **room GC** (`roomManager.ts:79-86`, guarded so it never kills a live match — `room.isIdle` returns false while `in_match`), profanity filter (`util.ts:47-60`), XP/levels/unlocks, full settings, tutorial.

Minor deductions: rematch "majority" is coded as `ceil(humans/2)` (`room.ts:314`) — that's *half-or-more*, so 1-of-2 triggers a rematch, not a strict majority. `CONFIG.SPEED_TOLERANCE` is dead (movement is fully authoritative, so it's moot but unused).

## 2. SECURITY & ANTI-CHEAT — SCORE 3/10

Two independently critical failures.

- **(a) SEED PROBE — FAILS, no decoy.** `round_start` sends `mapSeed: this.state.mapSeed` (`match.ts:109`, `room.ts:167`) — the *same* seed used server-side to roll hidden contents (`mixSeeds(baseSeed, roundNo)` → `createRoundState` → `generateMap`). The client calls `createRoundState({mapSeed})` (`prediction.ts:107`), which runs `generateMap` and populates `world.castleContents` in client memory. `generateMap`, `weightedPowerUp`, and `POWERUP_WEIGHTS` are all exported through `shared/index.ts` and **confirmed present in the shipped client bundle** (`dist/assets/*.js` contains `castleContents`, `POWERUP_WEIGHTS`, `rubberBoots`). A cheater calls `generateMap(mapSeed, mode)` and reads every hidden power-up (including the rare Rubber Boots) before any reveal. This is exactly the cheatable pattern; no separate contents-seed / decoy exists.
- **(f) WHOLE-PROCESS DEATH from one unvalidated pre-auth message — VERIFIED LIVE.** `onHello` does `msg.token ? hashToken(msg.token)` (`handlers.ts:110`); `hashToken` calls `createHash().update(token)` (`util.ts:12`), which throws `ERR_INVALID_ARG_TYPE` on a non-string. The ws `message` listener (`index.ts:59-63`) has no try/catch (only `JSON.parse` is guarded), and there is **no `process.on('uncaughtException')`**. I booted the real server and sent `{"type":"hello","token":12345}`: the process died (`Node.js v23.7.0` crash, stack top `Hash.update → hashToken → onHello`). Any anonymous client kills all rooms/matches with one packet.
- **(c/d/e) Genuinely solid:** rate limiting is a real token bucket (`net.ts:38-52`, 60/s + 90 burst); device token is SHA-256 hashed (`util.ts:11-13`); **all SQL is parameterized** (`db/queries.ts` — every statement uses `?`/`@named` binds, zero string interpolation); server never trusts client positions (only `dir`/`balloon` intent, `net.ts:64-68`).

## 3. CORRECTNESS BUGS — SCORE 6.5/10

The core sim is well-integrated (the multi-agent seam failures the prompt warns about are largely *absent* — `context.ts` cleanly breaks the rooms↔mm cycle, every emitted event has a listener, counters aren't double-gated). The genuine defects:

1. **`hello`-token crash** (`handlers.ts:110`) — severe, above; DoS + total availability loss.
2. **Seed-derivable hidden contents** (`prediction.ts:107` + `match.ts:109`) — above.
3. **`biggestChain` cross-cascade misattribution** (`match.ts:167-178`): `burstSlot` latches the *first* `balloon_burst` event of the tick; if two independent cascades burst in the same tick, a chain from the second is credited to the first cascade's owner. Cosmetic "Biggest Chain" award only.
4. **Rematch on a tie** (`room.ts:314`): `ceil(humans/2)` means 1 of 2 players forces a rematch — not the majority the spec asks for.
5. **`round_start.startAtTick` semantics differ between paths**: `match.ts:111` sends `CONFIG.ROUND_INTRO_TICKS` (90) but `room.ts:170` (reattach) sends `0`. A player reconnecting mid-round gets a 0-length intro; harmless but inconsistent.

Draws (`sim.ts:219-227`, tested), simultaneous soak (`sim.test.ts:78`), forfeit placement sinking (`results.ts:54-55`), and casual bot conversion all behave correctly.

## 4. NETCODE — SCORE 8.5/10

Genuine, not cosmetic. `prediction.ts` keeps an input buffer (`inputBuf`), snaps the local player to authoritative state on each snapshot, then **replays unacked inputs** (`onSnapshot:172-177`) — real rewind-replay reconciliation (movement-only replay is a deliberate, reasonable choice). Remote entities interpolate at `serverTime − INTERP_DELAY_MS` (100ms) with a smoothed clock offset (`renderView:246-248`). Snapshots are 15Hz (`match.ts:160` `globalTick % 2`), sim is fixed 30Hz (`config.ts:10`), and balloon fuses render from server ticks (`prediction.ts:306` `fuseFrac = (fuseTick − serverTick)/FUSE_TICKS`). Optimistic "ghost" balloons cover placement latency. Dev `?lag=` flag present (`net.ts:30`).

## 5. CODE QUALITY — SCORE 9/10

Coherent, disciplined decomposition; **every source file is <500 LOC** (largest `room.ts` 399). Shared sim is **pure** — grep confirms zero `Math.random`/`Date.now`/`new Date` in `shared/src`; the only randomness is `mulberry32` (`rng.ts`). Bots isolate their `Math.random` server-side (`bot.ts` comment + usage), correctly outside the deterministic sim. Typing is strict: `tsc -b` passes clean and only **2 `any` occurrences** in the whole `src` tree. Clean auth-context pattern breaks the construction cycle (`context.ts`). Sensible module boundaries (sim/burst/tide/state split; server room/match/results/matchmaker split; client screens/render/net split).

## 6. TEST DEPTH — SCORE 9/10

The 22 tests assert real invariants, not smoke:
- **Determinism:** identical seed → identical grid AND identical `castleContents` (`determinism.test.ts:14-19`); two states run byte-identical over 120 scripted ticks (`:36-54`).
- **Chain-in-one-tick** and **non-chain separation** (`sim.test.ts:7-29`); **splash stops at first castle**, second survives, exact splash-cell presence (`:33-50`); **boulder blocks** (`:52-60`); **simultaneous-soak draw** with `winnerSlot === null` (`:78-88`); fuse timing; maxBalloons cap.
- **Elo fixtures exact:** duel +32/-32 (K=64) and +8/-8 (K=32) zero-sum (`elo.test.ts:16-31`); **FFA pairwise `[32, 11, -11, -32]` zero-sum** (`:35-44`); shared-placement equality; `placementsFromResults` tie-sharing; tier bands.
- **Soak/e2e (`soak.ts`)** — I ran it: 30/30 duels complete, **Hard beats Easy 26/30**, Hard self-soaks 1 vs Easy's 64, plus an 8× all-Hard FFA self-soak-rate audit and a castles-washed liveness check. Genuinely verifies "no freeze, Hard beats Easy, bots don't suicide."

Not covered: kick interaction with chains, revenge-lob soak, tide-soak — but breadth is strong.

## TOP FINDINGS

1. **CRITICAL — hidden power-ups are client-derivable (cheatable, no decoy).** `round_start` ships the exact seed that rolls contents (`match.ts:109`), and the client regenerates `castleContents` via the bundled `generateMap` (`prediction.ts:107`; generator confirmed in `dist/assets/*.js`). A cheater reads every castle's contents pre-reveal.
2. **CRITICAL — one pre-auth packet kills the whole server.** `{"type":"hello","token":<non-string>}` → `hashToken` throws (`util.ts:12` ← `handlers.ts:110`) inside an unguarded ws `message` listener with no `uncaughtException` handler (`index.ts:59-72`). Verified: sending it crashed the live process. Total availability DoS.
3. **MINOR — `biggestChain` award misattributed across simultaneous cascades** (`match.ts:171-176`): `burstSlot` latches the tick's first burst, so a second cascade's chain is credited wrongly. Cosmetic stat only.
4. **MINOR — rematch triggers on a tie, not a majority** (`room.ts:314`, `ceil(humans/2)`): 1 of 2 players restarts the match; spec says majority.
5. **MINOR — inconsistent `startAtTick` on reconnect** (`room.ts:170` sends `0` vs `match.ts:111` sends `90`): a mid-round reconnector skips the countdown gate; harmless but a seam between the two round-start emitters.

## ONE-LINE VERDICT

An exceptionally complete, cleanly-architected, well-tested build (pure deterministic sim, genuine rewind-replay netcode, real pairwise-Elo, 22 meaningful tests + passing soak) that is undermined by two independently critical security defects — the round seed leaks all hidden power-up contents to clients, and a single malformed `hello` packet crashes the entire server process.

---

## Independent fact-checker verdict (second subagent)

All findings verified against source. Here is my independent assessment.

1. **CONFIRMED.** `announceRoundStart` broadcasts `mapSeed: this.state.mapSeed` (match.ts:109), which equals `mixSeeds(baseSeed, roundNo)` (match.ts:74) — the exact seed passed to `generateMap` (state.ts:78), whose single deterministic RNG stream rolls `castleContents[i] = weightedPowerUp(rng)` (map.ts:104). The client feeds that same seed into the same `createRoundState`/`generateMap` (prediction.ts:107, game.ts:46), and `weightedPowerUp` is present in the shipped bundle (`dist/assets/index-BxXW-6tJ.js`). Notably the server snapshot deliberately omits `castleContents` (match.ts:266-310 sends only revealed `powerups`), proving hidden contents were meant to be secret — so this is a genuine leak with no decoy, exactly as claimed.

2. **CONFIRMED.** `{"type":"hello",token:<number>}` routes to `onHello` → `hashToken(msg.token)` (handlers.ts:110), and `createHash().update(number)` throws `TypeError` (util.ts:12; I reproduced the throw). The `ws.on('message', …)` listener (index.ts:59-63) wraps `handleMessage` in no try/catch, and the only `process.on` handlers are SIGTERM/SIGINT — no `uncaughtException`/`unhandledRejection` anywhere in the server. An unguarded throw from the emitter callback terminates the Node process. `allow()` (net.ts:38) is only rate-limiting and does not sanitize. Full pre-auth availability DoS.

3. **CONFIRMED (cosmetic).** In `accumulate` (match.ts:171-177), `burstSlot` latches the first `balloon_burst.ownerSlot` of the tick; all `balloon_burst` events precede all `chain_burst` events in the array (burst.ts:106 vs 181), and `chain_burst` carries no owner field (types.ts:208). So a second independent cascade's chain is credited to the first cascade's burster. Affects only the `biggestChain` fun-stat.

4. **CONFIRMED (minor/interpretation).** `rematchVote` restarts when `rematchVotes.size >= Math.ceil(humans/2)` (room.ts:314). For 2 humans that is `ceil(1)=1`, so a single vote (a tie) restarts; prompt.md:67 says "majority restarts." Accurate, though "half-or-more" is a defensible reading for odd counts.

5. **CONFIRMED (harmless seam).** `announceRoundStart` sends `startAtTick: CONFIG.ROUND_INTRO_TICKS` = `3*30` = 90 (match.ts:111, config.ts:126); `reattach` sends `startAtTick: 0` (room.ts:169). The client turns this into `introEndMs` (game.ts:50), so a reconnector skips the 3-2-1 gate. The two emitters do diverge as claimed — though `0` for a mid-round reconnect is arguably the correct behavior (no countdown mid-round), making this a real inconsistency but not a defect.

SEED VERDICT: **leaks real seed** — `round_start` ships the exact `mixSeeds(baseSeed, roundNo)` that drives the bundled `generateMap`'s single RNG stream rolling `castleContents`, so any client can recompute every hidden power-up before reveal, and the server's own snapshot omission of `castleContents` confirms there is no decoy.
