<!-- Full audit report for kimi-k3, produced by an independent Claude Fable 5 subagent, 2026-07-17. -->

All evidence is gathered. Here is the audit report.

---

# AUDIT: kimi-k3 — Splash Critters submission

Repo: `/Users/jackychou/splash-critters-llm-comparison/results/kimi-k3` · 18/18 unit tests pass, `npm run typecheck` clean, 0 uses of `any` in source.

---

## 1. SPEC FIDELITY — SCORE 8/10

Nearly every spec system is genuinely implemented, not stubbed:

- **Balloon kick**: `tryKick` sets `b.slideDir = p.dir` on boots contact (`packages/shared/src/sim.ts:258-273`), slide preserves fuse (`moveBalloons`, sim.ts:321-346), and the bot danger map projects the kicked balloon's rest tile (`packages/server/src/bots/dangerMap.ts:61-75`, `slideRestTile` at :9-26). Unit-tested (sim.test.ts:188-208 asserts `b.burstTick` unchanged after slide).
- **Revenge ducks**: full ring-rider implementation — `nearestRingPos`/`ringPosToTile`/`duckLob` (sim.ts:384-448), duck movement + lob on inputs (sim.ts:671-680), casual-ON/ranked-OFF via `REVENGE_DUCKS_RANKED: false` (config.ts:40-41, wired at rooms.ts:238).
- **Rising tide**: `applyTide` floods ring-by-ring, washes castles, bursts balloons, soaks players (sim.ts:562-592); starts at 2:00 (`TIDE_START_TICKS: 30 * 120`, config.ts:37). It even accelerates after draws (sim.ts:556-560) — a non-spec addition that matters below.
- **Chain bursts in one tick via BFS**: `burstBalloons` uses an explicit queue with `seen` set, chained balloons use their own `range`, `chain_burst` events carry depth (sim.ts:450-500). Test asserts 3 balloons burst, 2 chain events, all in tick 0 (sim.test.ts:60-87).
- **Power-ups pre-rolled at map gen**: `generateMap` rolls contents with the seeded PRNG the moment a castle is placed — `const content = rollPowerUp(r); if (content) castleContents.set(idx, content)` (map.ts:70-74); weights match spec exactly (config.ts:29-35). Determinism tested (sim.test.ts:211-218). **But see §2 — the "unguessable" half of this requirement is defeated.**
- **Pairwise FFA Elo, K′=K/3, K 64→32**: `kFactor(a.games) / (n - 1)` (elo.ts:38-39) with `NEW_GAMES: 10, K_NEW: 64, K_NORMAL: 32` (config.ts:60-65); fixtures verify +32/+10.67/−10.67/−32 and tie-splitting (elo.test.ts:28-58).
- **Matchmaker widening**: ±100 base, +50 per 10s, cap 400 (matchmaker.ts:12-15, config.ts:52-58); live `queue_status` with searchRange (matchmaker.ts:76-88). ETA is a crude formula, not measured.
- **15s grace / forfeit / bot conversion**: implemented (rooms.ts:623-633, `RECONNECT_GRACE_MS: 15000`) — but the ranked forfeit path is functionally broken (§3, finding 2).
- **Rematch majority** (rooms.ts:759-773), **room GC** 10-min idle (rooms.ts:701-708, gameLoop.ts:43), **profanity filter** (10-word substring list, db/index.ts:81-86 — weak but present), **XP/unlocks/levels** (db/index.ts:111-142, curve `100 + 25n` config.ts:82-84), **settings** with remap/colorblind/shake/mute (screens/settings.ts:29-71), **emote rate limiting** server-side 1.5s cooldown (net.ts:185-187), **tutorial** with 5 scripted steps granting +50 XP (tutorial.ts:10-16, net.ts:209-217).

Gaps: results screen omits the spec'd "Longest Survivor" and "Biggest Chain" fun stats — the sim tracks both (`longestAliveTicks`, `biggestChain`, types.ts:47,138) but they are never serialized or displayed anywhere (results.ts:50-55 only shows Most Soaks + Castle Crusher). The tutorial's opponent is a random-walk dummy (`Math.floor(Math.random() * 5)` — tutorial.ts:146), not an "Easy bot", on a full-size arena rather than a "scripted small arena." Ranked duels can end in a draw, which §5 of the spec explicitly forbids (see §3).

