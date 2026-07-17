<!-- Full audit report for glm-5.2, produced by an independent Claude Fable 5 subagent, 2026-07-17. -->

I have thoroughly verified all findings. Writing the report.

# Audit Report: Splash Critters (glm-5.2)

Repo: `/Users/jackychou/splash-critters-llm-comparison/results/glm-5.2`. Tests run: `vitest` → 12/12 pass; `soak` script → **FAIL** (empirically reproduced). All findings below verified by reading source and, where noted, by running instrumented harnesses against the actual shared sim / bots.

---

## 1. SPEC FIDELITY — SCORE 4/10

Most systems exist as a skeleton, but several headline mechanics are missing or non-functional, and the client is never sent the authoritative map.

Implemented and working:
- Cross splash, first-castle-per-direction wash, boulder blocking, chain cascade resolved in ONE tick via a queue/BFS: `sim.ts:357-370` (verified: 3 balloons gone in one tick).
- Power-ups PRE-ROLLED at map gen in the same seeded PRNG stream: `map.ts:85-107`; deterministic per seed (`sim.test.ts:20-29` passes).
- Balloon kick (sliding): `sim.ts:108-117`, `sim.ts:260-274`.
- Rising Tide flood-inward: `sim.ts:278-310`. Matchmaker widening ±100→+50/10s→±400: `matchmaker.ts:42-45` matches CONFIG. Pairwise FFA Elo K'=K/(n-1), K=64 first 10 then 32: `elo.ts:32-53`, `config.ts:65-70`. Rematch majority vote: `net.ts:420-434`. Room GC: `net.ts:500-508`. XP/levels/unlocks: `queries.ts:52-71`.

