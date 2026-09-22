<!-- Audit of the 'Grok 4.7 (default)' submission by an independent Claude subagent, 2026-09-21, under
     the SAME neutral rubric the thirteen rivals got, PLUS a second independent fact-checker. The
     orchestrator (running as Claude Opus 5) independently reproduced firsthand: the loot-salt PRNG
     recovery attack (harness/attack-grok47-lootsalt.ts), the crash test, playability, the refuted
     snapshot leak, and the hollow soak passes. -->

All evidence gathered and cross-checked against the real code. The `any` hits are the string literal `'any'` (a mode filter), not the type — the src has zero `any`/`@ts-ignore`. Writing the audit.

---

# Grok 4.7 (default) — Splash Critters audit

Verified against `/Users/jackychou/splash-critters-llm-comparison/results/grok-4.7`. Build, typecheck, 8 unit tests, and soak all pass. I booted the built server and fired malformed frames; I measured bot behavior over hundreds of rounds; and I **built and ran the PRNG loot-recovery attack against the real shared `generateMap`**. Every self-claim below was checked against code and runtime, not the README.

## SPEC FIDELITY — SCORE 6/10

Nearly every mechanic is implemented for real, not stubbed: balloon kick (`sim.ts:242` `maybeKick`, `sim.ts:396` `advanceSlides`), revenge ducks that genuinely **ride the border** (`sim.ts:549` sets `duckPos = nearestBorder(...)`, `sim.ts:356` `advanceDucks` lobs inward from the border cell — not from the death tile), rising tide (`sim.ts:519`), chain bursts resolved in one tick via BFS (`sim.ts:471` `explodePass`), power-ups pre-rolled at map gen (`map.ts:95-113`), pairwise FFA Elo with `K'=K/(n-1)` (`elo.ts:47`), matchmaker widening (`config.ts:164` `searchRange`), 15s grace + ranked forfeit vs casual bot conversion (`gameLoop.ts:241-248`), rematch majority (`rooms.ts:293`), room GC that does **not** kill a room while a human is present (`rooms.ts:440-444`), server-enforced XP/unlocks (`db/index.ts:190-203`, `setCosmetic` checks `unlocks`), settings actually read by render (`game.ts:252` colorblind, `game.ts:134/213` shake, `game.ts:81` keybinds), emotes rate-limited (`index.ts:187`). **The disqualifying gap:** the AI opponents are functionally dead — see Correctness. Casual, Practice, and the Tutorial opponent all depend on bots, and they never drop a balloon, so a marquee feature only *looks* implemented. Minor deviation: ranked FFA Elo divides by `players.length-1` over surviving humans (`gameLoop.ts:396`→`elo.ts:47`), so a mid-match dropout makes `K'` ≠ `K/3`.

## SECURITY & ANTI-CHEAT — SCORE 4/10

**(i) The hidden power-ups are fully recoverable — the marquee requirement FAILS.** I built the attack and ran it against the real `generateMap`. `gameLoop.ts:253-254` draws `seed` then `lootSalt` as two **consecutive** calls of one `mulberry32` whose entire state is a 32-bit int advancing by a fixed `+0x6d2b79f5` (`rng.ts:1-9`); tempering is a bijection. Recovering the state behind the broadcast `seed` yields the next output → `lootSalt`. My harness minted rounds exactly as the server does, recovered candidate states from the seed alone across 10 workers, disambiguated with a handful of publicly-revealed drops, and reconstructed the **exact** hidden layout:
```
{"mode":"duel","seed":2126321094,"secretLootSalt":1606342359,"candidateLootSalts":2,"saltRecovered":true,"hiddenPowerups":13,"fullHiddenLayoutRecoveredExactly":true,"wallTimeSeconds":2.58}
{"mode":"ffa","seed":1182446904,"candidateLootSalts":7,"saltRecovered":true,"hiddenPowerups":19,"fullHiddenLayoutRecoveredExactly":true,"wallTimeSeconds":2.66}
```
The separate `lootRng` stream is cosmetic: recovery here is **~2.6s**, *faster* than Fable 5 (21.8s) and Opus 5 (~76s). This is the same failure class as the ten seed-broadcasters — Grok 4.7 did **not** solve what only Astra solved. (ii) A revealed drop leaks nothing extra because (i) already gives the whole board in one seed. (iii) No bot draws fall between the two draws — `beginRound` runs synchronously and bots only consume `this.rng` during `playing` ticks, so recovery is clean every round. (iv) Snapshots correctly hide unrevealed contents (`snapshot.ts:79` filters `!p.hidden`). (v) The `seed ^ 0x5bd1e995` default (`map.ts:63`) is unreachable on the server path (always passes explicit `lootSalt`).

