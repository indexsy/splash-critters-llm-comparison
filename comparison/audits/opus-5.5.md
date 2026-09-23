<!-- Audit of the Claude Opus 5.5 entry, 2026-09-23.
     CONFLICT OF INTEREST: this entry was built by Claude Opus 5.5 and the orchestrator judging it is ALSO
     Claude Opus 5.5. Per this repo's precedent for a self-authored entry (Fable 5), it was audited under the
     HARSHER adversarial framing (assume a hidden fatal bug; disprove the author's claims), and its fact-checker
     was given an extra GENEROSITY CHECK that no rival entry received. The orchestrator applied that check's
     conclusion ('8.50 looks slightly generous'): Correctness 7.5 -> 7 and Security 8.5 -> 8, for a published
     8.30 (#3) instead of the auditor's raw 8.50 (#1). Both numbers are published.
     BUILD CONDITIONS (from the build session transcript): it never read this comparison repo; it DID have memory
     notes from two earlier Claude builds of this spec (no rival lab had that); it was built over many
     multi-agent verification waves; its loot design was rediscovered in-session by its own subagent.
     The orchestrator independently reproduced: loot at chance (1.56 vs 1.48 control), all 19 malformed-frame
     classes survived with a positive control, tutorial Skip works, round 1 renders, and the mid-round
     reconnect race 6/6 (after first getting it wrong with a flawed harness; see logs/opus-5.5.log). -->

# Splash Critters audit: Opus 5.5 entry (adversarial, self-authored framing)

Everything below was run against the built server on :3917, a real browser pane, my own harnesses (since deleted) and the entry's own test, soak and e2e scripts. The host was under heavy load from other agents (load average 36 to 278 on 10 cores), so I re-ran every timing-sensitive result at lower load before counting it.

## 1. SPEC FIDELITY — SCORE 9/10

I ran every system myself instead of taking the code's word for it.

- **Balloon kick:** 40 all-Hard FFA rounds produced 13 `balloon_kicked` events, 31 Rubber Boots pickups and 9 different kickers.
- **Chain bursts:** in the same 40 rounds, `chain_burst` sizes were {2:543, 3:134, 4:32, 5:8, 6:2}. `burst.test.ts:13` asserts a 3-balloon chain bursts "in ONE tick".
- **Revenge ducks:** they ride the border, not the death tile (`ducks.ts:1-3` "ride a rubber duck along the border loop and lob balloons straight inward"). I saw 349 lobs and 51 to 66 revenge soaks. They are off in ranked (`state.ts:10` `ducksAllowed = opts.ranked ? CONFIG.REVENGE_DUCKS_IN_RANKED : true`).
- **Rising tide:** it floods and dissolves castles without revealing them (`tide.ts:39-42`).
- **Pre-rolled power-ups:** rolled at map generation (`map.ts:69` `prerollPowerUps(tiles, sfc32(contentKey))`).
- **Elo:** `elo.ts:81` `(kFactor(me.games) / (n - 1)) * scoreMinusExpected`, with K = 64 below 10 games, then 32 (`elo.ts:41-43`). I played a real ranked duel: it gave +32/-32, and SQLite held `ratings` 1032/968 (peak 1032/1000) and `match_players` rating_before/after. The leaderboard showed it immediately.
- **Matchmaker widening:** `matchmaker.ts:39-42` is ±100, +50 every 10s, capped at ±400.
- **Rematch:** strict majority (`lobbyOps.ts:109` `yes * 2 > voters.length`).
- **Room GC:** does not kill live matches, because `rooms.ts:397-400` calls `room.touch(now)` every tick while `in_match`.
- **Profanity filter:** rejected "fuckface" and "Sh1tHead".
- **Unlocks:** the server enforces them (`set_cosmetics` capybara at level 1 returned `locked_item`).
- **Settings:** actually read (`view.ts:56` `settings.get().reducedShake`, `input.ts:51` keybinds, colorblind in the HUD and sprites).
- **Emotes:** 20 sent, 1 echoed (1200 ms cooldown, `session.ts:90-93`).
- **Disconnects:** ranked forfeit and casual bot takeover both pass in e2e (`presence.ts:111-116`).

Deductions:
- The tutorial "Easy bot" is `passive: true` (`tutorial.ts:41-42`), so it never places a balloon.
- "Bots never soak themselves" is not met (see section 3).

## 2. SECURITY & ANTI-CHEAT — SCORE 8.5/10

**(i) How the secret is generated.** `rounds.ts:51-53` does `randomFillSync(new Uint32Array(4))`: a fresh crypto-random 128-bit key per round. `rounds.ts:68` passes it on every production path. Rounds, rematches (a new MatchRunner) and resyncs all go through `createRound`; resyncs re-send the existing state and never regenerate. The default `defaultContentKey(seed)` (`map.ts:53`) is reached only by tests, the soak and a dev contact sheet that is not bundled. The only fixed map is the tutorial (`tutorial.ts:81` `buildMap: () => buildTutorialMap()`).

**(ii) Is it brute-forceable?** It is ONE sfc32 stream consumed in row-major order (`map.ts:108-113`), but the key is 128 bits, not 32. An FFA map has 71 castles at about 1.40 bits of content each, roughly 99 bits in total. That is less than the key, so even revealing every castle cannot pin the key. There is no 2^32 attack to build.
- I also ran an empirical correlation test over 100k random keys on one layout. P(next castle has an item | this one has) = 0.2994 against a base of 0.2996. The per-kind transition rows were identical.
- In practice this matches Astra's per-tile design, even though sfc32 is not a CSPRNG.

**(iii) The layout seed.** The castleGrid pins the 32-bit layout seed. My brute force takes about 75 s single-threaded (the 93 draws make it unique). That leaks only future layouts, themes and bot RNG seeds, never loot. The cosmetic `mapSeed` is an independent `randomInt(2**31)` (`rounds.ts:74`).

**(iv) Leaks to clients.** None found. `snapshot.ts:33-38` sends only exposed items; `stateHash` includes `hidden` but is never sent.

**(v) Cheating bots.** None. Bots never read `hidden` (grep turns up only `dangerSim.ts:5` "never `hidden`").

**(b)/(f) Malformed frames: the process survived every one.**
- Raw `null`, non-JSON, a number, an array, a binary frame, and `type` set to `__proto__`, `constructor` or `toString` all returned `bad_message`.
- A 20 KB frame closed the socket with 1009.
- `hello` with a numeric, object, array, boolean or 5000-character token, or with no `v`, returned `bad_message`.
- Pre-auth `queue_join`, `start_match` and `create_room` returned `not_ready`.
- Wrongly typed `join_room`, `set_nickname`, `queue_join` and `set_slot` were dropped.
- In a live match I sent correctly sequenced inputs with `dir` 2.5, true, [], 1e308, -1, "1" and null; `seq` NaN, null, 2.5 and 1e308; `tick` -5; and `balloonPressed` "yes". All were rejected by `messages.ts:71-75` (`intIn` / `oneOf(m.dir, DIRS)` / `bool`). The next valid inputs were acked exactly (ack 139 = my last seq).
- Errors are caught in `handlers.ts:57-67`, per room in `rooms.ts:250-255`, and in the ticker (`ticker.ts:78-82`).
- There is no `process.on('uncaughtException')`; `index.ts:57-58` registers only SIGINT and SIGTERM.

**(c) Rate limiting.** It applies before auth (`handlers.ts:117`). A 500-message burst was closed with 1008.

**(d) Token hashing.** `validateToken` checks the regex `/^[A-Za-z0-9_-]{16,64}$/` before `hashToken` ever runs (`accounts.ts:77-79,180-181`), so a non-string never reaches `createHash().update()`.

**(e) SQL.** Every statement is a prepared statement; the only interpolation is a constant column list (`players.ts:51-52`).

**(g) Resource exhaustion.**
- `admission.ts:16-18` caps each address at 24 sockets and 12 burst guests (then 30/h), and each player can hold only one room.
- One address got 12 Hard FFA practice matches and 18 refused guests, with no process degradation (still 150 snapshots per 10 s).
- It took 30 spoofed addresses and 348 matches to drop delivery to 128 snapshots per 10 s. There is no global cap on concurrent matches.

**Deductions:**
- No `uncaughtException` guard.
- No global match cap.
- Ranked self-matching from one address is allowed by default (`RANKED_SEPARATE_ADDRESSES` is off, `gameServer.ts:78`). Per-tab identity slots (`identity.ts`) give each tab its own account, so one person can farm Elo against themselves.
- Pong timestamps let a client fake the ping others see (bounded to [0, silence limit] by `session.ts:98`).

## 3. CORRECTNESS — SCORE 7.5/10

**Top defects:**

1. **Browser-reproduced: reopening mid-round from a non-game route loses round 1.** A resync sends `match_start` and `round_start` back-to-back (`gameLoop.ts:227-229`). `onMatchStart` calls `navigate(path)` (`app.ts:352`), which sets `window.location.hash` (`app.ts:111`), and the resulting hashchange is async. `GameSession` only subscribes to `round_start` when it mounts (`session.ts:71`), and `net.ts:213-222` has no buffer, so `round_start` is dropped.
   - Reopened at `/#/menu`: stuck on the VS card for more than 12 s while the round ran live.
   - Opened at `/#/game`: the live round rendered.
   - A ranked player who reopens within the 15 s grace plays the rest of that round blind.
2. **Most rounds are tide draws.** My harness (real bots, shared sim, 300 rounds each):
   - Hard vs Easy duel: 177 to 3 with 120 draws (40%).
   - Easy mirror: 84% draws. Medium mirror: 67%. Four Hard bots in FFA: 67%.
   - The e2e casual 4p match needed 11 rounds and 1258 s of game time for first-to-2.
   - With `MAX_ROUNDS: 15` (`config.ts:65`), an all-Hard FFA to 3 wins is estimated to hit the cap about 57% of the time (a model built from these rates; the soak's hard-ffa averaged 12.8 rounds per match).
   - `TODO.md:34` admits this.
3. **Bots do soak themselves.** Hard is credited with its own soak in 2.8% of bot-rounds in the Hard mirror, 3.2% in 2 Hard + 2 Easy FFA, and 5.9% in 4-Hard FFA. The soak still passes because `report.ts:21`/`194-195` excuses "forced" self-soaks up to 6%.
4. **A brief disconnect as a match ends loses the seat.** `enterResults` vacates any disconnected seat even within the grace period (`lobbyOps.ts:79-84`). A player back 1.5 s later got only `welcome`; the other human's yes vote sent the room to the lobby.
5. **Timing gates are wall-clock and flaky under load.** The soak FAILED at load 167 on a 165 ms "decision" (CPU-time measurement puts the real maximum at 19.8 ms, with no tick over 33 ms). `lag-150ms` e2e failed twice at load above 120 (2.3% and 2.6% against a 2% limit) and passed at load 36.

**Cross-entry failure modes, one by one:**

| Check | Result |
| --- | --- |
| Round 1 renders for a joining client | Yes on the normal path (3.5 s intro). No for the defect-1 reattach edge |
| `match_start` always sent | Yes (`gameLoop.ts:110-114`) |
| First-visit tutorial Skip, and Esc mid-tutorial, reach the menu without freezing | Yes (browser) |
| Bots place balloons | Yes: Hard about 42 per round, Easy about 21 |
| Hard beats Easy | Yes: 40/40 in the soak, 177 to 3 in rounds in my harness |
| Own inputs not rate-limited | Yes: client sends 30/s against a 60/s limit with 120 burst |
| HUD ping is real RTT | Yes: server-measured, carried in `snapshot.pings` |
| Same-tick mutual soak is a draw | Yes (`sim.ts:161-164`) |
| Ranked starts and Elo persists | Yes (verified in SQLite) |
| Rematch after a last-round disconnect | Handled; minor seat loss (defect 4) |

## 4. NETCODE — SCORE 9/10

- **Rewind-replay is genuine.** `prediction.ts:181-189` prunes inputs with `seq <= ack`, clones the authoritative state and replays pending inputs.
- **The ack is correct.** It comes from `inputs.ts:94-95` and appears in `gameLoop.ts:316` (`ack: this.inputs.ack(p.slot), pings`). I measured it matching the last valid seq exactly.
- **Interpolation reads the constant.** `interpolation.ts:157` `return serverNow - Math.max(0, this.lateness) - CONFIG.INTERP_DELAY_MS;`.
- **Rates.** 30 Hz sim, snapshots every 2 ticks: 150 in 10.0 s.
- **Fuses** draw from `b.burstTick - estTick` (`world-hazards.ts:38-39`).
- **Latency.** The `lag-150ms` e2e showed 0/486 and 0/479 position mispredictions.

**The input clock is tied to rAF.** `view.ts:37,53,62` calls `session.update`, which calls `runInput` (`session.ts:176-196`).
- In a hidden tab, rAF stops and `onVisibility` sends a single `Dir.None` (`session.ts:168-173`), so the critter stops on purpose. A player who tabs away stands still and gets soaked.
- `FixedStep` caps catch-up at 4 steps per frame (`clock.ts:18,27-30`). Below about 7.5 fps, inputs are dropped: the client under-predicts while the server repeats the last direction (`inputs.ts:90`) and absorbs late inputs as step debt. The result is forward corrections on throttled devices.

## 5. CODE QUALITY — SCORE 9/10

- **Size:** 29.4k source lines plus 13.8k test/script lines, cleanly layered (net/, handlers/, rooms/, match/, 18 bot modules).
- **Typing:** 0 `any`, 0 `@ts-ignore`, and 7 `as unknown` (JSON and DOM boundaries). `npm run typecheck` is clean.
- **Sim purity:** the shared sim has no Math.random, Date.now or crypto, and `determinism.test.ts:52` asserts "never consults Math.random".
- **Dead code:** negligible. The crude unused-export scan found only intra-file and test-used exports.
- **Stale docs:** `ARCHITECTURE.md:72` still describes a single `contentSeed`; the code uses a `Key128`.
- **Unfinished items:** the TODO lists open ones (`TODO.md:18,34`, M6 "soak gate green" unchecked). The volume is heavy but mostly warranted: the bot brain, the audio synth and the input/net robustness code.

## 6. TEST DEPTH — SCORE 8.5/10

- **Count:** 774 tests in 59 files pass in 11.8 s (not 578).
- **They assert the spec's hard guarantees:**
  - One-tick chain (`burst.test.ts:13`).
  - Splash stops at the first castle (`burst.test.ts:70`).
  - Same seed gives same tiles and same hidden contents (`map.test.ts:15`), and the key is independent of the layout (`map.test.ts:48`).
  - Exact duel and 4-player pairwise Elo fixtures (`elo.test.ts:56,80`).
  - Counterfactual self-soak attribution (`bots-soak.test.ts:96-130`).
- **The soak** gates Hard over Easy at 90% or more (`report.ts:22,200`), crashes, desyncs (checked by replaying hashes), freezes, and unforced self-soaks.
- **The e2e** drives real sockets through the tutorial, casual 4p, ranked duel and FFA (Elo checked in SQLite), forfeit, reconnect and lag.
- **Gaps:**
  - No gate on the draw rate.
  - The 6% "forced" self-soak exemption.
  - Wall-clock CPU and lag gates that flake under load.
  - Headless e2e cannot see the defect-1 reattach race.

## TOP FINDINGS

1. **Loot secrecy is solved.** `rounds.ts:51-53` draws a fresh crypto 128-bit key per round and `map.ts:69` rolls contents from an independent sfc32 stream. A map holds only about 99 bits of content (71 castles × 1.40 bits), so no set of reveals can pin the key. My 100k-key test found no correlation between castles (0.2994 against 0.2996). The layout seed can be brute-forced (about 75 s) but tells an attacker nothing about loot. This belongs in Astra's tier, not the brute-forceable one.
2. **Reopening a match mid-round from a non-game route loses the round.** Browser-verified reattach race: `app.ts:352` navigates through `location.hash` (`app.ts:111`), and the hashchange is async. The back-to-back `round_start` from `gameLoop.ts:227-229` arrives before `session.ts:71` subscribes. A player reopening at `/#/menu` sat on the VS card for more than 12 s while the round ran.
3. **Most bot rounds end in a tide draw.** Measured draw rates: 40% for Hard vs Easy, 67% for four Hard bots in FFA, 84% for the Easy mirror. The e2e casual 4p needed 11 rounds and about 21 minutes of game time for first-to-2, and all-Hard FFA matches are estimated to hit the 15-round cap (`config.ts:65`) about half the time. The author admits this in `TODO.md:34`.
4. **"Bots never soak themselves" is not met.** Hard is credited with its own soak in 2.8 to 5.9% of contested bot-rounds, and the soak passes only because `report.ts:21,194-195` exempts "forced" self-soaks up to 6%. The tutorial's Easy bot is passive (`tutorial.ts:42`) and never throws a balloon.
5. **The server hardening held against every malformed frame I sent.** All of them were survived (`messages.ts:71-75`, `handlers.ts:57-67`, `rooms.ts:250-255`). Per-address caps (`admission.ts:16-18`) limit one address to 12 matches, and it took 30 addresses and 348 Hard matches to degrade the tick rate. Remaining gaps:
   - No `uncaughtException` guard (`index.ts:57-58`).
   - No global cap on concurrent matches.
   - Same-address ranked self-matching is on by default.
   - The soak and e2e gates are wall-clock based and failed under host load.

## ONE-LINE VERDICT

Weighted total 8.50. Held to the harsher standard, this is the most complete and best-hardened entry I have audited: loot is genuinely unguessable, no frame crashes the server, and ranked Elo persists. Its real flaws are a browser-verified reattach race that loses the round when you reopen mid-round, and bots that drift into tide draws often enough to drag casual bot matches to about 20+ minutes.

---

## Independent adversarial fact-checker (second subagent)

1. **Loot secrecy: CONFIRMED.** The only live map path is `rounds.ts:68`. It passes a fresh key from `randomFillSync` (4×u32, `rounds.ts:51-54`) to `map.ts:68-69`, where the layout comes from `mulberry32(seed)` and the contents from `sfc32(key)`. The only other `buildMap` is the fixed tutorial map (`tutorial.ts:81`). My probe on the real `createRound`: building the same match seed and round twice gave an identical layout, but the contents matched on only 38/71 castles, which is chance (about 0.52).

2. **Reattach race loses the round: CONFIRMED, and it reaches further than the auditor said.** In my muted-Chromium log, reopening at `/#/menu` delivered `match_start` at 23 ms, then `round_start` (resumeTick=102) at 24 ms, and only after that the hashchange that mounts the game screen. At 9 s the page still showed the VS card. Reopening at `/#/game` rendered the live round (resumeTick=400). Opening the bare site root `/` hits the same race, and that is the most natural way back after closing a tab. The cause is that `app.ts:352` navigates without replace (menu and title are not in TRANSIENT_ROUTES at `app.ts:209`), which goes through `app.ts:111` `location.hash`. Meanwhile `gameLoop.ts:227-229` sends both messages back to back, before `session.ts:71` subscribes. The client never asks for a resync.

3. **Tide draws: CONFIRMED.** Over 1,210 of my own matches:

   | Matchup | Round draws | Hit the 15-round cap (`config.ts:65`) |
   |---|---|---|
   | Hard vs Easy (duel) | 38% | 0/200 |
   | Hard vs Medium (duel) | 49–54% | 4/350 |
   | Medium vs Easy (duel) | 60% | 0/100 |
   | Easy vs Easy (duel) | 82% | 72/100 |
   | 4× Hard FFA | 60–63% | 25/60 and 29/60 |
   | 4× Medium FFA | 82% | 38/40 |
   | 4× Easy FFA | 90% | 39/40 |

   The repo's own soak prints similar figures (38.9% and 54.5%), and the `TODO.md:34` quote is accurate.

4. **"Bots never soak themselves" not met: PARTIALLY CONFIRMED.** Hard is credited with its own soak in 0.1% (vs Easy) up to 6.2–6.4% (4× Hard FFA) of bot-rounds, and `report.ts:21,194-195` does exempt "forced" self-soaks up to 6%. My rerun of `npm run soak`: Hard 29 forced, 0 unforced, gate passed.
   - About 90% of those credited self-soaks had opponent water on the same tile.
   - Soaks where only Hard's own water and its own chain were involved: 15 in 5,471 bot-rounds (0.27%). So "never" fails, but narrowly.
   - `tutorial.ts:42` (passive bot) is a deliberate tutorial design (`bot.ts:40-45`) and has nothing to do with self-soaks.

5. **Server hardening: CONFIRMED, with corrections.**
   - **Holds:** the frame validator rejects bad `dir` (`messages.ts:70-76`), dispatch has try/catch (`handlers.ts:56-68`), and the room tick has try/catch (`rooms.ts:249-255`).
   - **Gaps confirmed:** there is no `uncaughtException` or `unhandledRejection` handler anywhere; `index.ts:57-58` only handles signals. There is no global match cap.
   - **Same-address ranked matching is on by default (`index.ts:32`, `matchmaker.ts:70,81`):** I matched two accounts from one address. The forfeit moved Elo from 1000 to 1032/968, and it was saved in SQLite.
   - **Correction:** `admission.ts:16` allows 24 sockets per address; 12 is only the guest-account burst (`:17`), which refills at 30/h. So one address can hold about 24 concurrent matches, not 12.
   - **Not reproduced:** the "wall-clock gates fail under host load" claim. The soak passed for me at host load average about 38 (slowest bot decision 56 ms against a 100 ms limit).

**SEED VERDICT: contents unguessable.** No server path uses a 32-bit content seed, so the k-reveal brute force does not apply. A map reveals at most about 100 bits against a 128-bit key.
- The layout seed can be brute-forced: all 2^32 candidates took 51.3 s on 8 workers and found one unique seed.
- It predicts nothing about loot: 39/73 castles agreed (chance) and 2 of 15 predicted items were right.
- Castles are independent: over 20k rounds, the chance a castle holds an item was 0.307 given the first castle had one, against 0.300 overall.

**CRASH VERDICT: none found.** I sent 104 frames, and /health stayed up after every one. They covered:
- **Before hello:** non-JSON, null, arrays, prototype-key types, nesting 4,000 deep, a bad token, a bad version (closed 1008), binary, an unmasked frame (closed 1002), 9 KB (closed 1009).
- **After hello:** every message type with bad fields.
- **In a live match:** correctly sequenced inputs with `dir` set to 1.5, true, [1], "1", null, -1, 5, 1e308 and {}, plus odd `seq` and `tick` values and out-of-phase commands.
- **Flood:** 49k messages in 400 ms closed the socket with 1008; the server survived.
- **Load:** 351 concurrent Hard FFA practice matches did not kill the process. RSS was about 300 MB, the tick rate fell from 30 to 23.6/s, and /health took 383 ms.

**BOT VERDICT:**
- **Balloons per round:** Hard 34–46, Medium 31–40, Easy 16–22. No bot had a round without placing one.
- **Hard vs Easy:** 200/200 matches, rounds 600–5 with 374 draws.
- **Hard vs Medium:** 343/350 matches (4 capped, 3 lost), rounds 1038–134 with 1,232 draws.
- **Self-soaks (credited / strict):** Hard 0.1–6.4% / 0.27%; Medium 2.4–3.0% / 0.1–0.2%; Easy 1.8–8.6% (Easy's misjudgments are allowed by the spec).

**ROUND-1 VERDICT: renders.** On a first visit, PRESS START then "Play the tutorial" showed the arena at Step 1/5, and moving advanced it to 2/5. Practice against an Easy bot showed ROUND 1 at 1:58. The only VS-card hang is the mid-round reopen from finding 2.

**PING VERDICT: real RTT.** The server computes `now - echoed t` (`session.ts:96-108`). When I delayed my pongs by 0, 150 and 400 ms, the server reported 2–5, 151–155 and 402–410 ms, and the same values appeared in the snapshot `pings[]`. A forged future `t` gives a negative value, which is discarded.

**GENEROSITY CHECK:**
- The reattach race also triggers from the bare root URL. In ranked, reopening within the 15 s grace costs the round, because the critter stands idle.
- The draw problem is understated for FFA: 4-bot Medium and Easy rooms hit the round cap in 95–98% of matches (about 32 minutes each).
- Hard fails to soak an Easy bot before the tide in 38% of duel rounds. That is weak for a bot the spec says hunts players and cuts escape corridors.
- The per-address cap is 24, not 12.
- Elo farming works out of the box: two accounts on one address can match each other, and each forfeit is worth 32 points.
- Contents of live rounds cannot be replayed, because the random key is thrown away. The spec's "deterministic per seed for tests/replays" holds for tests only.
- On balance, 8.50 looks slightly generous.

Probe scripts are in `/private/tmp/claude-501/-Users-jackychou-dondi/e5f62f92-7103-4c27-b63a-21078977f6a7/scratchpad/fc/`: `crash.mjs`, `load.mjs`, `ping.mjs`, `ranked.mjs`, `botprobe.ts`, `seedprobe.ts`, `browser.cjs`, and `shots/`. The browser and server are closed, and nothing was written to the repo.
