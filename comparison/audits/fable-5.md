<!-- Audit of Fable 5's OWN submission, by an independent Claude Fable 5 subagent, 2026-07-17.
     Unlike the five rival audits, this auditor was given a deliberately HARSHER, adversarial
     framing (hold to a stricter standard, assume a fatal bug hides, disprove the author's
     self-claims) to counter the structural conflict of interest — Fable 5 both wrote this
     code and is orchestrating the comparison. Verify independently; the load-bearing claims
     (map-seed decoy, passing ranked e2e) are checkable from the public code. -->

I have everything needed. I ran the tests (28/28 pass), typechecked all three packages clean, and ran the soak three times to empirically confirm the flakiness. Let me compile the final adversarial report.

---

# ADVERSARIAL AUDIT — Splash Critters (Fable 5)

**Verdict up front:** I tried hard to find this codebase's fatal "integration seam" bug — the equivalent of the rivals' crash-on-first-DB-write / circular-import / never-sent-snapshot / `'Space'`-vs-`' '` bugs — and **I could not find one.** The code builds a clean type-check across all three packages, 28/28 unit tests pass, the soak completes, and I traced every integration boundary (DB writes, ws handler, game loop, prediction reconciliation, key binding). This is a genuinely complete and correct submission. Its real weaknesses are (1) no process-level crash guard as defense-in-depth, (2) a marginal Hard-bot AI, and (3) FFA bot matches that drag to the draw cap — none fatal.

---

## 1. SPEC FIDELITY — **9/10**

Nearly every feature is implemented for real, not stubbed. Spot-verified against the sim and tests:
- **Chain bursts in ONE tick via BFS/queue:** `sim.ts:265-288` (`resolveBursts` drains a queue within one tick); test `sim.test.ts:57-71` asserts a 3-balloon chain leaves `balloons.length===0` same tick with `chain_burst` size 3.
- **Power-ups pre-rolled at map gen:** `map.ts:76-82` rolls contents into `contents[]` during generation; `sim.test.ts:20-27` asserts identical seed → identical `grid` AND `contents`.
- **Balloon kick** (`sim.ts:200-224`, test `168-194` slides-and-stops keeping fuse), **revenge ducks** casual-only (`gameLoop.ts:89-92` ranked override), **rising tide** (`sim.ts:226-249`, test `228-244`), **matchmaker widening** ±100→+50/10s→±400 (`matchmaker.ts:20-23`), **15s grace + ranked forfeit + casual→Medium-bot** (`gameLoop.ts:312-343`), **rematch majority** (`rooms.ts:287-305`), **room GC** (`rooms.ts:317-324`), **profanity filter** (`names.ts:12-15,36-38`), **XP/levels/unlocks** (`queries.ts:72-93`), **keybind remap/colorblind/reduced-shake** (`settings.ts`), **rate-limited emotes** (`net.ts:83-88`), **real scripted 5-step tutorial** running the shared sim offline (`tutorial.ts:85,129`).

Docked 1: spec says "ranked matches run in hidden rooms created by the matchmaker," but `matchmaker.ts:101-110` creates bare `Match` objects with no `Room` (functionally fine — reconnect routes via `activeMatchByPlayer`, but a literal spec deviation).

## 2. SECURITY & ANTI-CHEAT — **8/10**

**(a) mapSeed claim — VERIFIED TRUE, the author is not bluffing.** `gameLoop.ts:151` generates the REAL seed (`const seed = Math.floor(Math.random()*0x7fffffff)`), feeds it to `generateMap` at `:152`, and it never leaves the server. The `round_start.mapSeed` at `:174` is a **separate independent** `Math.random()` decoy. Only `castleGrid: this.state.grid` (`:175`) — tile *types*, not contents — is sent. `contents` is never in `SnapshotData` (`protocol.ts:92-101`) nor `round_start`, and the client mirror hard-fills contents with null (`prediction.ts:57`). The client literally cannot reconstruct hidden power-ups: it lacks both the generator seed and the RNG call-order. Claim holds.