**(b)-(f) Malformed-frame hardening is genuinely strong and the sibling crashes are fixed.** `parseClientMessage` (`net.ts:25`) rejects oversized/non-object/bad-type frames; `hello` coerces a non-string token to `undefined` (`net.ts:37`), so `createHash(...).update(token)` at `index.ts:81` is **never** reached with a non-string — the exact bug that crashed Grok 4.5, 4.6, and 4 others. I fired raw `null`/number/array/object/boolean tokens, non-JSON, oversized, pre-auth `queue_join`/`start_match`/`input`: the process survived every frame (`health=200` throughout), pre-auth commands got a clean `error{code:"hello"}`. Rate limiting is real (`net.ts:7`, 60/s sliding window). SQL is parameterized everywhere (`db/index.ts`). **(g) But there is NO `process.on('uncaughtException')` anywhere, and a single guest socket can degrade/OOM the whole process:** every `practice_start`/`rematch_vote` spins a fresh hidden `LiveMatch` (`rooms.ts:314` `startRoom`) while `createSpecial`'s `this.leave()` cannot free the player's prior *live* match (`rooms.ts:180` only marks it disconnected), so matches accumulate and all tick at 30Hz in one global `setInterval` (`index.ts:286`). Flooding from 3 sockets, a legit observer's snapshot rate collapsed 15/s → 2/s and RSS climbed 131→162MB while CPU pinned 100% — same room-exhaustion class that took Astra down, here as availability degradation rather than an instant crash. A concurrent-hello token race (`index.ts:106-108` → `db/index.ts:66` UNIQUE) is an unguarded throw that, with no handler, exits the process.

## CORRECTNESS — SCORE 5/10

**#1 (P0) Bots never place a balloon — every match is decided by the tide, and Hard does NOT reliably beat Easy (acceptance criterion fails).** `Bot.canPlace` (`bot.ts:234`) simulates a lookahead balloon but never grants the placing bot phase-through on it, unlike `sim.ts:321` which sets `player.phasingX/Y` for humans. So `searchEscape` (`bot.ts:107`) calls `canStand`, which via `tileBlocked` (`sim.ts:205`) treats the bot's own fresh balloon as solid (`phasingX===-1`), can't step off, returns `null` → `canPlace` returns false → **no bot ever places**. Measured directly:
```
easy: 8 rounds, balloonsPlaced=0, offensiveSoaks=0
medium: 8 rounds, balloonsPlaced=0, offensiveSoaks=0
hard: 8 rounds, balloonsPlaced=0, offensiveSoaks=0
```
Over 110 real Hard-vs-Easy duels: 98 tide draws, wins split 12/12; monkey-patching a single `phasingX/Y` fix makes Hard win 55/55 in ~6s rounds — proving the root cause. The soak (`soak.ts:78`) "passes" only because one fixed seed happened to flood Hard's corner last; it certifies a false "Hard beats Easy," Muse-Spark-style.

**#2 Grok-lineage regressions FIXED:** HUD ping is real RTT (`index.ts:113` `Date.now()-serverTime`, surfaced via `snapshot.ts:62`) — no `ping*0.95+40*0.05` pin; same-tick mutual soak → **draw** (`sim.ts:617-626`, both `alive=false` → `alive.length===0`); server input ack is real (`gameLoop.ts:224` `ack.set(input.seq)` → `snapshot.ackSeq`). **#3** Round 1 renders for a joiner (`resync`/`match_start`→`round_start` ordering, `gameLoop.ts:185`). **#4** `destroyExposed` (`sim.ts:456`) gives a power-up revealed *this* tick one tick of grace before a same-tick splash can destroy it — arguably lenient, not a bug. **#5** The concurrent-hello UNIQUE race (above) can crash with no handler.

## NETCODE — SCORE 8/10

Genuine rewind-replay, not cosmetic. Server populates `ackSeq` from the consumed input's `seq` (`gameLoop.ts:224`, `snapFor`→`snapshot.ts` `ackSeq`); the client drops acked inputs and replays the rest (`prediction.ts:44` `pending.filter(i => i.seq > snap.ackSeq)` then `simulateTick` per pending). Remote interpolation genuinely reads the constant (`game.ts:259` `Date.now()+offset - CONFIG.INTERP_DELAY_MS`, sampled in `samplePlayer`). Sim is 30Hz (`index.ts:286`), snapshots 15Hz (`gameLoop.ts:233` `tick % 2 === 0`). Fuses render from server ticks (`game.ts:237-239`). Ping is real RTT via 2s ping/pong (`index.ts:288-294`, `net.ts:38`). The `?lag=150` flag is honored (`net.ts:13/41/61`). Deduction: clock offset uses `rtt/2` one-way estimate and interpolation only spans buffered snapshots — fine, but no jitter buffer beyond raw sample pairs.

