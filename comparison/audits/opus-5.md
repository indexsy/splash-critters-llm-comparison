<!-- Audit of the Opus 5 submission, 2026-07-24. THREE independent Claude subagents were run:
     (a) NEUTRAL framing (what the rivals got), (b) ADVERSARIAL framing (the harsher framing
     previously reserved for the orchestrator's OWN entry), and (c) a STEELMAN advocate tasked
     with pre-empting unfair criticism. All three are reproduced below in full.
     The neutral pass scored Correctness 8/10 and MISSED the fatal round-1 client bug; the
     adversarial pass found it (Correctness 5/10). The orchestrator independently reproduced
     that bug 5 times in a real browser before scoring, so the adversarial finding governs.
     NOTE: the adversarial pass's seed-recovery attack was subsequently run by the orchestrator
     against its OWN entry (Fable 5), which proved MORE vulnerable (21.8s vs 76s). Fable 5's
     security score was corrected downward as a result. -->

# ADVERSARIAL PASS (governing)

Cleanup done — the repo is back to exactly the state I found it (all scratch scripts removed; only pre-existing untracked build output remains). Both probe servers are stopped.

---

# Adversarial audit — Splash Critters (Claude Opus 5 entry)

**What I actually ran:** full build (clean), `vitest run` (103/103 pass, 6.35 s), `npm run soak` (pass), booted the real `packages/server/dist/index.js` twice, fired 47 hostile frames × 2 (pre-auth + post-auth) + binary + 20 KB frames, ran a 12-room/36-bot 90 s concurrent stress through the production `GameLoop`, drove 4-client ranked FFA + forfeit + casual bot-substitution + reconnect-resync over real sockets, wrote a working seed-recovery attack, and drove the **real browser client** end to end.

---

## 1. SPEC FIDELITY — **SCORE 8/10**

Almost nothing here is a stub. Verified live or by code+test:

| Feature | Verdict | Evidence |
|---|---|---|
| Balloon kick | Real, server-simulated | `shared/src/sim/balloons.ts:84` `tryKick`, `:110` `updateSlides`; regression tests for stop-at-castle/border/balloon (`shared/test/regressions.test.ts:20-69`) |
| Chain in ONE tick via BFS | Real | `shared/src/sim/splash.ts:126` `while (queue.length > 0) { const balloon = queue.shift()...` — cascade removed atomically at `:139` |
| Splash stops at first castle | Real | `splash.ts:76-82` `arms[dir]=step; capped[dir]=true; washCastle(...); break;` |
| Power-ups pre-rolled at map gen | Real | `shared/src/map.ts:120` `rollCastleContents(...)` runs inside `generateMap` |
| Rising tide | Real, ring-scheduled | `shared/src/sim/tide.ts:36`, schedule `map.ts:149-185` |
| Pairwise FFA Elo, K′=K/3 | Correct | `shared/src/elo.ts:83` `const divisor = n === 2 ? 1 : n - 1;` |
| Matchmaker ±100 → +50/10 s → ±400 | Correct + measured | `matchmaker.ts:202-205`; live: range 100 at t=0, **150 at t=10.15 s** |
| 15 s grace → ranked forfeit / casual bot | Both work | live: `"Ranker0 forfeited."` and `"SunnyRaccoon dropped out. A bot is filling in."` |
| Reconnect + resync | Works | live: same playerId, `activeRoom` matched, replayed `match_start`/`round_start`/`snapshot` |
| Room GC | Does **not** kill live matches | `rooms.ts:162` `if (room.match !== null && !room.match.finished) continue;` |
| Emotes rate-limited server-side | Works | live: **40 emotes sent in 2 s → 2 events emitted** (`sim.ts:68` 45-tick cooldown) |
| Settings genuinely READ by render | Yes, all three | `render/hud.ts:399` `return getSettings().reducedShake;`; `render/palette.ts:59` `getSettings().colorblindSplash ? CONFIG.SPLASH_COLORS_CB : ...`; `screens/gameInput.ts:94` `actionForCode(ev.code)` |
| Profanity / XP / levels / unlocks / locker | Real | `shared/src/names.ts:24-62`, `config.ts:284-299`, `players.ts:352-360` |

**Deductions — things that only *look* implemented:**

- **Bot revenge ducks are dead code.** `bots/bot.ts:330` `ghostInput()` (18 lines of border-chasing + lob targeting) is **never called in production**, because `match.ts:279` skips dead bots: `if (player === undefined || !player.alive) continue;`. I instrumented a real `MatchRunner`: a soaked bot's duck is driven by a **frozen stale input** left over from its last living tick — slot 2 sat at `ghostPos 22` for 400 straight ticks (1 distinct value); slot 3 paddled one fixed direction forever (`dir:2`); `balloonPressed` was `false` on every sampled tick, so bots **never lob**. Human ducks work perfectly (360 samples, 156 distinct positions, 5 lobs at the correct 5 s cadence) — the asymmetry is the tell.
- **Tutorial bot is Medium, not Easy**, in a full 13×11 duel arena rather than the spec's "scripted small arena": `room.ts:211` `fillWithBots(difficulty: BotDifficulty = 'medium')`. Live-confirmed: `[{slot:1,isBot:true,difficulty:"medium"}]`, `arena: 13x11`.
- **Showdown music can never trigger in Duel**: `screens/game.ts:270` `if (config.players.length <= 2) return;`.

---

## 2. SECURITY & ANTI-CHEAT — **SCORE 7/10**

**The good (all empirically verified):**
- **Seed is genuinely absent from the wire.** Live capture: `round_start keys: ["castleGrid","countdownTicks","roundNo","scores","startTick","t","theme"]`, `castleGrid distinct values: 0,1,2`, and **0 of hundreds of captured frames matched `/"(seed|mapSeed|rng|contents|castleContents)"/`**. Client prediction zero-fills contents: `client/src/prediction.ts:95` `castleContents: new Uint8Array(cells.length)`.
- **No one-packet crash.** All 47 malformed frames (numeric/null/object/array/5 KB token, `{"t":"__proto__"}`, `constructor`, `valueOf`, NaN/±Inf seq, 9 KB payload, binary) returned typed errors; process stayed up (`HEALTH 200`). Two guards: `net.ts:123` `try { this.handleMessage(...) } catch` and `gameLoop.ts:95` per-room `try/catch`. Prototype-pollution closed at `protocolGuards.ts:236` `Object.prototype.hasOwnProperty.call(VALIDATORS, body.t)`.
- Token hashed (`players.ts:97` `createHash('sha256')`), SQL 100% parameterized (`db/queries.ts`), guest-mint brake per address, rate limit 60/s + hard close 4029 (verified), server never accepts a position (`protocolGuards.ts:193-199` parses only `seq/tick/dir/balloonPressed`).

**The finding that costs it 3 points — I broke the "unguessable, unhackable" claim.**

`snapshot.ts:117` asserts *"The map seed stays behind for the same reason: it regenerates those contents exactly."* That mitigation is **incomplete**, because `map.ts:100-120` uses **one** PRNG stream for both passes:

```ts
const rng = makeRng(seed);
...  if (rng.next() < CONFIG.CASTLE_DENSITY) cells[i] = Tile.CASTLE;   // shipped to clients
rollCastleContents(cells, castleContents, width, height, rng);          // continues the SAME stream
```

The shipped `castleGrid` therefore carries **93 Bernoulli outcomes** (FFA) constraining a **32-bit** seed — a unique solution. I wrote the attack against the real `generateMap`: single-threaded Node, early rejection, **46.4 M candidate seeds/sec**.

```
scan positions: 93 (bits of constraint), true seed: 3522054965
searched 3,522,054,966 seeds in 75.9s (46,387,996 seeds/sec)
recovered seed: 3522054965 === true seed? true
hidden power-up contents match: true  (21 buried power-ups exposed before the round starts)
first 8 leaked: (4,1)=flippers (7,1)=extra_balloon (10,1)=big_splash (5,2)=big_splash ...
```

Worst case ~92 s single-threaded, ~12 s across 8 workers, and effectively **O(1) with a precomputed table** — mulberry32's state walk (`s = (s + 0x6d2b79f5) >>> 0`) is a single fixed cycle over all 2³², so every seed's stream is the same sequence at a different offset. Real fix is one line: roll contents from an independently-seeded PRNG. This is still far better than the 7 prior entries that shipped the seed outright, but it does not meet "unguessable, unhackable".

Minor: `net.ts:183-203` — `client.violations` is reset **nowhere**; only `windowCount`/`warnedThisWindow` reset per second. A long session accumulating 21 lifetime over-limit frames closes the socket.

---

## 3. CORRECTNESS — **SCORE 5/10**

### FATAL: the client sits out **round 1 of every non-tutorial match** — reproduced in a real browser

`router.ts:69-77`:
```ts
export function navigate(path: string, replace = false): void {
  ...
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;        // <-- no render(); relies on async hashchange
  if (replace) render();
}
```
`match_start` and `round_start` are emitted **back-to-back synchronously** by the server (`match.ts:151-154`), so they land in the same socket read. `main.ts:55-58` handles `match_start` by calling `navigate('/game')`, which only queues a `hashchange` task — the game screen (and its `on('round_start')` subscription at `screens/game.ts:215`) mounts **one task too late**. `net.ts:131-133` then dispatches `round_start` to an empty handler set:
```ts
const set = handlers.get(msg.t);
if (!set) return;
```
`roundStarted` stays `false`, so `game.ts:100` `introActive()` is permanently true and `game.ts:318` keeps painting the VS card. **`round_start` is stored nowhere** — `main.ts` buffers `match_start` into the store but not `round_start`.

Browser repro (built client, real server, clicked "Practice vs bots"):
- recorded hashchanges: `[{"#/room/C5DSHU", at:4ms}, {"#/game", at:9ms}]` — the navigation lands *after* the frames.
- **t = 12 s and t = 30 s: still "GET READY"** (VS card holds 2.5 s by design).
- **t = 150 s: recovers exactly at `R2/3`** — the arena appears only when round 2's `round_start` arrives with the screen already mounted.

The benchmark harness's own `opus-5-stuck60s.png` (VS card at 60 s) and `opus-5-round2.png` (`R2/3`) are independent evidence of the same thing. Input is live the whole time (`game.ts:189` keeps sending), so the player is **bombed blind for the entire first round** — up to ~3 minutes. Affects Practice, Casual and Ranked; the tutorial is immune only because `main.ts:40` `SELF_DRIVEN_ROUTES` suppresses navigation and its game view is already mounted. One-line fix: `render()` unconditionally in `navigate`.

### Other defects
- **Bot ghost stale-input** (§1) — `match.ts:279` + `match.ts:295` (`if (this.bots.has(slot)) continue;` never refreshes a dead bot's input).
- `rooms.ts:159-168` `sweep()` destroys a **lobby** room after `ROOM_TTL_MS` with humans still seated and sends them no notice — their client keeps showing a room that no longer exists.
- Deliberate spec deviation, well-documented: `splash.ts:251` spares the "strongest round" when the tide would drown the last survivors simultaneously, rather than drawing.

**Things I tried and could NOT break:** simultaneous-soak draw is correct (`sim.test.ts:155`); no balloon-slot leak (`releaseBalloonSlot` guarded by `counted`, cascade released once via `handled`/`inCascade`); no double-finalise (`gameLoop.ts:104-111`); no forfeit/reconnect race found; 12 concurrent rooms × 36 bots × 90 s produced **zero** `[loop] room ... failed a tick` and zero `[net] message handling failed`; ranked persistence verified directly in SQLite (matches + match_players + ratings rows, `games`/`peak` correct).

---

## 4. NETCODE — **SCORE 9/10**

Genuine, not cosmetic — all four spec requirements met:
- **Rewind-replay reconciliation**: `prediction.ts:165-172` — `this.pending = this.pending.filter(i => i.seq > msg.ack)` then `for (const input of this.pending) this.applyInput(local, input, false);` after `applySnap` overwrites the local critter with server truth. Ghost balloons reconciled by seq too (`:165`).
- **Interpolation at serverTime − 100 ms**: `net.ts:160` `return estimatedServerTick() - CONFIG.INTERP_DELAY_MS / CONFIG.TICK_MS;` feeding `interpolate.ts:39` `blendAt`.
- **30 Hz sim / 15 Hz snapshots**: measured on the wire — consecutive snapshots stepped `t=182,184,186` (every 2nd tick), ~31 ticks/s.
- **Fuses from server ticks**: `protocol.ts:141` `burstTick` on every `BalloonSnap`, rendered against `renderTick`.
- Real `ARTIFICIAL_LATENCY_MS` flag (`net.ts:214`). Round-boundary tick reseed handled (`game.ts:218`).

Half a point off: replay advances the player without advancing `world.tick`, so sliding balloons aren't re-simulated during reconciliation.

---

## 5. CODE QUALITY — **SCORE 9/10**

- **Zero `: any`, zero `as any`, zero `@ts-ignore`/`@ts-expect-error`/`eslint-disable`** across all 136 files. `tsc -b` clean on all three packages.
- Shared sim is pure: no `Math.random`/`Date.now` anywhere under `shared/src/sim/` (`randomSeed()` lives in `rng.ts` and is only called by server code). Determinism proven by `sim.test.ts:390-406`.
- Genuinely good layering — `net.ts` (framing) / `handlers.ts` (meaning) / `room.ts`+`match.ts` (domain) / `elo.ts` (consequences); `MatchRunner` runs with zero connected humans by design, which is why the soak can drive it.
- Comments explain *why*, and several encode real fixed bugs.
- Dead code: `bots/bot.ts:330 ghostInput` (unreachable, §1) plus 9 unreferenced exports (`getLatency`, `getScale`, `hatDef`, `isOpen`, `oppositeDir`, `sfxDestination`, `textHeight`, `tileToScreen`, `toStagePoint`). No unused CONFIG keys — I swept every one.
- Art and audio are real procedural pixel/oscillator code, not placeholders (`render/critters.ts` per-species measurement table; `audio/sfx.ts` per-sound oscillator recipes).

---

## 6. TEST DEPTH — **SCORE 8/10**

**Substantive, not padding.** The exact assertions the rubric asks for all exist:
- 3-balloon chain in one tick + per-balloon range (`sim.test.ts:65-95`), splash stops at first castle (`:16`), splash stops at a balloon (`:112`).
- Seed → identical map **and identical hidden contents** (`map.test.ts:13-18`).
- **Exact** Elo fixtures: duel `32/-32`, `16/-16`, favourite `3/-3`, upset `29/-29`, zero-sum; FFA `[32, 11, -11, -32]`, K/3 sweep = duel win, mixed provisional `[32,…,-16]` (`elo.test.ts:32-117`).
- `regressions.test.ts` and `hostile.test.ts` each document a *real* past defect (three-decimal rounding eating the collision guard band; prototype-key validator lookup; all-forfeit placing quitters first).
- `e2e.test.ts` boots the **real** server over real `ws` and asserts the anti-datamining guarantee by exact key set (`:232-237`) — that is precisely the right test.
- **Soak drives the production loop**, not a reimplementation: `soak.ts:206` `runner.tick(clockMs)` is the same call `gameLoop.ts:109` makes; only the wall clock is synthetic. Same for `harness.ts:247`. Passed: 4 matches, 16 rounds, 40 533 ticks.

**Why not higher:**
- **Zero coverage of revenge ducks anywhere.** `bots.test.ts:59` and the shared helpers pass `revengeDucks: false`, so the ghost path is never exercised — which is how dead `ghostInput` survived.
- **The bot harness diverges from production**: `bots.test.ts:71` polls **every** bot (`for (const bot of bots) inputs.set(bot.slot, bot.update(...))`), including dead ones, whereas `match.ts:279` skips dead bots. That is exactly the soak/test-divergence class flagged in the brief.
- Most importantly, **nothing drives the real client**. The e2e `TestClient` subscribes before `hello`, the one condition a browser can never satisfy — so all 103 tests + soak + e2e are structurally blind to the round-1 bug. A single Playwright smoke test ("arena renders within 5 s of clicking Practice") would have caught it.

---

## TOP FINDINGS

1. **FATAL — `round_start` is delivered to zero listeners, so the client sits on the VS card for the whole of round 1 in every non-tutorial match.** `client/src/router.ts:71` `else location.hash = target;` (no synchronous `render()`) mounts the game screen one event-loop task after the server's back-to-back `match_start`+`round_start` burst (`server/src/match.ts:151-154`), and `client/src/net.ts:132` `if (!set) return;` silently drops it; `roundStarted` never flips so `screens/game.ts:100 introActive()` is true forever. **Reproduced in a real browser**: still "GET READY" at 12 s and 30 s, recovering only at `R2/3` — while inputs kept flowing, i.e. the player is bombed blind for up to ~3 minutes.

2. **The "unguessable, unhackable" power-up secrecy is breakable in ≤ 92 s of one CPU core.** `shared/src/map.ts:100-120` rolls the *shipped* castle layout and the *hidden* contents from a **single** mulberry32 stream, so the transmitted `castleGrid` (93 constraint bits) uniquely determines the 32-bit seed. My attack recovered seed `3522054965` in **75.9 s at 46.4 M seeds/s** and regenerated all 21 buried power-ups exactly, before a single castle was broken — directly disproving `server/src/snapshot.ts:117`'s "The map seed stays behind for the same reason".

3. **Bot revenge ducks are dead code driven by a frozen input.** `server/src/bots/bot.ts:330 ghostInput()` is unreachable because `server/src/match.ts:279` `if (player === undefined || !player.alive) continue;` skips dead bots, and `match.ts:295` never refreshes their stored input. Measured over 400 ticks: one bot's `ghostPos` held a single value; another paddled one fixed direction forever; `balloonPressed` was false throughout, so bots never lob. Human ducks work correctly (156 distinct positions, 5 lobs), which is the proof it is a wiring bug, not a design choice.

4. **The bot test harness diverges from the production driver, which is exactly what hid finding #3.** `server/test/bots.test.ts:71` polls `bot.update(...)` for **every** slot including dead ones, unlike `match.ts:279`, and every bot test runs with `revengeDucks: false` (`bots.test.ts:59`) — so no test in the suite ever executes the ghost path.

5. **Two smaller live-service defects.** `server/src/net.ts:186-188` resets `windowStartMs`/`windowCount`/`warnedThisWindow` each second but **never** `client.violations`, so 21 cumulative over-limit frames across a long session hard-close the socket (4029); and `server/src/rooms.ts:163` sweeps an idle **lobby** room out from under seated players with no notice, leaving their client bound to a room that no longer exists.

---

## ONE-LINE VERDICT

The most disciplined codebase in this comparison by a wide margin — real rewind-replay netcode, zero `any`, no one-packet crash, a production-driving soak and 103 genuinely load-bearing tests — but it ships a one-line router bug that makes the first round of every real match unplayable, and its headline "unguessable" power-up secrecy falls to a 76-second brute force.
---

# NEUTRAL PASS (missed the round-1 bug)

# Splash Critters — Opus 5 audit

Verified by reading every source file, running `npm test` (103/103 pass), `npm run soak` (4/4 scenarios pass), `npm run build` (clean), `tsc -b` (clean), plus five custom probes: a full 2³² seed-recovery attack against the shipped generator, a 65-connection hostile packet fuzz against a live in-process server, a bot-ghost reachability instrumentation run, a stale-input reproduction, and an import-cycle scan.

---

## 1. SPEC FIDELITY — **SCORE 9/10**

Everything on the checklist is not just present but *live*. Spot-verified the ones that are usually fake:

**Balloon kick** — real, server-simulated, sub-tile slide: `packages/shared/src/sim/balloons.ts:110` `updateSlides` walks a per-tick budget with a boundary test (`const toBoundary = toNext - 0.5;`), and `tryKick` (`balloons.ts:84`) enforces lane alignment `if (offset > CONFIG.KICK_ALIGN_TOLERANCE) return false;`. Bots use it: `bot.ts:261` `if (profile.engineersChains && player.hasKick) { const push = kickPush(...) }`, and the danger map treats sliding balloons as sources (`dangerMap.ts:143` `// Sliding balloons still burst on whatever tile they are crossing.`).

**Chain bursts in ONE tick via BFS** — genuine. `sim/splash.ts:126` `while (queue.length > 0) { const balloon = queue.shift() ... for (const other of detonate(state, balloon)) { ... queue.push(other); } }`, with the deliberate ordering `splash.ts:137` `// Balloons stay in the list during the cascade so arms still stop on them,` before `state.balloons = state.balloons.filter((b) => !inCascade.has(b.id));`. Chained balloons use their own range (`detonate` reads `balloon.range`, `splash.ts:67`).

**Splash stops at first castle** — `splash.ts:76-82`: `if (tile === Tile.CASTLE) { arms[dir] = step; capped[dir] = true; washCastle(...); break; }`.

**Power-ups pre-rolled at map gen** — `map.ts:120` `rollCastleContents(cells, castleContents, width, height, rng);`, second deterministic pass over the same stream; `sim/powerups.ts:18` `revealPowerup` only decodes what was already there (`// The contents were fixed at map generation, so nothing random happens here.`).

**Revenge ducks — do soaked players actually ride the border?** For humans, **yes**: `match.ts:257-258` `// Soaked critters still steer their revenge duck; truly dead slots do not.` / `if (player === undefined || (!player.alive && !player.ghost)) return;`, and `sim/ducks.ts:85-93` moves `ghostPos` and fires `fireLob`. For **bots, no** — see Finding 2.

**Rising tide** — `map.ts:149` `buildTideSchedule` spirals inward with an absolute tick per tile and the `<=` fix (`map.ts:157` `// '<=' matters: the final ring can collapse to a single row or column`); `sim/tide.ts:36` floods, dissolves castles, and `pushOutOfWater` nudges critters clear. `TIDE_START_TICKS: 120 * 30` and `TIDE_RING_TICKS: 45` (config.ts:132-136) match "2:00" / "~1.5s".

**Elo** — `shared/elo.ts:83` `const divisor = n === 2 ? 1 : n - 1;` → exactly K/3 for 4p; `kFactor` at `elo.ts:33` returns 64 below 10 games, else 32. `symmetricRound` (`elo.ts:38`) makes a duel exactly zero-sum.

**Matchmaker widening** — `matchmaker.ts:202-205`: `CONFIG.MM_RANGE_START + steps * CONFIG.MM_RANGE_WIDEN` capped at `MM_RANGE_MAX`, i.e. ±100 → +50/10s → ±400, and mutual compatibility uses `Math.min` of the two ranges (`matchmaker.ts:208`).

**15s grace / ranked forfeit / casual bot conversion** — `gameLoop.ts:119-130` (`if (nowMs - occupant.disconnectedAt < CONFIG.RECONNECT_GRACE_MS) continue;` then `occupant.disconnectedAt = null;` so it fires once) → `handlers.ts:424-429` `if (room.ranked) { match.forfeit(slot); ... } match.substituteBot(slot, 'medium');`.

**Rematch majority** — `handlers.ts:374` `const needed = Math.floor(humans.length / 2) + 1;`, gated to `room.phase === 'results'`.

**Room GC does not kill live matches** — `rooms.ts:162` `if (room.match !== null && !room.match.finished) continue;`.

**Settings genuinely read by render code** (the usual dead-toggle trap — not here): `render/palette.ts:59` `return getSettings().colorblindSplash ? CONFIG.SPLASH_COLORS_CB : CONFIG.SPLASH_COLORS;` consumed by `particles.ts:75` and `world.ts:190`; `render/hud.ts:399` `return getSettings().reducedShake;` gating `offsetX`/`offsetY`; keybinds read in `gameInput.ts:94` `const action = actionForCode(ev.code);` — and `DEFAULT_KEYBINDS.drop = ['Space','KeyE']` matches `ev.code`, so the "bound Space, read ' '" bug from a prior entry is absent.

**Tutorial** is a real match, not a mock: `screens/tutorial.ts:6` `// This is not a scripted mock-up: it opens a real private room against a real bot`, and every step advances off real sim events (`handleEvent`, `tutorial.ts:238-260`), including `case 'chain_burst':`.

Deductions (all minor and mostly documented):
- Bots never lob revenge ducks (Finding 2).
- Tutorial seats a **Medium** bot, not Easy: `create_room` sends `botFill: true` and `net.ts:262` calls `room.fillWithBots()` whose default is `'medium'` (`room.ts:211`). It also uses the full 13×11 duel arena, not a "scripted small arena".
- Duel never gets showdown music: `game.ts:270` `if (config.players.length <= 2) return;` — deliberate and commented, but a literal deviation.
- Tide deviates from "flooded tiles soak anyone standing there": `splash.ts:251-253` spares `strongestRound(tideVictims)` when water would take every survivor at once. Documented at length; still a rule change.
- `round_start` omits `mapSeed`, which the spec's protocol listing includes — a *deliberate and correct* trade against the same spec's "unguessable, unhackable" clause (`protocol.ts:372-377`).

## 2. SECURITY & ANTI-CHEAT — **SCORE 8/10**

**Seed secrecy — the probe.** Opus 5 is the only entry that omits the seed: `protocol.ts:378` carries `castleGrid: number[]` with no seed field, `snapshot.ts:113` `// Only 'cells' ever crosses the wire. 'castleContents' stays on the server`, and `match.ts:144` `currentMapSeed()` is explicitly server-only. There is a regression test locking it: `e2e.test.ts:237` `expect(Object.keys(round)).not.toContain('mapSeed');`. Snapshots carry only `powerups` already revealed (`snapshot.ts:74`), and the client keeps `castleContents: new Uint8Array(cells.length)` zeros (`prediction.ts:95`).

**But the seed is still recoverable — I proved it.** `generateMap` rolls the castle layout and the hidden contents from **one continuous stream** (`map.ts:116` `if (rng.next() < CONFIG.CASTLE_DENSITY) cells[i] = Tile.CASTLE;` then `map.ts:120` `rollCastleContents(..., rng)`), and the seed space is only 32 bits (`rng.ts:59` `return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;`, `rng.ts:27` `let s = seed >>> 0;`). Using **only the transmitted `castleGrid`**, my probe against the real shipped `generateMap` recovered the exact seed and every hidden power-up:

```
secret=3085674943 recovered=3085674943 in 183.2s
hidden power-up contents match the server exactly: true | power-ups revealed: 18
```

183 s single-threaded, ~25 s across 8 workers — inside a single round's `ROUND_MAX_TICKS: 300 * 30`. Real, but *far* better than the 7 entries that shipped the seed in plaintext.

**One-packet crash — clean.** `hello`'s validator rejects a non-string token before it can reach a hash: `protocolGuards.ts:121` `if (body.token !== undefined && str(body.token) === null) return 'Token must be a string.';`. Prototype pollution is explicitly guarded: `protocolGuards.ts:236` `const known = Object.prototype.hasOwnProperty.call(VALIDATORS, body.t);` with the reasoning at `:112-118` (`'constructor' would wave an entirely unvalidated object through`). The ws listener is wrapped: `net.ts:123` `try { this.handleMessage(...) } catch (error) { ... }` with `net.ts:120` `// a throw escaping it is an uncaught exception and the whole server`. My live fuzz — 65 connections × 30 malformed payloads (non-string tokens, all 12 inherited Object keys, 9 kB frames, binary frames, `1e99` ints, a 400-message flood), both pre- and post-`hello`:

```
after 65 hostile connections: server /health = {"ok":true,"uptimeSec":13,"rooms":0,"clients":0}
error replies: 60  sockets closed by server: 64  crashed: no
/api/leaderboard?mode=' OR 1=1--  -> 400   /api/profile/' OR 1=1--  -> 404
```

Other positives: sha256 token hashing (`players.ts:96`); **100% parameterized SQL** — every statement in `db/queries.ts` is `db.prepare` with `?` placeholders, zero interpolation; rate limit `net.ts:183-203` with a violation kill at `MAX_RATE_VIOLATIONS`; `maxPayload: CONFIG.MAX_MSG_BYTES` on the WebSocketServer (`server.ts:178`); a guest-mint brake (`guestLimit.ts`) because "`hello` with no token creates a permanent account row"; server-side emote cooldown in the sim itself (`sim.ts:66`) on top of the socket limit; per-room tick isolation (`gameLoop.ts:95-100`).

Deductions: the seed brute-force above, plus no `process.on('uncaughtException')` anywhere and three unwrapped interval callbacks (Finding 5).

## 3. CORRECTNESS — **SCORE 8/10**

Genuinely hard to break. 103 tests, the soak, the fuzz and the build are all green; simultaneous-soak draws work (`sim.test.ts:155` and `splash.ts:260` soaking both victims, then `checkRoundEnd` → `endRound(state, [])`); balloon slots never leak (`releaseBalloonSlot` is called on cascade completion `splash.ts:140` *and* on tide dissolution `splash.ts:272`, and the soak watcher asserts `slot ${owner} balloon count went negative` never fires, `soak.ts:128`); the "input deleted one tick early" bug is absent — `consumeInputs()` runs *after* `simulateTick` (`match.ts:164-165`), so a balloon press is consumed before it is cleared; forfeit placement has a dedicated regression (`hostile.test.ts:135` `expect(results.map((r) => r.placement)).toEqual([2, 2]);`).

Defects found (details in Findings): the stale-input ghost turret, `ghostInput` being unreachable, and the unwrapped timers. One further minor: `stepEntity` reports `blockedY = Math.floor(p.y)` (`movement.ts:104`) while `columnSolid(solid, tx, y0, y1)` scans two rows, so when a critter's box straddles a lane the tile blamed for the block can be the wrong row — `tryKick` can then boot a *different*, adjacent balloon. Requires an off-centre 0.15–0.30 tile offset, so cosmetically rare.

## 4. NETCODE — **SCORE 9/10**

Real rewind-replay, not cosmetic. `prediction.ts:146-172`: the snapshot overwrites the local critter (`applySnap`), then `this.pending = this.pending.filter((input) => input.seq > msg.ack);` and `for (const input of this.pending) this.applyInput(local, input, false);` — with `live=false` so replayed inputs don't re-place balloons (`prediction.ts:290-296` `// the balloons those inputs asked for already exist as ghosts`). The ack is genuine server-side: `match.ts:292-293` `if (input.seq > acked) this.acks.set(slot, input.seq);` → `sendSnapshots` stamps it per-recipient (`match.ts:388`). Buffer is `INPUT_BUFFER_TICKS: 30` ≈ 1 s (`prediction.ts:199`).

Interpolation is at exactly `serverTime − 100ms`: `client/net.ts:159-161` `return estimatedServerTick() - CONFIG.INTERP_DELAY_MS / CONFIG.TICK_MS;`, consumed by `blendAt` which never extrapolates (`interpolate.ts:49` `clamp01(...)`), including short-way-round blending for the duck ring (`lerpRing`, `interpolate.ts:31`).

Rates are correct: sim 30 Hz (`gameLoop.ts:61` `setInterval(() => this.step(), CONFIG.TICK_MS)` with an accumulator and `MAX_CATCHUP_TICKS`), snapshots 15 Hz (`match.ts:103` `Math.max(1, Math.round(CONFIG.TICK_RATE / CONFIG.SNAPSHOT_RATE))` → every 2nd tick, `match.ts:168`), input sampled 60 Hz / sent 30 Hz (`gameInput.ts:146-158`, two separate accumulators). Fuses render from server ticks — `BalloonSnap.burstTick` is an absolute server tick (`protocol.ts:141`) and the client never runs its own fuse timer. `ARTIFICIAL_LATENCY_MS` is real (`net.ts:214`). Only nit: the client never runs the tide itself (`prediction.ts:64` `NO_SCHEDULE`), so flooding is event-driven and lands ~1 snapshot late.

## 5. CODE QUALITY — **SCORE 9/10**

`grep` for `: any` / `as any` / `<any>` / `any[]` across all of `packages/*/src`: **0 hits**. `@ts-ignore`/`@ts-expect-error`: **0**. `tsconfig.base.json` runs `strict`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `isolatedModules`; `tsc -b` exits 0. Shared sim purity holds — no `Math.random`/`Date.now` anywhere under `packages/shared/src/sim/` or `map.ts`; the only `Math.random` in shared is `randomSeed()` in `rng.ts`, which the sim never calls.

Architecture is genuinely orchestral: `simulateTick` (`sim.ts:109-136`) reads as a sentence — `updateSlides / refreshPassThrough / updateGhosts / updateLobs / processBursts / advanceTide / collectPowerups / resolveSoaks / checkRoundEnd`. Layering is respected: `match.ts:5` `// It never touches the database, Elo or XP — it plays the game out and hands back placements`, which is exactly why the soak can drive it headless. Comments consistently explain *why* (e.g. `config.ts:100` on `COLLISION_EPSILON` surviving three-decimal snapshot rounding).

Deductions: two import cycles, both harmless because the back-edge is type-only and erased (`room.ts:29` `import type { MatchRunner } from './match.js';`, `handlers.ts:19` `import type { Client, Hub } from './net.js';`) — no TDZ risk, but still avoidable; two unused exports (`hatDef`, `oppositeDir`); one genuinely dead function (Finding 2); and `packages/server/dist/` + `packages/client/dist-types/` are committed build artifacts sitting in the source tree.

## 6. TEST DEPTH — **SCORE 8/10**

The 103 tests assert the real things, not padding. Every acceptance criterion has a named test: `sim.test.ts:65` `'bursts a three-balloon chain in a single tick'`; `sim.test.ts:16` `'washes away the first sandcastle in a direction and stops there'`; `map.test.ts:13` `'produces an identical map and identical hidden contents for the same seed'`; `elo.test.ts:75` `'uses K/3 so a sweep matches a duel win'` and `:108` `'respects a player being provisional while the rest are not'`; `sim.test.ts:387` `'produces an identical world from identical seeds and inputs'`; `bots.test.ts:235` `'lets hard beat easy in a clear majority of decisive duels'` (`expect(hardWins / decisive).toBeGreaterThan(0.7)` over 12 seeds with alternating spawn corners). `hostile.test.ts` is a defect ledger where every case names the bug it locks down; `roomAuthority.test.ts` and `e2e.test.ts` run over **real sockets against the real server** on an ephemeral port, including ranked pairing → SQLite persistence → leaderboard.

Crucially, **the soak drives the production loop**, not a reimplementation: `soak.ts:206` `runner.tick(clockMs);` on a real `MatchRunner` with only the wall clock synthesized (`soak.ts:200` `// A synthetic clock: bots only read it to pace their decisions`). It passed live: `4 matches, 21 rounds, 56686 ticks in 909ms / soak passed`.

Deductions: the **bot** suite *does* reimplement the loop (`bots.test.ts:65-83`: `inputs.clear()` every tick and `for (const bot of bots) inputs.set(bot.slot, bot.update(...))` unconditionally), which is precisely why Findings 2 and 3 survived — and no test anywhere exercises revenge ducks (`runRound` hard-codes `revengeDucks: false`).

---

## TOP FINDINGS

1. **The map seed is not on the wire, but it is recoverable from the `castleGrid` that is** — `map.ts:116-120` rolls the layout and the hidden contents from one continuous `mulberry32` stream, and `rng.ts:59` seeds it with only 32 bits. My probe took the exact bytes `buildRoundStart` sends (`snapshot.ts:128` `castleGrid: Array.from(state.cells)`) and recovered the seed in **183 s single-threaded**, then regenerated all 18 hidden power-ups byte-identically. Fix: roll contents from an independent server-only seed.

2. **`ghostInput` is dead code — bots never ride revenge ducks or lob** — `match.ts:279` `if (player === undefined || !player.alive) continue;` means `bot.update` is never called for a soaked bot, so `bot.ts:330` `function ghostInput(...)` and its `balloonPressed: player.ghostCooldown === 0` are unreachable. Instrumented over a full FFA match: `bot.update calls while DEAD: 0`, and across 6 matches `any revenge_lob event fired at all: false count= 0`. In a bot-filled casual room the headline "keeps eliminated players engaged" feature is inert.

3. **A soaked bot's duck is driven by a stale input row, and can become an infinite lobbing turret** — `driveBots` stops writing but nothing erases the entry, and `consumeInputs` skips bots entirely (`match.ts:295` `if (this.bots.has(slot)) continue;`), so `input.balloonPressed = false` never runs for them. `updateGhosts` then reads that fossil (`ducks.ts:82-93`). Measured: `ticks a soaked bot ghost existed: 6145, of which a STALE input row was still present: 6145` — the duck paddles forever in whatever direction the bot last held. Reproduced the worst case: a bot soaked on a tick whose input had `balloonPressed:true` fired `revenge_lob events fired by the DEAD bot with no decision loop: 4` and counting.

4. **The bot test harness diverges from the production tick loop, which is why 2 and 3 survived 103 green tests** — `bots.test.ts:69` `inputs.clear();` wipes the input map every tick and `bots.test.ts:71` polls every bot unconditionally, so neither the stale-input fossil nor the dead-bot skip can ever manifest under test. The comment at `bots.test.ts:45` claims `// This is what the room loop does, minus the sockets.` — it isn't; `MatchRunner` deliberately persists inputs across ticks (`match.ts:263`).

5. **Three interval callbacks are unguarded, and there is no `uncaughtException` handler** — `gameLoop.ts:95` wraps per-room ticks (`// One sick room must never take the whole server down with it.`) but `pumpMatchmaker` (`gameLoop.ts:181`), `sweepRooms` (`:187`) and `hub.pingAll` (`:64`) are not, and `grep -rn "uncaughtException" packages/*/src` returns nothing. A single throw out of `matchmaker.tick` → `startRoom` → `slotPlayerInfo` → `lookup.getById` (a better-sqlite3 read, e.g. disk-full) exits the process with every live match on it — the exact failure mode the ws layer took pains to prevent.

---

## ONE-LINE VERDICT

The strongest entry in the benchmark by a clear margin — every spec mechanic is genuinely wired and server-authoritative, prediction/reconciliation and the Elo maths are real, typing and test discipline are exemplary, and it is the only build to keep the map seed off the wire (though a 32-bit seed shared with the transmitted castle grid still surrenders every hidden power-up in three minutes); the residual defects are a small, tightly-clustered set around soaked bots' revenge ducks that the bot suite's reimplemented tick loop was structurally unable to catch.
---

# STEELMAN PASS

# STEELMAN REVIEW — Splash Critters (Claude Opus 5)

**Verification performed:** read the spec; read all 8,096 lines of `shared`+`server` source and the client netcode/input/render entry points; ran `npm run typecheck` (clean), `npx vitest run` (**103/103 pass**), `npm run soak` (**4 matches / 20 rounds / 60,601 ticks, "soak passed"**), `npm run build:client` (clean, 118 KB); booted the real server in-process and fired **29 hostile packets + a binary frame + a 100 KB frame**; and instrumented a real 4-player `MatchRunner` to dump every key that ever crossed the wire.

---

## GENUINE STRENGTHS

**1. The seed leak is genuinely, provably absent — and it is absent by three independent mechanisms, not by accident.**
This is the benchmark's headline failure mode (7 of 8 prior entries). Here:
- `RoundStartMsg` has no `mapSeed` field at all, and the type carries the reason (`packages/shared/src/protocol.ts:370-382`).
- `buildRoundStart` serialises `state.cells` only; `castleContents` is structurally excluded (`packages/server/src/snapshot.ts:112-134`).
- The seed lives in a private field with a server-only accessor documented as never crossing the wire (`packages/server/src/match.ts:140-147`, `184`).
- A grep proves `castleContents` appears in exactly 12 places, all of them sim-internal; the client's copy is a zero-filled dummy (`packages/client/src/prediction.ts:93-96`).

I did not take this on trust. I ran a full 4p bot match and walked every broadcast object: **259 castle washes, 76 reveals, 0 power-ups revealed before their castle was washed, 0 keys matching `/seed|contents|hidden|secret|rng/`.** `round_start` carries exactly `t, roundNo, castleGrid, theme, startTick, countdownTicks, scores`. The 76/259 reveal rate (29.3%) matches `POWERUP_BLOCK_CHANCE: 0.30` — the roll happened server-side and stayed there. The e2e suite pins this as a regression with an exact key-set assertion (`packages/server/test/e2e.test.ts:232-241`).

**2. The one-packet crash class is closed at the correct layer, and I could not break it.**
The `ws` `'message'` listener body is wrapped in try/catch with a comment naming the exact failure mode (`packages/server/src/net.ts:119-130`). Ahead of it: binary/oversize frames are refused before parsing (`net.ts:57-65`), `ws` itself caps payloads (`server.ts:171`), and the validator table is looked up via `Object.prototype.hasOwnProperty.call` specifically so `{"t":"__proto__"}` / `{"t":"constructor"}` cannot resolve to an inherited member (`protocolGuards.ts:236-237`, rationale at `:110-117`).

Empirically, all 29 payloads — `{"t":"hello","token":12345}`, `token:{...}`, `token:[1,2,3]`, every inherited `Object.prototype` key, `__proto__` injection, `[]`, `null`, `{"t":123}`, `NaN` seq, a 5,000-char nickname, `size:9999`, `slot:99999`, `difficulty:"nightmare"`, path-traversal room codes — returned a typed `error` and nothing else. Prototype pollution check: `false`. `/health` after the barrage: `200 {"ok":true,...}`. **`CRASHED: false`.**

**3. Two whole test files exist solely to pin bugs that were actually found and fixed, with the defect described in prose.**
`packages/shared/test/regressions.test.ts` and `packages/server/test/hostile.test.ts` are not generic coverage — each case states what broke. The standout is `regressions.test.ts:82-98`: snapshots round positions to 3 decimals (`snapshot.ts:22-24`), which **swallowed the collision guard band**, so a client rebuilding a wall-flush critter from the wire placed its leading edge exactly on the tile boundary and predicted straight through the wall. The fix is a named constant (`CONFIG.COLLISION_EPSILON`, `config.ts:99-106`) and the test sweeps every wall position 4→12 in two axes. This is a class of desync bug most implementations never even discover, let alone name and regression-test.

**4. The soak harness drives the real production tick loop — this is the exact divergence trap the brief flags, and it is avoided.**
`soak.ts:196-207` constructs a real `MatchRunner` and calls `runner.tick(clockMs)` — the identical method `GameLoop.advanceRoom` calls in production (`gameLoop.ts:112`). It does not reimplement anything. Better: the `Watcher` observes **the broadcast stream, not private `GameState`** (`soak.ts:66-72`), so any invariant it checks is an invariant on the wire. It independently ledgers balloon placed/burst pairs and fails on double-place, burst-without-place, or negative counts (`soak.ts:88-120`). It has both a tick budget *and* a wall-clock backstop for the "ticks keep returning but get slower" case (`soak.ts:48`). And when a scenario fails it prints the map seeds — precisely because they aren't on the wire (`soak.ts:178-180`).

**5. Bot escape verification goes well past the spec's letter.**
The spec asks for "confirming a reachable safe tile." `verifyBomb` (`bots/escape.ts:96-165`) simulates the hypothetical splash *plus every chain it would set off* (`computeDangerMapWith`), then requires a tile reachable **before the fuse expires**, safe to *linger* on until splash+margin clears, and — if an enemy is within 6 tiles — **two escape routes with different first steps**, because a rival can cork a single corridor while the fuse burns (`escape.ts:29-36`, `:62-79`, `:155-164`). The danger map keeps `floodTick` in a *private* array rather than folding tide into the splash interval, with the comment explaining that folding them "would make every threatened tile look doomed forever — which is how a bot talks itself into standing still and drowning" (`bots/dangerMap.ts:105-110`). Tests confirm hard bots never self-soak except when genuinely walled in (`bots.test.ts:190-215`).

**6. Integration seams that killed prior entries are clean, and I checked each named one.**
- Keybind: default is `'Space'` (`settings.ts:38`) and the reader uses `ev.code` (`gameInput.ts:80,111`) — matched, plus `preventDefault` on scroll keys and a `blur` handler so alt-tab doesn't leave the critter sprinting (`gameInput.ts:126`).
- All **17** C→S message types in `protocol.ts` are actually sent by client code.
- Input lifetime: `consumeInputs` runs *after* `simulateTick`, clears only `balloonPressed` (one press = one balloon), and zeroes `dir` only after a full `INPUT_BUFFER_TICKS` of silence (`match.ts:281-296`) — no one-tick-early deletion.
- Ranked matchmaking genuinely starts: e2e boots a real server, real `ws` clients, and asserts pairing + persisted ratings + leaderboard (`e2e.test.ts:327,366`; both pass, 1.8s/0.7s).
- Client receives the real map: `castleGrid` length is asserted against `width*height` and asserted to contain castles (`e2e.test.ts:224-228`).

**7. Defensive engineering most implementations skip entirely.**
Guest-account minting is rate-limited because `hello` with no token writes a permanent row and the guest namespace is finite (`guestLimit.ts:1-13`); a *refused* mint records nothing so a flooder can't extend their own penalty (`:44-55`). Rate-limit warnings are emitted once per window, not once per message (`net.ts:186-189`). A second tab evicts the first *without* firing the room's disconnect grace, because `playerId` is nulled before `close()` (`net.ts:104-112` + `:150-153`). Room membership is re-derived from the seat, not the index, so a player whose seat was reassigned "speaks for nobody" (`handlers.ts:398-408`, regression-tested at `roomAuthority.test.ts:84`). Shutdown has a politeness deadline and `closeAllConnections()` so a keep-alive can't hold a deploy hostage (`server.ts:120-138`). `unref()` on every stray timer.

**8. Elo is generalised and exactly zero-sum.**
`computeEloDeltas` handles any n (2 → classic, n>2 → pairwise at `K/(n-1)`, which is `K/3` for 4p) from one code path, with all expectations computed from **pre-match** ratings so ordering cannot affect the result (`shared/elo.ts:78-100`). `symmetricRound` rounds half-away-from-zero specifically so a duel's two deltas cancel exactly (`elo.ts:37-40`) — 15 fixture tests including "uses K/3 so a sweep matches a duel win."

**9. The README declines to over-claim.** It states outright that "The Dockerfile has not been built on this machine (no Docker daemon available here)" and names exactly what *was* verified. Given the brief's "any TODO/README self-claims must be VERIFIED, never trusted," a document that pre-emptively marks its own unverified claim deserves credit rather than suspicion.

---

## LIKELY-UNFAIR CRITICISMS TO PRE-EMPT

**"`round_start` is missing `mapSeed` — the spec's protocol section explicitly lists it. Spec violation."**
This is the single most likely finding and it is backwards. §4 of the same spec says contents are "**never sent to clients until revealed (unguessable, unhackable)**," and §8 says the server "never trusts a client." Because `map.ts` rolls contents from *the same PRNG stream* in a second pass (`map.ts:124-137`), and the generator is bundled into the client via `@splash/shared`, shipping the seed hands a modified client every power-up on the map. The two spec clauses are in direct conflict; Opus 5 chose the security clause, documented the choice in three places, and pinned it with a test. 7 of 8 prior entries chose the other way and *shipped the leak*. Penalising the only entry that resolved the conflict correctly would invert the grading.

**"No `process.on('uncaughtException')` — vulnerable to the one-packet crash."**
Empirically false for the actual attack surface. The guard is at the right layer (`net.ts:119-130`), not the wrong one; a global `uncaughtException` handler that swallows errors and keeps a corrupted process alive is arguably worse practice. 29 malformed payloads, a binary frame and an oversized frame all produced clean typed errors with the server still serving. (There *is* a narrower latent gap here — see W2 — but it is not the packet-crash class.)

**"The soak is a parallel implementation that could mask a production bug."**
`soak.ts:196` → `new MatchRunner(...)`; `soak.ts:206` → `runner.tick(clockMs)`. Same class, same method, same sink interface as production. The only substitutions are a no-op socket sink and a synthetic clock (documented at `soak.ts:203-204`, and deliberately advanced at exactly `TICK_MS` so the run is honest at any wall-clock speed). Coverage of the *outer* `GameLoop` timers comes from the e2e suite, which boots the real `startServer()` with real `ws` clients (`harness.ts:264-273`).

**"Bots share a `WeakMap` danger cache — cross-match contamination / determinism risk."**
`bot.ts:88-97` keys the cache on the `GameState` object itself and re-checks `state.tick`, so a cloned state gets its own entry. Bots are server-only and never enter ranked (`matchmaker.ts:159-161`). `bots.test.ts:217` asserts a round replays identically from the same seed.

**"`GET /api/profile/:id` is orphaned — no client screen fetches it."**
It is an explicit §5 spec requirement and is e2e-tested (`e2e.test.ts:481`). The client gets profile data over the socket (`welcome` / `profile_update`, `net.ts:105-110`), which is the correct design for a live session. A REST endpoint the spec asks for is not dead code.

**"Client `blankState` fills `castleContents` with zeros — the prediction will diverge on power-ups."**
It cannot. The client never runs `simulateTick`; it runs only `advancePlayer` with `placeBalloons: false` (`prediction.ts:265-272`), so `processBursts`/`revealPowerup` never execute client-side. Power-ups arrive as authoritative events and snapshots. The zero-fill is stated as deliberate at `prediction.ts:93-95`.

**"The rate limiter counts frames before authentication, so a pre-auth flood is billed."**
That's the correct ordering. `allow()` runs first (`net.ts:132`) precisely so an unauthenticated socket cannot make the server do parsing work for free; the flood test proves it escalates to a `4029` close (`e2e.test.ts:310`).

**"`dist-types/` directories are checked in."**
They are build artifacts and are gitignored (`.gitignore:3`).

**"The `hostile.test.ts` comments claim these were real bugs — unverifiable self-promotion."**
The prose is indeed unverifiable, but the *tests* are real, independent invariants that pass (12 inherited-key rejections; the forfeit-placement case at `hostile.test.ts:126-141` proves two quitters can't both be placed first). Judge the assertions, not the narration.

---

## REAL WEAKNESSES I CANNOT DEFEND

**W1 — The guest-mint limiter keys on the raw socket address with no `X-Forwarded-For` handling.** `server.ts:180` passes `request.socket.remoteAddress` straight through, and no `trust proxy` / XFF parsing exists anywhere in the server. The spec (§1) and the README both require deployment **behind a reverse proxy** (Railway/Fly/Render). Behind one, every player presents the proxy's address, so `GUEST_MINTS_PER_ADDRESS = 60` per hour becomes a **server-wide cap of 60 new accounts per hour**; the 61st new visitor gets `rate_limited: "Too many new critters from here."` This is a genuine production defect. Mitigating context: it is self-inflicted by a *beyond-spec* defense most entries omit entirely, it fails closed with a clear message rather than crashing, and returning players with a token are explicitly exempt (`handlers.ts:96-99`). It is one line of XFF parsing from correct — but it is wrong as shipped.

**W2 — Three of the four `GameLoop` timers run without a try/catch, and there is no global handler behind them.** `advanceRooms` is properly guarded per-room (`gameLoop.ts:93-100`, "One sick room must never take the whole server down"), but `pumpMatchmaker`, `sweepRooms` and `pingAll` (`gameLoop.ts:62-64`) are not, and `index.ts` installs only SIGINT/SIGTERM handlers. A throw in any of them is an uncaught exception that kills every live match. I probed for a reachable path from hostile input and did not find one — the matchmaker only touches validated queue entries and guarded DB reads — so I rate this **latent, not exploitable**. But it is an asymmetry the author clearly recognised elsewhere and did not apply here.

**W3 — Deliberate deviation from a literal spec line on tide draws.** §4 says "Last two players soaked on the same tick = draw round." `resolveSoaks` (`splash.ts:251-258`) spares the strongest survivor when *only* the tide would take everyone at once. The splash-mutual-KO draw the spec is really about is preserved and tested (`sim.test.ts:155`), the deviation is documented in three places, and the README justifies it with measurement ("17 of 17 free-for-all draws were exactly that pile-up, and only 7 of 20 bot free-for-all rounds reached a decision"). I'd call this a good product call, but it *is* a deviation, and an auditor flagging it is not wrong to notice it — only wrong to call it a bug.

**W4 — `ARTIFICIAL_LATENCY_MS` delays outbound messages only** (`net.ts:214-216`). The acceptance criterion is "with a 150ms artificial-latency flag, local movement feels instant and remote players don't rubber-band." Snapshot-side lag (which stresses interpolation and reconciliation) *is* simulated; input-side lag is not, so the server acts on inputs sooner than a real 150ms RTT would and observed correction error is smaller than reality. The README is honest about the semantics ("delays outbound messages"), but the flag exercises half the loop.

**W5 — Room codes come from `Math.random`** (`rooms.ts:23`), not `crypto`. 32⁶ ≈ 1.07×10⁹ with a 60 msg/s rate limit makes brute-forcing a private casual room impractical in practice, and the payoff is joining someone's water-balloon game. Low severity, but `randomUUID` is already imported elsewhere in the codebase, so this is a free fix that wasn't taken.

**W6 — Client `send()` silently drops messages when the socket isn't OPEN** (`client/src/net.ts:76-79`). There is no outbound queue, so a click landing during a reconnect window is lost with no feedback. The reconnect path re-sends `hello` and `resume()` restores room state, so the blast radius is a dropped UI action, not a broken session — but it's a real papercut.

**W7 — The Dockerfile is unbuilt and unverified.** The README says so plainly, which is to its credit, but the §13 criterion "Dockerfile deploys with SQLite persisting on a volume" remains unproven. The file itself reads correctly (multi-stage, Debian-slim for the `better-sqlite3` prebuilt, `npm prune --omit=dev` after build, `VOLUME /data`, non-root `USER node`, `/health` HEALTHCHECK).

---

## ONE-LINE ASSESSMENT

The two failure modes this benchmark exists to catch — the map-seed/power-up leak and the single-malformed-packet kill — are not merely absent but *deliberately engineered against, documented, and regression-tested*, and I verified both empirically rather than on trust; the genuine defects that remain (a proxy-blind IP limiter, three unguarded timers, an outbound-only latency flag) are ordinary production papercuts on top of the most disciplined codebase in the comparison, not structural failures.