**(b) Input validation:** `net.ts:98,276` clamp `dir` to 0-4 before it indexes `DIR_VECS`; `seq`/`tick` are never used as array indices; positions come only from the server sim (client-sent positions don't exist in the protocol). No desync/crash vector found. **(c)** Real token-bucket rate limiter (`net.ts:67-77`, 60/s + 1.5× burst). **(d)** Device token hashed with sha256 (`queries.ts:30-32,35`). **(e)** SQL 100% parameterized (every `.run(?)`/`.get(?)`; leaderboard mode bound, not interpolated).

**(f) The one real gap:** individual ws handlers (`net.ts:153-306`) and the `setInterval` game-loop pump (`gameLoop.ts:436-451`) have **no try/catch**, and there is **no `process.on('uncaughtException')`** anywhere (grep confirmed). The top-level `JSON.parse` is guarded (`net.ts:110-116`), and I traced every reachable handler path without finding a throw — but `finalizeMatch` (DB writes) runs unguarded inside the loop. A single unanticipated throw would kill the **entire process** (all live matches), not one connection. This is the closest thing to a fatal seam; it is not currently triggerable that I could find, so it's a latent robustness hole, not a confirmed crash.

## 3. CORRECTNESS BUGS — **8/10**

The sim is unusually correct (verified by trace + 28 tests). Genuine findings, in priority order:

1. **Flaky Hard bot (root cause identified):** `bot.ts:64` estimates traversal as `tpt = ceil(TICK_RATE/speed)` and the BFS costs each tile a flat `dist × tpt` (`:287,305`) with **no turn penalty**. But `movement.ts:88-137` (`alignPerp`/`cornerAssist`) burns extra ticks re-centering on every corner. So Hard's escape ETA is *optimistic* and it gets caught in its own or a chained splash in tight corridors — handing rounds to Easy in a first-to-3 duel. **Empirically confirmed:** soak ran 7/10, 7/10, 10/10 across my three runs — the first two land exactly on the ≥70% bar.
2. **FFA bot matches drag to the MAX_ROUNDS draw cap:** my soak logged FFA matches of 42k-58k ticks (~15 rounds). Rounds routinely run past the 2:00 tide, which floods both survivors on the same tick → draw rounds that don't score. Guarded by `MAX_ROUNDS=15` + a 150k-tick ceiling (`soak.ts:14`), so no hang — but a gameplay-quality weakness (matches decided by attrition, not skill).
3. **No crash guard** (see 2f) — a correctness/availability risk.
4. **Minor:** duel tie awards placement arbitrarily to seat 0 (`results.ts:18`); a finished ranked match leaves a stale `conn.match` reference (harmless — inputs dead-queue capped at 8, cleared on next `leaveEverything`).

No refund leaks: revenge balloons never increment `balloonsActive` and are filtered without decrement everywhere (`sim.ts:243-247,283-287`); reconnect correctly nulls `lastInput`/`ackSeq` so the client's monotonic seq resyncs (`gameLoop.ts:203-216`).

## 4. NETCODE — **9/10**

**Genuine rewind-replay**, not cosmetic: `prediction.ts:126-129` filters input history by server `ackSeq`, adopts the authoritative position, and replays unacked inputs through the same shared `movePlayer`; corrections decay as a visual offset (`:131-132`, `clampErr` snaps >1.5 tiles) so there's no rubber-band. Remote entities interpolate at `serverTime − INTERP_DELAY_MS` (`renderTick`, `:83-85`). Snapshots at 15Hz via toggle over the 30Hz loop (`gameLoop.ts:398-401`); `ackSeq` is per-seat (`:406`). Fuses render from server ticks (`game.ts:326`, `(burstTick − renderTick)/FUSE_TICKS`). Weaknesses: prediction always passes `canKick=false` (`:128,140`) so a local kick pops until reconciled; mirror balloons carry `range:1` (fine — collision-only); `LATENCY_MS` is applied as `setTimeout` on both ends. All minor.

## 5. CODE QUALITY — **9/10**

Every source file is **under 500 lines** (largest: `gameLoop.ts` 454). Shared sim is **provably pure**: grep found zero `Math.random`/`Date.now`/`performance.now` in `shared/src`, and it imports only relative paths (zero external deps). **Zero explicit `any`** in the entire `src` tree; `npm run typecheck` passes clean in strict mode across all three packages. CONFIG/schema are single sources of truth. Clean two-layer separation (auth-layer `users`-equivalent vs business layer taking `userId`). Trivial dead code (`bot.lastPlan` telemetry).

## 6. TEST DEPTH — **9/10**

28 meaningful assertions, not smoke tests. They pin the exact invariants the spec calls out: chain-in-one-tick (asserts `balloons.length===0` + size 3), splash-stops-at-first-castle (asserts the *second* castle at (4,1) survives and no splash tile beyond), seed→identical hidden contents, kick preserves fuse (`burstTick===500`), draw round (`winnerSlot===-1`), and **Elo fixtures matching exact spec numbers**: duel +16/-16, K=64 first-10 → +32/-32, favorite +8/-8, upset +24/-24, FFA pairwise `[+16,+5,-5,-16]`, shared-2nd `[+16,0,0,-16]`, zero-sum, placements `[1,2,2,4]`. `e2e.mjs:169-201` genuinely drives ranked Elo end-to-end — real server, queue → `match_found` → `B.drop()` → 15s grace → forfeit → asserts A=1032/B=968 in `match_end` **and** on `GET /api/leaderboard`. This is not faked.

---

## TOP FINDINGS

1. **Anti-cheat claim is TRUE, not a decoy story.** Server generates the real seed (`gameLoop.ts:151`), never sends it, ships an independent random `mapSeed` (`:174`) and only tile-types (`:175`); contents are never serialized and the client mirror is null-filled (`prediction.ts:57`). Hidden power-ups are genuinely underivable client-side.
2. **No fatal integration seam found.** Unlike every rival, first DB write works (migrations transactional, `db/index.ts:23-41`), snapshots flow (15Hz, `gameLoop.ts:398-408`), keys bind on `e.code` and are read on `e.code` (`main.ts:60-63` ↔ `input.ts:5-16` — no Space/`' '` mismatch), no circular-import crash (typecheck + tests run).
3. **Biggest real risk: zero process-level crash guard.** Handlers (`net.ts:153-306`) and the game loop (`gameLoop.ts:436-451`) are unguarded and there's no `uncaughtException` handler; any future/unanticipated throw in `finalizeMatch` or a handler downs *all* matches. Not currently triggerable, but the one place a latent bug becomes catastrophic.
4. **Hard-bot flakiness is real and correctly self-diagnosed.** BFS escape-time ignores corner-assist turn cost (`bot.ts:64,287` vs `movement.ts:88-137`); soak hit 7/10 twice in my runs — dead on the ≥70% bar.
5. **FFA bot matches drag to the draw cap** (observed 42k-58k ticks): tide forces same-tick mutual soaks → draw rounds until `MAX_ROUNDS`. Well-guarded (no hang) but a genuine quality gap.

## ONE-LINE VERDICT

**On the evidence, Fable 5 is materially more complete and correct than a submission with a fatal integration bug — its anti-cheat claim is verified true, its prediction is real rewind-replay, its sim is pure and test-locked, and I could not disprove its playability; its only meaningful liabilities are a missing crash-guard (latent, not triggered) and a marginally-tuned Hard bot.**