**Art**: in-game art is genuinely procedural — every animal is a 12×12 pixel-string sprite with 2 walk frames, ear/face variants, hats, balloon/duck/power-up sprites (sprites.ts:5-176) drawn via per-pixel `fillRect` (sprites.ts:73-85), plus hand-drawn boulders/castles/water shimmer/wobble-inflate balloons in world.ts:37-143. Emoji shortcuts are confined to chrome: the title screen's `'🐸 🦆 🐧 🦦'` marquee (title.ts:14), kill-feed `🌊`/`💦` prefixes (game.ts:266-270), result medals `🥇🥈🥉` (results.ts:27), and a `🔍` on the queue screen (queue.ts:46). `fillText` is used only for countdown numbers, emote-bubble letters, and "CONNECTING..." — not for game art.

---

## 2. SECURITY & ANTI-CHEAT — SCORE 6/10

**(a) mapSeed leak — CONFIRMED CHEATABLE.** The server sends the real room seed to every client on every round: `this.sendAll({ t: 'round_start', ..., mapSeed: this.mapSeed, ...})` (rooms.ts:275-281; again at gameLoop.ts:28-34 for rounds ≥2 and rooms.ts:688 on reattach). `generateMap` derives the hidden `castleContents` from that same single `mulberry32(seed)` stream (map.ts:45, :70-74), and later rounds re-seed deterministically from it: `const seed = (state.options.mapSeed + state.roundNo * 7919) >>> 0` (sim.ts:637). The client bundle already ships `generateMap` — `prediction.ts:28-38` calls `createGame({... mapSeed ...})`, which computes the full contents map before the honest code discards it (`this.state.castleContents = new Map()`, prediction.ts:37). A one-line console cheat (`generateMap(13,11,'duel',2,seed)`) reveals every hidden power-up including Rubber Boots for the whole match, violating the spec's explicit "contents are never sent to clients until revealed (unguessable, unhackable)" (prompt.md:89). The spec does mandate `round_start{mapSeed}` in the protocol, so the correct design was a separate secret server-side seed for contents; kimi-k3 did not do that.

**(b) Input validation**: dir range-checked (`if (dir < 0 || dir > 4) return`, net.ts:180), room options fully sanitized (net.ts:224-240), nickname regex + uniqueness + tag (db/index.ts:88-101), cosmetics checked against unlocks (net.ts:195-207), emote id bounds (net.ts:188). Positions are never accepted from clients — movement/drops are simulated server-side only. Weak spot: field types are not schema-validated; e.g. `msg.nickname.trim()` on a missing field throws and is swallowed by the per-message `try/catch` (net.ts:49-53) — safe but sloppy.

**(c) Rate limiting**: 60 msgs/sec sliding window + 4 KB message cap (net.ts:36-41), emote cooldown (net.ts:185-187). One room per player enforced (net.ts:147, rooms.ts:607-610).

**(d) Token hashing**: SHA-256 of a `randomUUID()` token, only the hash stored (db/index.ts:27-29, :59-66), indexed lookup (migrations.ts:16). Unsalted, but the token is 122 bits of randomness, not a password — acceptable.

**(e) SQL safety**: every statement in db/index.ts uses `?` parameterized prepared statements; no string interpolation of user data found.

**(f) Unhandled exceptions**: `JSON.parse` guarded (net.ts:44-47), handler wrapped (net.ts:49-53), express handlers are simple sync reads. No process-level crash vector found in message handling.

---

## 3. CORRECTNESS BUGS — SCORE 5/10

