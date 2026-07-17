<!-- Full audit report for grok-4.5, produced by an independent Claude Fable 5 subagent, 2026-07-17. -->

I have completed a thorough read of every source file plus empirical verification (ran the test suite, the soak script, and a custom draw-case reproduction). Here is the audit.

---

# Splash Critters — Audit Report: `results/grok-4.5`

Reviewed all 40 source files across `shared`/`server`/`client`, ran `npm test` (14/14 pass), `npm run soak` (pass), and a custom sim harness to verify the draw bug empirically.

---

## 1. SPEC FIDELITY — SCORE 8/10

Nearly every spec system is genuinely implemented, not stubbed.

- **Balloon kick**: real, server-simulated in `sim.ts:429-434` (walk into balloon w/ boots → `bal.sliding=true`) + slide resolution `sim.ts:467-501`; danger map accounts for balloons at `dangerMap.ts:83-94`.
- **Revenge ducks**: `sim.ts:212-220` (border placement on soak) + `sim.ts:339-381` (border movement + 3-tile lob, `REVENGE_COOLDOWN_TICKS`), casual-only via `enableRevengeDucks && !ranked`.
- **Rising tide**: `sim.ts:522-563`, ring per `TIDE_INTERVAL_TICKS`, dissolves castles/balloons/powerups and soaks.
- **Chain bursts in ONE tick via BFS**: `sim.ts:256-335` — single `while(queue.length)` loop, chained balloons use own `splashRange` (`sim.ts:278`), emits `chain_burst` with `count`. Verified by test (`sim.test.ts:120-129` asserts `state.tick === before+1` and `count===3`).
- **Power-ups pre-rolled at map gen**: `map.ts:99-108` rolls `hiddenPowerups` with the seeded PRNG at generation; revealed on wash (`sim.ts:183-195`). `POWERUP_BLOCK_CHANCE=0.30` + weights match spec exactly (`config.ts:30-36`).
- **Pairwise FFA Elo**: `elo.ts:36-59`, `K'=K/3` (`elo.ts:49`), K=64 first 10 games then 32 (`elo.ts:7-11`, `config.ts:63-65`).
- **Matchmaker widening**: `matchmaker.ts:60-62`, base 100 +50/10s cap 400 (`config.ts:55-59`).
- **15s grace / forfeit / bot conversion**: `gameLoop.ts:227-260` (ranked forfeit-soaks; casual → medium bot).
- **Rematch majority**: `index.ts:381` `yes > humans.length/2`.
- **Room GC**: `rooms.ts:368-376`, `ROOM_TTL_MS` 10 min.
- **Profanity filter**: `queries.ts:133-146`. **XP/unlocks**: `queries.ts:190-204`, curve `xpForLevel=100+25n` (`config.ts:122`). **Settings** (remap/colorblind/shake/mute-M): `settings.ts` + `main.ts:633-670`. **Tutorial**: `tutorial.ts` + `index.ts:418-448`.

Gaps: **Emote rate-limiting** has no dedicated cooldown — emotes ride only the global 60-msg/s limiter (`index.ts:363-368`), not the spec's intent of a per-emote rate limit. Practice from the menu only ever launches a 2p Duel (`main.ts:484` hardcodes `size:2`); FFA practice is unreachable from the UI. Draw handling is broken (see §3).

---

## 2. SECURITY & ANTI-CHEAT — SCORE 3/10

**(a) CRITICAL PROBE — the mapSeed IS the real, powerup-rolling seed and it is shipped to clients.** This is the exact vulnerability the spec warns against ("contents never sent to clients until revealed … unguessable, unhackable"). Trace:
- `gameLoop.ts:183` `const mapSeed = (Math.random()*0xffffffff)>>>0;`
- `gameLoop.ts:193-208` `createRoundState({ mapSeed, ... })` → `sim.ts:38` `generateMap(width,height,opts.mapSeed,...)` → `map.ts:104-107` rolls **hidden power-up contents** from that same seed's PRNG stream.
- `gameLoop.ts:211-219` sends that identical `mapSeed` in `onRoundStart`, broadcast as `round_start{mapSeed}` (`index.ts:104-105`, protocol `protocol.ts:106-115`).
- Client `prediction.ts:54-68` calls `createRoundState({ mapSeed: round.mapSeed, ... })`, which re-runs `generateMap` and populates `pred.state.hiddenPowerups` with the **real contents of every castle**. A one-line console read of `pred.state.hiddenPowerups` reveals all power-ups before they are washed. Fully cheatable, deterministic, confirmed. It is NOT a decoy.