## CODE QUALITY — SCORE 8/10

Architecture matches the spec's folder contract precisely; shared sim is **pure** (grep confirms zero `Math.random`/`Date.now` inside `simulateTick`/`generateMap`). Typing discipline is excellent: **zero** `any` type and zero `@ts-ignore`/`@ts-expect-error` across all `src` (the five `any` grep hits are the string literal `'any'` room-filter value). Orchestration reads cleanly (`gameLoop.tick` reads like English). Dead code is the main blemish: `bot.ts` `align`, `anyMove`, `dirSafe`, `nearestSafeTile`, and `flee` all have **0 callsites** (confirmed), plus `void DIRS`/`void pal` placeholders in `game.ts:371/292`. File sizes are fine (prompt has no length rule; largest is `sim.ts` at 787).

## TEST DEPTH — SCORE 7/10

The 8 Vitest cases assert real invariants, not padding: a 3-balloon chain bursts in one tick with `balloons.length===0` and `chain_burst count:3` (`sim.test.ts:13`), splash stops at the first sandcastle **and** reveals its power-up (`:27`), boulders block splash (`:42`), same seed → identical tiles **and** identical hidden power-ups with `>0` present (`:54`), and Elo fixtures cover `kFactor` boundaries, duel deltas, 4p pairwise (`a:16,b:5,c:-5,d:-16`), and shared-placement ties (`:66-107`). The soak (`soak.ts`) does assert `selfSoaks===0` (the check that would catch a Muse-Spark suicide bug) — but it runs one deterministic seed and its "Hard beats Easy" assertion is satisfied by tide luck, giving false confidence about the dead-bot defect above. No coverage of kick, tide, revenge, or reconnect.

## TOP FINDINGS (5)

1. **(P0, anti-cheat) Hidden power-ups fully recoverable in ~2.6s from the broadcast `mapSeed` alone.** `gameLoop.ts:253-254` draws `seed` and `lootSalt` as consecutive outputs of one 32-bit `mulberry32` (`rng.ts:1`); I built and ran the recovery against the real `generateMap` and reconstructed the exact layout every round (`saltRecovered:true, fullHiddenLayoutRecoveredExactly:true`). The marquee requirement fails — faster than Fable 5 and Opus 5.
2. **(P0, correctness) Bots never place a balloon; matches are tide roulette and Hard does not beat Easy.** `bot.ts:234` `canPlace`→`searchEscape` never models the placer's own-balloon phase-through, so `canStand` (`sim.ts:205`) blocks escape and placement is always refused. Measured: `balloonsPlaced=0` at every difficulty; 98/110 Hard-vs-Easy duels are tide draws.
3. **(P0, availability) Unauthenticated single-socket process degradation/OOM.** Repeated `practice_start`/`rematch_vote` accumulate live 30Hz matches (`rooms.ts:314`, prior match not freed at `rooms.ts:180`) with **no** `uncaughtException` handler; a 3-socket flood dropped a real observer's snapshots 15→2/s and grew RSS 131→162MB with CPU pinned.
4. **(Regressions fixed — credit) Non-string-token crash, fake ping, and mutual-soak win are all resolved.** `net.ts:37` coerces bad tokens so `createHash` at `index.ts:81` never sees a non-string (I verified with numeric/object/array/bool tokens — process survived); ping is real RTT (`index.ts:113`); same-tick double soak yields a draw (`sim.ts:617`).
5. **(Low) Concurrent-hello UNIQUE race is an unguarded crash.** Two simultaneous `hello`s minting the same fresh token both miss `playerIdByToken` and race into `createGuest` (`index.ts:106`→`db/index.ts:66`); the second throws on `token_hash` UNIQUE with no handler to catch it.

## ONE-LINE VERDICT

Grok 4.7 is the best-engineered Grok yet — real rewind-replay netcode, zero-`any` typing, honest tests, and every sibling crash-class patched — but it still fails the anti-cheat centerpiece (hidden loot cracked in ~2.6s), ships bots that never throw a balloon so Hard can't beat Easy, and exposes a single-socket process-exhaustion DoS; a mid-pack finish weighed down by two P0s on the requirements that matter most.

---

## Independent fact-checker verdict (second subagent)

I have all the evidence I need. Here is my independent fact-check.

---