**Finding 1 — ROOT CAUSE of the ranked e2e failure: (c) the duel genuinely ends in a DRAW, which the payload then reports as tied-1st with zero deltas.**
- The sim allows a whole ranked match to draw: on a round where the last players are soaked the same tick, `drawStreak++` (sim.ts:609-610), and `if (state.drawStreak > 3) { state.matchWinner = -1; ... state.events.push({ type: 'match_end', winnerSlot: -1 }); return; }` (sim.ts:614-618). Four consecutive drawn rounds end the match with no winner — directly violating spec §5 "no draws possible at first-to-3" (prompt.md:109).
- `finishMatch` then ranks both players `roundWins 0, soaks 0` → the tie test `cur.p!.roundWins === prev.p!.roundWins && cur.p!.soaks === prev.p!.soaks` (rooms.ts:376-379) keeps `currentPlacement = 1` for both, so **no placement-2 entry exists**, and the duel branch takes the explicit tie path: `if (a!.placement === b!.placement) { ... ratingDeltas[a!.playerId] = 0; ratingDeltas[b!.playerId] = 0; }` (rooms.ts:411-415) — `db.applyRatingChange` (rooms.ts:425-426) is never called. That exactly reproduces the symptom: `deltas[winner.playerId]` = 0, `placements.find(p => p.placement === 2)` = undefined, crash at e2e.mjs:239 (`deltas[loser.playerId]`).
- Why the e2e's duel drew: client D sends zero inputs (idles at spawn), and client C's "chaser" only dodges the tide and never drops balloons (`C.send({ t: 'input', seq: ++seq, dir, balloon: false })`, e2e.mjs:229). Both spawn pockets consist entirely of ring-depth-1 tiles ((1,1),(2,1),(3,1),(1,2),(1,3) — spawn-clear is Manhattan ≤ 2, map.ts:57-62), and with 75% castle density (config.ts:11) the chaser is frequently walled in at depth 1. `applyTide` then soaks BOTH players in the same call when `tideRing` reaches 2 (sim.ts:587-591) → `alive.length === 0` → draw (sim.ts:596-604). Each draw accelerates the next round's tide by 30s (`start = max(15s, TIDE_START_TICKS − drawStreak·30s)`, sim.ts:556-560), compounding until `drawStreak > 3`. So the answer is squarely **(c)** — deltas are computed and keyed correctly in the win case (verified: keyed by `playerId`, rooms.ts:423-424, matching e2e's lookup); they were simply never earned because the match legitimately drew. Side effect: since `games` is only incremented inside `applyRatingChange` (db/index.ts:163-173), a drawn ranked duel leaves both players at `games = 0` and thus invisible on the leaderboard (`WHERE r.games > 0`, db/index.ts:209) — the e2e's leaderboard assertions would fail too. Note the FFA branch is inconsistent: it applies zero-delta changes on ties (rooms.ts:434-441), duel doesn't.

**Finding 2 — Ranked disconnect forfeit hangs the match forever (systemic event-wipe bug).** `forfeit()` pushes `{ type: 'match_end', ... }` onto `state.events` from a `setTimeout` callback between ticks (rooms.ts:624-633 → :499). But `simulateTick` begins with `state.events = []` (sim.ts:652) and, since forfeit already set `state.phase = 'matchEnd'` (rooms.ts:498), takes the early return (sim.ts:663-666). `room.handleEvents(state.events)` (gameLoop.ts:36) therefore sees an empty array — `finishMatch` never runs, `room.phase` stays `'playing'` forever, the surviving player never receives `match_end`, no rating is credited, and the room never ends. The spec's "forfeit loss (opponents credited a win)" is dead code in practice. Same bug class hits emotes: `setEmote` pushes an `'emote'` event between ticks (rooms.ts:756, sim.ts:648) that is always wiped, so `audio.emote` (game.ts:293-294) never fires (only the snapshot-carried bubble renders).

**Finding 3 — The default SPACE key cannot drop balloons.** The default binding is the string `'Space'` (settings.ts:22), but key state stores raw `e.key` (`this.keys.add(k)`, game.ts:174), which for spacebar is `' '`. `this.keys.has(settings.keys.balloon)` (game.ts:200) is therefore never true; same in the tutorial (tutorial.ts:109, :132) which literally instructs "Drop a balloon (SPACE)" (tutorial.ts:12). Only the hardcoded `e`/`E` fallback works. Remapping can't fix it either — the remap UI normalizes `' '` back to `'Space'` (screens/settings.ts:63).