**(b) Server input validation is near-absent.** Only `input` is validated (`net.ts:55-62`, `index.ts:351`). Every other message type is cast straight from JSON (`net.ts:45-53` returns `msg as C2S`). A JSON-parseable but ill-typed message crashes the server: e.g. `{"t":"join_room","code":123}` → `rooms.get(123)` → `code.toUpperCase()` (`rooms.ts:79`) throws; `{"t":"create_room","opts":null}` → `Array.from({length: opts.size})` throws; `{"t":"set_nickname","nickname":123}` → `.trim()` throws.

**(f) No exception guard anywhere.** `ws.on('message')` (`index.ts:461-465`) calls `handleMessage` with no try/catch, and there is **no `process.on('uncaughtException')` handler** (verified: grep empty). Any of the throws above propagates as an uncaught exception → whole server process (all rooms/matches) dies. Remote DoS from a single malformed frame.

**(d) Token hashing**: SHA-256 (`queries.ts:51-53`) — unsalted but acceptable for 24-byte random device tokens. **(e) SQL safety**: all queries parameterized with `?` (`queries.ts` throughout) — no injection. **(c) Rate limiting**: 60/s sliding window (`net.ts:25-31`) present and correct.

The good parts (SQL, rate limit, hashing) are outweighed by a critical, confirmed cheat vector and a trivially crashable message loop.

---

## 3. CORRECTNESS BUGS — SCORE 5/10

**1. Ping readout is the server's ping interval, not RTT (~2002ms constant).** `net.ts:59-66`: on each inbound `ping`, `this.rtt = now - this.lastPingSent`, but `lastPingSent` is overwritten with the arrival time of the *previous inbound ping* (`net.ts:65`). So `rtt` = time between two consecutive server pings = `PING_INTERVAL_MS` (2000ms) ± jitter. The server's `pong` handler (`index.ts:389-392`) only stores `client.lastPong` and echoes nothing, so the protocol gives the client no way to measure true round-trip. `net.rtt` is rendered directly as the HUD ping (`main.ts:770` → `hud.ts:45`). Root cause of the constant ~2002ms. `clockOffset` (`net.ts:66`) is derived from the same bogus rtt and is **never read anywhere** (verified) — clock sync is dead code.

**2. Same-tick double-soak never produces a draw (spec: "Last two players soaked on the same tick = draw round").** `updateLiving` (`sim.ts:225-242`) latches `roundOver` on the *first* soak: when p1 is soaked, living=[p2], it sets `roundOver=true, winnerIds=[p2]`. p2 being soaked later in the same `burstBalloon` tile loop re-enters `updateLiving` but the guard `!state.roundOver` is now false, so the draw branch (`sim.ts:233-239`) is unreachable dead code. **Verified empirically**: my harness placed a range-2 balloon between two players on the same row; result was `winnerIds:["p2"]` with both `soaked:true` — a win awarded where the spec mandates a draw.

**3. Easy bots deliberately place balloons with no verified escape — they can soak themselves (spec: "Bots never freeze or soak themselves").** `bot.ts:116`: `if (canEscapeAfterPlace(...) || (difficulty === 'easy' && rand() < 0.2)) wantBalloon = true;` — the `|| easy && rand()<0.2` branch bypasses the escape check entirely 20% of the time, on top of the 12% danger-misjudgment error rate (`config.ts:86`). This is a direct route to self-soak, matching the soak-log's 91-tick (3s) duel round.

**4. Unvalidated-message server crash** (detailed in §2b/§2f) — a genuine correctness/robustness defect independent of the anti-cheat framing.

**5. Interpolation ignores clock sync and uses local arrival time, not `serverTime − 100ms`.** `prediction.ts:186-187` timestamps remote buffer entries with `performance.now()` (client receive time); `getRemotePos` (`prediction.ts:196`) interpolates at `performance.now() − INTERP_DELAY_MS`. The spec's `serverTime − 100ms` scheme (and the computed `clockOffset`) is not used, so interpolation timing drifts with network jitter rather than server clock.

---

## 4. NETCODE — SCORE 6.5/10

Prediction/reconciliation is **real, not cosmetic.** `prediction.ts:98-176`: on each snapshot it rebuilds authoritative state from the snapshot, reads the server-acked `inputSeq` (`prediction.ts:106`), drops acked inputs (`prediction.ts:155`), and **replays the unacked local input buffer** via `simulateTick` (`prediction.ts:158-172`). Input history buffer is ~1s (`prediction.ts:84-87`, capped at `TICK_RATE`). Local input is applied immediately for snappy feel (`prediction.ts:90-95`). Rates match spec: 30Hz sim, snapshots 15Hz (`gameLoop.ts:329-333`, every 2 ticks), inputs sent 30Hz (`main.ts:707`). Remote entities interpolate with a 100ms delay (`prediction.ts:196`, `INTERP_DELAY_MS`).