**1. (P0, anti-cheat) Hidden loot recoverable from broadcast `mapSeed` — CONFIRMED.** `gameLoop.ts:253-254` draws `seed` then `lootSalt` as two immediately-consecutive `this.rng()` calls with nothing between them; `seed` is broadcast at `gameLoop.ts:272` as `mapSeed`, and `map.ts:63-65` feeds `lootSalt` into `mulberry32` for the hidden power-ups. I wrote a from-scratch multithreaded C brute-forcer over the full 2³² `mulberry32` state space, recovered the state that emitted the broadcast seed, stepped once to get `lootSalt`, and regenerated the map against the real `generateMap`. Result: **8/8 rounds `saltRecovered:true` and `fullHiddenLayoutRecoveredExactly:true`, avg 0.88s wall** (Apple M1 Max, 10 cores). Bots share `this.rng` but consume no draws *between* the two beginRound draws, so the attack is exact.

**2. (P0, correctness) Bots never place a balloon; Hard doesn't beat Easy — CONFIRMED.** `bot.ts` `canPlace` clones state and pushes the modeled balloon on the bot's own tile but never sets `me.phasingX/phasingY`, whereas the real `tryPlace` (`sim.ts:321-322`) sets them for own-balloon phase-through. So `searchEscape`'s first sub-tile step calls `canStand`→`tileBlocked` (`sim.ts:202-206`), which sees the balloon on the current tile as solid and returns no exit. I verified `canPlace` returns **false even on a wide-open interior tile with 4 empty neighbors**. Over 420 headless rounds: `balloonsPlaced = 0` at every difficulty; Hard-vs-Easy = **0 wins Hard / 18 Easy / 102 draws** (85% tide draws). Outcomes are pure tide roulette; Hard is not better than Easy (it won zero).

**3. (P0, availability) Single-socket process degradation — CONFIRMED (severe DoS, not an outright crash in my window).** `rooms.ts` `leave()` (called by `createSpecial`) only does `setConnected(false)` for a running match and never frees the room; gc keeps hidden rooms ~60s, all ticking at 30Hz. There are **no `uncaughtException`/`unhandledRejection` handlers** in `server/src`. A 3-socket `practice_start` flood pinned CPU at ~98-100%, grew RSS monotonically **126→168MB**, and starved a real observer's own-match snapshots from ~10/s down to **2/s**; a lighter 1-socket flood already drove CPU 0.4%→45% and RSS 81→102MB. The process stayed alive but was degraded to near-unusable; matches the auditor's mechanism and magnitudes.

**4. (Regressions fixed — credit) CONFIRMED.** Booting the built server and firing raw `null`, non-string tokens (numeric/object/array/boolean), no-token, non-JSON, oversized, and pre-auth `queue_join`/`start_match`: the process survived all 14 cases and `/health` stayed up. `net.ts:37` coerces non-string tokens (they yield a fresh guest, never reaching `createHash` with a non-string). Ping is real (finding-5 verdict below). Same-tick mutual soak yields a draw per `sim.ts`.

**5. (Low) Concurrent-hello UNIQUE race — REFUTED as a triggerable crash.** The premise ("two simultaneous hellos both miss `playerIdByToken` and race into `createGuest`") does not hold under Node's single-threaded, synchronous execution: `createGuest`'s better-sqlite3 transaction runs to completion (and commits) before the next `message` handler starts, so later same-token hellos hit `playerIdByToken` and skip the insert. I fired 6 simultaneous same-token hellos × 40 rounds (240 total) and got **240 welcomes, 0 crashes, process alive**. The missing try/catch around `createGuest` is a real latent fragility, but the described crash is not reachable in this process model.

## VERDICTS

- **SEED VERDICT: brute-forceable in ~0.9 s** (state recovered from broadcast `mapSeed`, stepped once to `lootSalt`, exact hidden layout reconstructed 8/8; nothing consumes `this.rng` between `gameLoop.ts:253` and `:254`). Weaker than GPT-6 Astra (unrecoverable), stronger-cracked than Fable 5 (21.8s) and Opus 5 (~76s).
- **CRASH VERDICT: none found.** No pre-auth or malformed-frame crash; every probed frame class survived and `/health` kept responding. The one non-malformed process risk is the resource-exhaustion DoS in finding #3 (degradation, not a clean crash in my run).
- **BOT VERDICT: inverted / effectively broken** — bots never place a balloon (0 across 420 rounds), Hard beats Easy never (0-18), no self-soaks (they can't, since they never place).
- **ROUND-1 VERDICT: renders.** Real client mounts title → menu → practice; round 1 (R1) shows the arena, countdown, then live gameplay with 4 critters, sandcastles, and a running timer.
- **PING VERDICT: real RTT.** Server measures `Date.now() - echoedServerTime` on `pong`; injecting a 180ms client-side echo delay produced a server-reported ping of ~183ms in snapshots (0 without delay). Not faked (unlike Grok 4.5/4.6).