**Finding 4 — `leave_room` during a live match bypasses forfeit/bot-conversion entirely.** `leaveRoom` in the playing phase just sets `slot.connected = false; slot.client = null; return;` (rooms.ts:597-600) — no disconnect timer is started (that only happens in `onDisconnect`, rooms.ts:623-633). A ranked player who sends `leave_room` (the results/lobby screens do send it) is never forfeited; the opponent must grind out tide-wins against an AFK ghost, and the leaver stays locked out of the queue (`matchmaker.join` rejects while `findRoomForPlayer` matches, matchmaker.ts:30).

**Minor**: prediction never resyncs `activeBalloons` from snapshots (`applySnapshot` restores 14 player fields but not that counter, prediction.ts:75-93), so a server-rejected predicted drop can permanently inflate it and make local drop-prediction go dead; HUD round pips hardcode 3 (`'○'.repeat(Math.max(0, 3 - ...))`, hud.ts:51) misrendering first-to-5 rooms.

---

## 4. NETCODE — SCORE 7/10

The zero grep hits for "reconcil" are misleading — **real rewind-replay reconciliation exists**, just unnamed. `PredictedGame.pushInput` applies each local input through the full shared `simulateTick` immediately (prediction.ts:45-52); on every snapshot, `applySnapshot` hard-resets state from the server, drops acked inputs using the server's echoed `lastInputSeq` (`this.inputBuffer = this.inputBuffer.filter((f) => f.seq > acked)`, prediction.ts:114-116), then **replays the unacked tail through `simulateTick`** (prediction.ts:117-121). The ack channel is genuine: the server stamps `lastInputSeq: this.lastAppliedSeq.get(p.slot)` into each snapshot player (rooms.ts:318). Buffer is 60 frames ≈ 2 s at the 30 Hz send rate (prediction.ts:12; inputs sampled and sent at 30 Hz via `setInterval(1000/TICK_RATE)`, game.ts:128 — spec asked 60 Hz sampling, a minor deviation). Remote entities interpolate between the last two snapshots at `now − 100ms` (`INTERP_DELAY_MS`, prediction.ts:125-137), applied only to non-local slots (game.ts:336). Rates match spec: 30 Hz sim, snapshots every 2nd tick = 15 Hz (gameLoop.ts:37, config.ts:2-3). Balloon fuses render from server tick estimates (`estimatedServerTick()` extrapolation, prediction.ts:139-143; world.ts:126-127). The artificial-latency flag is server-side and real (`ARTIFICIAL_LATENCY_MS` → delayed `pendingInputs`, index.ts:49, rooms.ts:285-291, :780-784). Weaknesses: server input handling is "latch last frame" — `room.inputs` is never cleared per tick (rooms.ts:289, gameLoop.ts:18-22), so a stale direction replays every tick until replaced (a disconnected player walks into a wall forever), and there is no per-tick input queue; interpolation extrapolates up to 1.5× the snapshot span (prediction.ts:135) which can overshoot on jitter.

---

## 5. CODE QUALITY — SCORE 8/10

- **Sim purity**: zero `Math.random`/`Date.now`/`performance.now` in `packages/shared/src` (grep-verified); all randomness enters via `mulberry32(seed)` (rng.ts:1-10). Bots use `Math.random` only server-side outside the sim (bot.ts:145, :302) — legitimate, since they emit inputs.
- **Typing**: TS strict, `tsc --noEmit` clean across all three packages, **zero `any`** in source; protocol is proper discriminated unions (protocol.ts:138-173); generics used well (`net.on<T extends ServerMessage['t']>`, client net.ts:20).
- **Layout matches the spec's folder structure exactly** — shared (config/types/rng/map/sim/protocol/elo), server (index/net/rooms/gameLoop/matchmaker/db/bots), client (main/net/prediction/audio/render×4/screens×13). Largest file is rooms.ts at 788 lines; everything else ≤ 727.
- Warts: bottom-of-file imports in four files (rooms.ts:511, world.ts:188, hud.ts:101, title.ts:18) that read like patched-in afterthoughts; match config passed via `sessionStorage` (game.ts:122-125, :378-384) instead of state; `void winnerSlot` / `void danger` dead-parameter suppressions (rooms.ts:476, bot.ts:387); the ratings-insert in `getRating` passes `CONFIG.ELO.START` for both rating and peak positionally (db/index.ts:152-157) — correct but fragile.