Missing / stubbed / broken:
- **Revenge Ducks non-functional.** Soaked players are flagged `revenge=true` (`sim.ts:191-192`) but the border-duck movement + 3-tile lob never happens — the revenge branch only decrements a cooldown (`sim.ts:332-336`); `revenge_lob` is never emitted; `revengeX/revengeY` stay 0. Also the `ENABLE_REVENGE_DUCKS_*` flags (`config.ts:41-42`) are never read by the sim.
- **Emotes: pure stub** — `net.ts:148 case "emote": return;` (no broadcast, no per-emote rate limit).
- **Tutorial missing.** No `tutorial.ts` and no `"tutorial"` screen in the router (`screens/index.ts:8-10`); only a static "How to Play" text screen exists.
- **Reconnect grace / ranked forfeit / casual bot conversion all missing.** `RECONNECT_GRACE_MS` is imported in `rooms.ts:12` but never used; `onClose` just opens the slot with the comment "here we just open the slot for simplicity" (`net.ts:443-449`). A mid-match disconnect leaves an inert human player.
- **Match history never persisted** — see Correctness #5.
- Nickname uniqueness not enforced (`queries.ts:37-44` writes without a uniqueness/#tag check); castle-washed XP rate `XP.perCastle` defined (`config.ts:92`) but never awarded (`net.ts:346`).

---

## 2. SECURITY & ANTI-CHEAT — SCORE 5/10

(a) **CRITICAL PROBE — the flagship anti-cheat requirement is broken by design.** `protocol.ts:89` defines `round_start{ ..., mapSeed, castleGrid, ... }` and the client is wired to consume it (`game.ts:108 this.prediction.resetRound(m.mapSeed)`). `generateMap(seed)` rolls tiles AND hidden power-up contents in a single deterministic PRNG stream (`map.ts:81-107`), so any client given `mapSeed` can call `generateMap(seed, mode)` and reproduce every hidden power-up exactly — defeating the spec's "unguessable, unhackable" guarantee. It is only *not currently exploitable* because the server never actually sends `round_start` at all (`grep` shows the server only ever broadcasts `snapshot` — `net.ts:306`), which is itself a catastrophic functional bug (Correctness #2). Design-cheatable either way.

(b) **Position/state is genuinely server-authoritative (a real strength).** Clients send only `dir` + `balloonPressed`; movement distance is server-computed `p.speed/TICK_HZ` (`sim.ts:87,95`), balloon count is enforced `p.liveBalloons >= p.balloonCount` (`sim.ts:122`), one-per-tile enforced (`sim.ts:125`). No trust-the-client position path exists. `dir` is validated to [-1,3] (`net.ts:393`).

(c) **Rate limiting present** — sliding 1s window capped at 60 msgs/s (`net.ts:122-125`), silently drops excess. Real, though not a token bucket.

(d) **Device token hashed** — SHA-256 (`queries.ts:239-241`), stored as `token_hash` (never plaintext).

(e) **SQL uniformly parameterized** — every query uses `?` bind params (`queries.ts` throughout); no string interpolation.

Gaps: `seq`/`tick` unvalidated (a client sending `seq=Number.MAX_SAFE_INTEGER` permanently blocks its own future inputs via `sim.ts:326`); `set_slot` difficulty/kind not validated against the enum (`net.ts:260`) — a bad `difficulty` reaches `BOTS[difficulty]` → `cfg.decisionMs` throws inside the tick `setInterval` (`bot.ts:42-43`); `create_room` size not constrained to {2,4}.

---

## 3. CORRECTNESS BUGS — SCORE 2/10

1. **Collision phase-through — players walk through walls/castles/boulders (catastrophic).** `applyMovement` only checks `tileBlocked` when the player is grid-centered (`sim.ts:83-101`); the "not centered" branch (`sim.ts:84-92`) moves with **no tile check at all**. Because speed 4.0/30Hz = 0.1333 tiles/tick does not divide a tile evenly (7.5 ticks/tile), the player almost never re-centers, so the collision gate rarely engages. Verified: a player holding "right" from x=1 with a castle at x=3 ended at **x=9, straight through the castle** (tile still intact). This alone makes the game unplayable.

2. **Client is never sent the authoritative map → total render desync.** Server never emits `round_start` and `toSnapshot` carries no tile grid (`rooms.ts:246-269`). The client hardcodes prediction seed `1` (`game.ts:82 new Prediction(msg.mode, 1, ...)`) while the server uses `Rng.hashStr(room.code+":"+Date.now())` per match and `seed + roundNo*7919` per round (`net.ts:293`, `rooms.ts:149`). The rendered castles/boulders come from seed 1; the real sim uses a different seed. Reconcile only syncs players/balloons/splashes (`prediction.ts:66-85`), never tiles. Players see a completely wrong arena.

3. **~Half of all game events are dropped.** `simulateTick` clears `state.events=[]` every tick (`sim.ts:316`) but snapshots are sent only every 2 ticks (`rooms.ts:173`, 15Hz). Events generated on the odd (non-snapshot) tick are cleared before ever being serialized. Soaks, `castle_washed`, `chain_burst`, `powerup_revealed` occurring on odd ticks never reach the client (kill-feed, SFX, announcer all miss ~50% of events).

4. **Bot decision timer is never reset per round → bots freeze.** `bot.lastDecisionTick` persists across rounds but each new round resets `state.tick` to 0 (`rooms.ts:149`). The gate `state.tick - bot.lastDecisionTick >= decisionEvery` (`bot.ts:45`) is negative for the first ~N ticks of every round after the first (N = last round's length, growing each round), so bots hold a stale direction and stop dropping balloons. Instrumented the real soak logic: round 2 `lastDecTickBefore=[167,127,171,127]` with bots idle until tick passes those values.

5. **Match/round history persistence is dead code.** `recordMatchStart` and `recordMatchPlayer` are imported but only appear in the `void …` no-op list (`net.ts:512`) — never called. `recordMatchEnd(match.mode+":"+room.code)` (`net.ts:335`) updates a `matches` row that was never inserted (no-op). Result: `matches` and `match_players` tables stay empty; `GET /api/profile/:id` "recent matches" is always empty. (Ratings in `ratings` *are* persisted via `applyRating`.)

6. **`chain_burst.chainSize` is always 1 → DOUBLE/TRIPLE announcements never fire.** `explode` deletes only the current balloon, so `burst = chainStart - state.balloons.size` is always 1 (`sim.ts:363-368`); chained balloons are removed later when they're popped. Verified: a 3-balloon chain emits `[1,1,1]`. The client only announces combos when `chainSize>=2` (`game.ts:137`), which is unreachable. (`sim.test.ts:78` only asserts an event *exists*, so it misses this.)

7. **`soak` acceptance script fails.** Ran it: `no winner after 10 rounds (timeout)`, 7092 ticks. Rounds frequently end `alive=0` (simultaneous soaks = draw, awarding no round win — `sim.ts:386-390`), so across only 10 rounds no single player reaches 3 wins. Acceptance criterion "headless soak completes a full match with no crash" is not met as shipped.

---

## 4. NETCODE — SCORE 2/10

- **Local prediction is partially real** (rewind-replay): `prediction.reconcile` snaps players from the snapshot then replays unacked pending inputs through the shared sim (`prediction.ts:60-92`), keyed by `seq`/`tick`. This is the one genuinely implemented netcode piece.
- **Remote interpolation absent.** `INTERP_DELAY_MS` is imported then `void`-discarded (`game.ts:6,302`). Remotes are hard-snapped to the 15Hz snapshot every reconcile with zero interpolation → they will rubber-band. The spec's `serverTime − 100ms` remote interp is not implemented.
- **No clock sync.** Neither server nor client emits/handles `ping`/`pong` (`net.ts` never sends `ping`; client `net.ts`/`main.ts` have no handler). No ping display in HUD.
- **Snapshot event loss** (see Correctness #3) and **client never receives the map** (Correctness #2) mean the netcode does not deliver a playable synchronized game.
- Fuse rendering uses local predicted `state.tick`, not server fuse timestamps (`game.ts:254`).

Snapshot rate (15Hz) and tick rate (30Hz) constants are correct (`config.ts:4-7`).

---

## 5. CODE QUALITY — SCORE 5/10

- **Shared sim purity is good and verified:** zero `Math.random`/`Date.now` in `packages/shared/src` (grep clean); RNG is mulberry32 (`rng.ts`); determinism holds under tests. This is the strongest part of the codebase.
- **Structure deviates from spec.** No `server/src/gameLoop.ts` (loop is inline in `rooms.ts`), no `elo.ts` on the server (apply logic sits in `net.ts`). All ~13 client screens are crammed into one 400-line `screens/index.ts` instead of the spec's per-file `title.ts/tutorial.ts/menu.ts/...`; `tutorial.ts` doesn't exist.
- **Dead code / smell.** A large `void …` block hides unused imports and never-called functions (`net.ts:510-512`); `BOT_POWERUP_PREF` is exported "documents intent" but unused (`bot.ts:208-213`); `revengeX/revengeY`, `spawnedTick`, `pendingInputs` are carried but unused. `tileBlocked`'s balloon check is written as a bizarre quadruple `!==` (`sim.ts:53`).
- Typing is mostly disciplined; ~16 `any` occurrences, concentrated in client glue (`game.ts` net handlers, `main.ts`). `strict` is on but `noUncheckedIndexedAccess:false`.
- No file exceeds 512 lines; reasonably modular within its (flawed) layout.

---

## 6. TEST DEPTH — SCORE 5/10

- 12 assertions across 2 files, all passing, and several are meaningful: seed→identical tiles **and** identical hidden power-ups (`sim.test.ts:20-29`); 3-balloon chain gone in one tick (`sim.test.ts:63-80`); splash stops at first castle (`44-61`); boulder blocks propagation (`82-95`); last-opponent → round win (`99-113`); Elo K thresholds, duel equal-rating delta (=32/-32), FFA monotonic + zero-sum + tied-equal deltas (`elo.test.ts`).
- **Weaknesses:** the chain test asserts only that a `chain_burst` event *exists*, so it fails to catch the always-1 `chainSize` bug (Correctness #6). FFA Elo is checked for sign/monotonicity/conservation but no exact numeric fixture. No full-`simulateTick` run-twice determinism test, no test of movement/collision (the catastrophic bug), no simultaneous-soak/draw test, and the `soak` "test" actually fails when run. Tests validate the pure math well but miss the integration bugs that break the game.

---

## TOP FINDINGS

1. **Collision is fundamentally broken — players phase through walls, castles and boulders.** The `tileBlocked` check only runs on grid-centered ticks, but speed 4.0/30Hz never re-centers cleanly, so the no-collision branch runs continuously (`sim.ts:84-101`; verified a player walked straight through a castle to x=9). The game is unplayable.
2. **The client never receives the authoritative map.** Server never emits `round_start`/tiles (`net.ts:306` only sends `snapshot`), and the client seeds its predicted map with a hardcoded `1` (`game.ts:82`) vs the server's random per-match seed (`net.ts:293`) — the rendered arena is entirely desynced from the sim.
3. **Anti-cheat power-up secrecy is broken by design.** `round_start` is specced/wired to carry `mapSeed` (`protocol.ts:89`, `game.ts:108`), and `generateMap(seed)` deterministically rolls hidden power-up contents (`map.ts:81-107`) — any client with the seed can compute every pickup. Only "safe" because `round_start` is never actually sent (which is itself bug #2).
4. **Snapshotting drops ~half of all events**, and **match history is never persisted.** Events are cleared every tick but snapshotted every 2nd tick (`sim.ts:316`, `rooms.ts:173`); `recordMatchStart/Player` are dead code (`net.ts:512`) so `matches`/`match_players` stay empty and profiles show no history.
5. **Bots freeze after round 1 and the soak acceptance test fails.** `bot.lastDecisionTick` isn't reset when `state.tick` resets each round (`bot.ts:45`, `rooms.ts:149`); running `npm run soak` returns "no winner after 10 rounds." Server-authoritative position, hashed tokens, and parameterized SQL are the genuine bright spots.

## ONE-LINE VERDICT

A clean, deterministic shared sim with solid server-authoritative fundamentals, wrapped in a game that does not actually work online — broken tile collision, a client that never receives the real map, half its events dropped, dead match-persistence, and a failing soak test put it far from the "complete, shippable" bar.