Weaknesses: (1) clock-sync is broken and unused (§3.1) so the interpolation clock is local-arrival-based, not server-time-based; (2) reconciliation replays only the local player and then *restores* remote positions verbatim (`prediction.ts:161-171`) — remote balloons/players aren't re-simulated, acceptable but simplistic; (3) `input.tick` is sourced from the last snapshot tick (`main.ts:712`), which can be stale by up to a snapshot interval.

---

## 5. CODE QUALITY — SCORE 8/10

Clean, modular, and closely matches the spec's prescribed folder layout (`shared` config/types/rng/map/sim/protocol/elo; `server` net/rooms/gameLoop/matchmaker/elo/db/bots; `client` screens/render split). **Shared-sim purity verified**: grep for `Math.random|Date.now|performance.now` in `packages/shared/src` (excluding tests) returns nothing — the sim is deterministic and RNG flows only through the seeded `mulberry32` (`rng.ts`). TypeScript `strict:true` (`tsconfig.base.json:7`), strong discriminated-union protocol (`protocol.ts`), auto-inferred types. Minor: `main.ts` is 817 lines and `sim.ts` 684 (large single files, though the spec imposes no size limit); some dead code (`rooms.ts:278-366` `createRankedMatch`/`createPractice` are unused — `index.ts` inlines both paths instead).

---

## 6. TEST DEPTH — SCORE 7/10

14 real, assertion-bearing tests (not smoke tests):
- **Determinism**: `sim.test.ts:133-148` runs 30 ticks on two states, asserts identical positions.
- **Chain-in-one-tick**: `sim.test.ts:85-130` — 3 balloons, asserts `balloons.length===0`, `chain_burst.count===3`, and `tick===before+1` (one tick).
- **Splash stops at first castle**: `sim.test.ts:44-83`.
- **Pre-rolled powerups deterministic per seed**: `sim.test.ts:151-159` + `map.test` `hiddenPowerups` equality.
- **Elo fixtures matching spec numbers**: `elo.test.ts` — provisional K=64 win → +32 (`elo.test.ts:59`), standard equal-rating → +16 (`elo.test.ts:20`), FFA pairwise ordering a>b>c and tie shares 0.5 (`elo.test.ts:30-55`).

Gaps: no test for the **draw** path (which is the one that's broken), none for **balloon kick**, none for **rising tide** or **forfeit**. The **soak script asserts only match completion** (`soak.ts:79` returns `max(roundsWon) >= roundsToWin`) — it does not assert bots avoid self-soak or that Hard beats Easy, so the fast-death / self-soak behavior the prompt flagged slips through. (Soak output this run: duel round 2 ended in 91 ticks ≈ 3s; FFA round 2 ran 3645 ticks until the tide forced it — both extremes uncaught.)

---

## TOP FINDINGS

1. **[CRITICAL cheat] The real power-up-rolling seed is broadcast to clients.** `gameLoop.ts:183` generates `mapSeed`, `map.ts:104-107` rolls hidden contents from it, and it's sent verbatim in `round_start` (`gameLoop.ts:211-219`); the client re-derives every castle's contents in `pred.state.hiddenPowerups` (`prediction.ts:54-68`). Directly defeats the spec's "unguessable, unhackable" guarantee.
2. **[Crash/DoS] No message validation or exception guard.** Only `input` is validated; a single malformed-but-JSON frame (e.g. `join_room` with a numeric `code` → `rooms.ts:79`) throws with no try/catch (`index.ts:461-465`) and no `uncaughtException` handler → whole-server crash.
3. **[Ping bug] HUD ping is the 2000ms server ping interval, not RTT.** `net.ts:63` `rtt = now - lastPingSent` where `lastPingSent` is the prior inbound ping's arrival time; the `pong` protocol never returns timing. `clockOffset` is computed but unused → clock sync is non-functional.
4. **[Logic bug] Same-tick mutual soak awards a win instead of a draw.** `updateLiving` latches `roundOver`/`winnerIds` on the first soak (`sim.ts:225-242`), making the draw branch dead. Empirically reproduced: `winnerIds:["p2"]` with both players soaked.
5. **[Bot bug] Easy bots place balloons with no verified escape** (`bot.ts:116` `|| easy && rand()<0.2`), enabling self-soak — violating "Bots never soak themselves" and consistent with the ~3s duel deaths.

## ONE-LINE VERDICT

An impressively complete, well-architected, deterministic implementation with real prediction/reconciliation and genuine tests — undermined by a critical seed-leak that makes hidden power-ups fully cheatable, a trivially crashable unvalidated message loop, and a cluster of concrete logic bugs (constant-ping clock-sync, broken same-tick draw, self-soaking easy bots).