---

## 6. TEST DEPTH — SCORE 7/10

18 tests (11 sim + 7 elo), and they assert the spec's hard acceptance criteria, not fluff: 3-balloon chain bursts in ONE tick with correct `chain_burst` count (sim.test.ts:60-87), splash stops at first castle and is boulder-blocked (:90-125), soak→round-win→phase flow (:128-144), same-tick mutual soak = draw round (:146-159), pre-rolled reveal→collect stat application (:162-185), kick slide stops when blocked and keeps its fuse (:188-207), identical seed → identical map **including hidden contents** (:211-218), spawn-clear + border boulders across 4 seeds (:220-229), PRNG determinism, config-vs-spec sanity (fuse 90/splash 12). Elo fixtures cover the duel ±32/expected-score math, the K switch at exactly 10 games, the 4-player pairwise +32/+10.67/−10.67/−32 with zero-sum check, tie splitting, and all six tier boundaries (elo.test.ts). Beyond vitest there's a real soak script (full bot matches, asserts Hard ≥ 3/5 vs Easy and a winner exists — soak.ts:27-62). The e2e script — unique among rivals — covers the casual acceptance path end to end (create/browse/join/2 hard bots/match completion/XP/profile API, e2e.mjs:99-143) and drives ranked with a genuinely clever tide-dodging BFS chaser (e2e.mjs:201-230). Its ranked half is simultaneously its best and worst feature: by never attacking (`balloon: false`, e2e.mjs:229) it depends on tide-kills, which surfaced the real drawn-duel spec violation — but its own assertions assume draws are impossible, so it crashes instead of reporting. The big hole: **zero tests for the server layer** (rooms/matchmaker/forfeit/db), which is exactly where all four §3 defects live.

---

## TOP FINDINGS

1. **Ranked duels can genuinely draw, contra spec** — 4 consecutive drawn rounds trip `drawStreak > 3` → `match_end{winnerSlot: -1}` (sim.ts:614-618); `finishMatch` then emits tied placement-1 for both with `ratingDeltas = 0` and never calls `applyRatingChange` (rooms.ts:411-415), leaving `games = 0` so both players also vanish from the leaderboard filter (db/index.ts:209). This — not a keying or persistence bug — is what broke the shipped e2e's ranked section.
2. **Hidden power-ups are client-derivable (cheatable)** — the true `mapSeed` is broadcast every round (rooms.ts:277, gameLoop.ts:31, rooms.ts:688) and `generateMap` rolls the "hidden, unhackable" castle contents from that same seed stream (map.ts:45, 70-74), with next-round seeds derived predictably (sim.ts:637); the client bundle already contains the generator (prediction.ts:28-38).
3. **Ranked forfeit is dead code: matches hang forever after a disconnect** — the `match_end` event forfeit pushes between ticks (rooms.ts:499) is unconditionally wiped by `state.events = []` at the next `simulateTick` (sim.ts:652) before `handleEvents` ever reads it; no ratings, no `match_end` message, room stuck in `'playing'`. Systemic: every between-tick event push is silently lost (emote sounds too, rooms.ts:756).
4. **The advertised SPACE key never drops a balloon** — binding stored as `'Space'` (settings.ts:22) vs. raw `e.key === ' '` in the key set (game.ts:174, tutorial.ts:109); only the `E` fallback works, and the remap UI re-normalizes to the broken string (screens/settings.ts:63).
5. **`leave_room` mid-match bypasses forfeit/bot conversion** — playing-phase leave just flags `connected = false` with no grace timer (rooms.ts:597-600), stranding ranked opponents against a permanent AFK and locking the leaver out of the queue until the match grinds to an end.

## ONE-LINE VERDICT

A remarkably complete, well-typed, genuinely deterministic implementation with real prediction/reconciliation and honest pixel art, undermined by an untested server layer whose four real defects — drawable ranked duels, hung forfeits, a leaked power-up seed, and a dead Space key — sit squarely on the spec's competitive-integrity core.
