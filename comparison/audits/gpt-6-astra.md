<!-- Audit of the 'GPT-6 Astra' submission by an independent Claude subagent, 2026-09-06, under the
     SAME neutral rubric the twelve rivals got, PLUS a second independent fact-checker.
     NOTE ON CONFLICT OF INTEREST: this entry was processed by an orchestrator running as Claude
     Opus 5 -- itself entry #2 in this comparison. The headline finding (Astra is the first entry to
     satisfy the spec's anti-cheat requirement, which BOTH top Claude entries fail) therefore cuts
     against the orchestrator's own model family. The orchestrator independently reproduced the
     attack, the crash test, and playability firsthand. -->

Cleanup done; nothing in the audited tree was modified (only `npm run build`, as sanctioned).

---

# Splash Critters — Audit: GPT-6 Astra

Verified by building, running all 4 scripts + vitest, booting the built server and firing 33 malformed frames, and writing independent probes (bot-strength harness, loot-derivation attack, rate measurement, speed-hack probe, DoS probe).

---

## 1. SPEC FIDELITY — **SCORE 9/10**

Almost nothing here is decorative. **Balloon kick** is fully server-simulated (`shared/src/sim.ts:150-167` mutates the balloon inside `canStand` and emits `balloon_kicked`; slide continues in `sim.ts:311-319`) and the Hard bot actually *uses* it to escape (`bots/bot.ts:99-120` clones the state, simulates 6 ticks, and only commits if a kick plus a live escape path exist). **Revenge ducks genuinely ride the border** — `sim.ts:251-282` advances `player.duckPos` along the perimeter and snaps `player.x/y` to `duckPosition()`, then lobs inward up to 3 tiles; it is not a lob from the death tile, and `render/sprites.ts:452-457` draws them there. **Rising tide** (`sim.ts:332-357`), **chain bursts in one tick** (single BFS at `sim.ts:366-436`, frozen `blockers` snapshot at `:359` so two bursts cannot tunnel a just-washed castle), **pre-rolled power-ups at map gen** (`map.ts:41-55`), **pairwise Elo with K′=K/(n−1)** (`shared/src/elo.ts:37`, so K/3 for FFA and K for duel; K=64 under 10 games), **matchmaker widening** 100 + 50/10s capped 400 (`matchmaker.ts:17-24`), **15s grace → ranked forfeit / casual Medium-bot conversion** (`gameLoop.ts:23-38`), **profanity filter with leetspeak normalisation** (`queries.ts:144-169`), and **server-side unlock enforcement** (`queries.ts:176-184` — `equip` throws unless `profile.unlocks.includes(...)`; confirmed live: the integration script gets `/level/` back for `capybara`) are all real.

Settings are genuinely read by the renderer, not just stored: `sprites.ts:291-296, 413, 432, 440` swap the splash/water palette on `colorblind`, and `main.ts:729, 1081` gate the shake on `reducedShake`; keybinds feed `inputDirection()` at `main.ts:670-685`. The tutorial is **both** a scripted arena *and* an Easy bot: `rooms.ts:355-369` wipes all castles and plants a fixed training lane with a guaranteed `range` drop and three chain castles, `gameLoop.ts:61` freezes the opponent until the chain goal lands, and the 5 goals are server-verified (`gameLoop.ts:70-88`) before `tutorial_complete` will pay out (`index.ts:270-284`). Room GC (`gameLoop.ts:14-20`) is correctly guarded by `!room.slots.some(s => s.kind === "human" && s.connected)` — it cannot kill a match a human is watching.

Two real gaps. **Easy bots are unreachable from the casual lobby** — `screens/lobby.ts:21` emits `...>Open slot</option value="easy" ...>Easy Bot</option>`, a mangled *closing* tag. Confirmed in headless Chromium: the select renders `['open:Open slot','medium:Medium Bot','hard:Hard Bot']` with a stray `Easy Bot` text node, and `selectOption("easy")` times out. The spec's "per-slot difficulty (Easy/Medium/Hard)" is one-third dead. And `screens/menu.ts` is a 1-line re-export alias existing only to satisfy the spec's file list; `render/hud.ts:6-28` `drawBadge` is exported and never called.

## 2. SECURITY & ANTI-CHEAT — **SCORE 8/10**

### (i) The hidden-power-up requirement: **Astra genuinely closes it.** First entry that does.

The mechanism is a real architectural fix, not a decoy. `rooms.ts:336-338` builds, **fresh every round**, one CSPRNG secret per tile:

```ts
// Independent secret streams prevent revealed drops from disclosing later castle contents.
const lootSeed = Array.from({ length: arena.width * arena.height }, () =>
  randomInt(0x100000000));
```

and `map.ts:42` gives every tile its own PRNG stream: `typeof lootSeed === "number" ? loot : mulberry32(lootSeed[index])`. Layout and contents no longer share a stream, so pinning the layout seed buys nothing.

I ran the exact attack that killed Fable 5 and Opus 5. Captured everything on the wire from a real WS session, then compared against server ground truth:

```
round_start keys: type, roundNo, mapSeed, castleGrid, width, height, theme
wire mentions 'hiddenPowerups'? false        wire mentions 'lootSeed'? false
layout reproduced exactly from mapSeed?  true          <- layout is public, as the spec intends
predicted 16 drops; correct location 3; correct location+kind 1; truth has 14
```

Three location hits where chance predicts ≈4.8, one kind hit where chance predicts ≈1 — **zero signal**. Two further checks: (a) conditional independence over 40 000 rounds — `P(tile B | tile A = none/balloon/range/speed/kick)` is flat to three decimals (`none≈0.70, balloon≈0.11, range≈0.12, speed≈0.06, kick≈0.015` for every conditioning value), so revealing castles teaches nothing about unrevealed ones; (b) the single-master-seed family is too small to contain the truth — 67 castle tiles × 5 outcomes ≈ 10^47 configurations vs 2^32 ≈ 4.3e9 reachable by any one `lootSeed` number. The best of 2e6 candidates matched 50/67 against a 39.4/67 chance floor, i.e. an order statistic, not a key. Distribution is also correct on the production path: 0.2983 drop rate over 209 179 castles, mix `balloon .380 / range .381 / speed .189 / kick .050`.

### (ii) The trivially derivable default is never reachable in production.
`map.ts:8` `lootSeed = seed ^ 0x718b45da` would be a hole. I enumerated **every** `createGame`/`generateMap` call site: exactly one server path exists (`rooms.ts:339-342`) and it always passes the array. Reconnect (`rooms.ts:255-261`) and spectate re-send the *existing* state, never regenerate. Tutorial goes through the same `newRound`. The number default appears only in `sim.test.ts`, `bot.test.ts`, `scripts/soak.ts:27`, `scripts/bot-trace.ts:21`, and `client/src/debug.ts` — the last being a fully offline single-machine harness. No production fallback.

### (iii)/(iv) No leak in snapshots, events, or the client.
`rooms.ts:399-420` builds the snapshot field-by-field (no `hiddenPowerups`); `rooms.ts:384-398` sends only `mapSeed`/`castleGrid`/theme; `powerup_revealed` fires only at `sim.ts:406`, after the castle is gone. `client/src/prediction.ts:56` hard-codes `hiddenPowerups: {}`, so a locally predicted castle wash produces no drop — the client physically cannot compute contents. Even the bot's forecaster blanks them (`bots/dangerMap.ts:43`).

### (b)–(f) The rest.
`net.ts:42-131` is the strongest validator in the cohort: byte cap before parse, `isObject` rejecting arrays, `Number.isSafeInteger` bounds, and an exact-key whitelist on `input` (`:92-94`). **(d) the non-string-token bug that killed 6 of 12 is double-guarded** — `net.ts:60-62` requires `typeof token === "string"`, and `queries.ts:69-75` additionally regex-tests it as a UUIDv4 *before* `hash()`, so `createHash().update()` can never see a non-string. **(e) SQL is 100% parameterised** — zero template literals or concatenation in `queries.ts`. **(c) rate limiting is real** — 300 messages in a burst got `close 1008 Message rate exceeded`. Movement is server-authoritative: flooding inputs at 55/s (nearly 2× tick rate) produced **3.378 tiles/s against a 4.0 cap**, never more.

**(f) Boot + malformed frames.** All 33 frames, process survived every one:

| frame | result |
|---|---|
| numeric / object / array / boolean / `null` token | `BAD_MESSAGE`, socket stays open |
| absent token, `__proto__` token | `welcome` (fresh guest) — correct |
| raw `null`, raw array, raw string, raw number, non-JSON, empty | `BAD_MESSAGE` |
| `{"__proto__":{"isAdmin":true}}` | `welcome`, no pollution |
| pre-auth `queue_join`/`start_match`/`input`/`set_nickname` | `INVALID_ACTION: "Say hello before joining the pool."` |
| unknown type, numeric type, object type, no type | `BAD_MESSAGE` |
| 200-deep nesting, NaN seq, seq 2^53, slot −1/99, emote 9999 | `BAD_MESSAGE` |
| 8 KB payload | `close 1009` (ws `maxPayload`) |
| `join_room "' OR 1=1--"` / `"../../x"` | `BAD_MESSAGE` |
| `set_nickname "a'; DROP TABLE players;--"` | rejected by the charset rule |

**But there is a proven remote process-kill.** `rooms.ts:100-101` throws on `MAX_ROOMS`, and `matchmaker.tick()` (`matchmaker.ts:15, 94`) calls it inside a bare `setInterval` — the *only* try/catch is around the WS message handler (`index.ts:319-323`), and there is no `uncaughtException` handler. One guest socket can `create_room`/`leave_room` 200 times (well under 60 msg/s; the room survives the leave), then any ranked queue kills the server:

```
create attempts: 205 | room_created: 200 | health: {"rooms":200}
HEALTH FAILED -> server is DOWN
Error: All pools are busy. Please try again shortly.
    at Rooms.create (rooms.js:65:19)
    at Matchmaker.tick (matchmaker.js:78:41)
    at Timeout._onTimeout (matchmaker.js:9:45)
```

Every live match on the box dies with it. That is what keeps this off a 9.

## 3. CORRECTNESS — **SCORE 8/10**

Cross-entry failure modes all pass. **Round 1 renders**: `match_start` sets `state.screen = "game"` and calls `render()` *synchronously* before `round_start` is dispatched (`main.ts:904-932`), so there is no async-navigation race; `scripts/browser.ts` waits on `#arena` in two contexts and the captured `test-results/game-desktop.png` shows a live round 1. **`match_start` is always sent** (`rooms.ts:324` before `newRound`). **Ranked starts** (integration matches two humans and asserts `slots.every(kind === "human")`). **Ping is real, not faked** — I delayed pongs by 40/80/120/160/200 ms and the server reported `rtt = 0 → 47 → 86 → 125 → 163` (`index.ts:129-132`, `:341`). **Same-tick mutual soak is a draw** (`sim.ts:479-483` → `winnerId = null`; `endRound` at `rooms.ts:423` awards nothing).

Genuine defects, ranked:

1. **Remote process kill** (`matchmaker.ts:94` + `rooms.ts:100`) — see above, proven with a stack trace.
2. **Easy bot dead in the lobby UI** (`screens/lobby.ts:21`) — proven in Chromium.
3. **Rematch is permanently dead-ended by a last-round disconnect.** If a casual opponent drops and the match finishes inside the 15 s grace, `gameLoop.ts:21` skips the bot conversion (status is now `results`) while the slot stays `kind:"human", connected:false`; `index.ts:262-265` sets `ready = true` but only bot-fills `open` slots, so `rooms.start` (`:283-285`) throws forever. Reproduced end-to-end: `rematch result: ["Every player must be connected and ready."] | room status after vote: results`. The spec's "majority restarts same room" is unreachable in exactly the scenario that most needs it.
4. **Hard bots do soak themselves**, contra "zero mistakes"/"never soak themselves". `scripts/soak.ts:82` asserts `selfSoaks === 0` — but only across 10 hand-picked seeds that also use the *number* `lootSeed` (`soak.ts:27`), a loot distribution production never produces. My own harness on the real crypto-array path: **Hard 26 self-soaks / 900 bot-rounds (5.3 % of their deaths)**, Medium 7/300, Easy 4/600. The shipped assertion is a fixture artifact, not a property. (Strength itself is fine — Hard beats Easy 278–80 with 42 draws over 400 duels = 77.6 % of decided rounds, and Hard beats Medium 122–74; zero timeouts, so no bot ever freezes.)
5. **`queue_status` can yank you back to the queue screen after cancelling.** `main.ts:877-882` unconditionally forces `screen = "queue"`; a `queue_status` already in flight when `queue_left` lands re-enters the screen. Cosmetic but user-visible.

Also worth noting: `canStand` (`sim.ts:135-170`) is a predicate with a side effect — it kicks the balloon, then can still `return false` on a later tile in the radius loop, leaving a balloon kicked while the player does not move.

## 4. NETCODE — **SCORE 9/10**

Real rewind-replay, not smoothing. `prediction.ts:46-50` reads the server ack straight off the authoritative player (`snapshot.players.find(...).lastInputSeq`, written in `sim.ts:324`), drops acked inputs, rebuilds state from the snapshot at `:51-64`, and replays only the unacked tail through the *same* `simulateTick` at `:66-67`. `prediction.test.ts:22-51` pins this against a reference server sim. Interpolation reads the constant: `prediction.ts:81` `serverTime - CONFIG.INTERPOLATION_MS`, with local player excluded (`:101`) and a snapshot-pair lerp; the test asserts x=9 exactly at t−100 ms. Fuses render from server ticks (`sprites.ts:423`, `1 - (b.burstTick - state.tick)/FUSE_TICKS`).

I measured the rates against a live match rather than trusting CONFIG: **30.03 Hz sim, 15.36 Hz snapshots, tick delta between consecutive snapshots is exactly `[2]`** (`gameLoop.ts:91-92`, `:99-102`). Clock offset from ping (`client/net.ts:55`), artificial latency split both ways (`:60, :87`).

Two soft spots: the server *samples* the newest input per tick rather than consuming a queue (`index.ts:227-235`), so when two inputs land in one tick window the earlier one's movement is lost server-side (self-correcting via reconciliation, but a small systematic under-travel under jitter); and `prediction.ts:59` derives `nextBalloonId` from the snapshot, so a predicted balloon can transiently collide with a server id.

## 5. CODE QUALITY — **SCORE 8/10**

Folder layout matches the spec's tree essentially exactly. **Shared sim purity is perfect**: `grep -rn "Math.random|Date.now|crypto|performance.now" packages/shared/src/` returns *nothing* — all nondeterminism lives at the `rooms.ts:336/340` and `gameLoop.ts` boundary. Typing discipline is the best in the cohort: **zero `any`, zero `as any`, zero `@ts-ignore`/`@ts-expect-error`** across all three packages, `tsc --noEmit` clean on all three projects. Convincing separation — `elo.ts` is pure math, `bots/dangerMap.ts` forecasts by running the real sim forward on a clone (`:41-72`) rather than reimplementing splash rules, and the danger map is memoised per `GameState` in a `WeakMap`.

Costs: extremely dense style — `screens/*.ts` are single mega template literals (that is exactly how the Easy-bot `</option>` bug hid), and 33 non-null assertions, two of which sit on the crash paths above (`gameLoop.ts:28`, `rooms.ts:492`). No ESLint/Prettier config is checked in. Small dead code: `hud.ts:6-28 drawBadge`, `screens/menu.ts` alias.

## 6. TEST DEPTH — **SCORE 8/10**

22 tests / 6 files (not 16), all passing in 275 ms, and they assert the right things rather than padding. `sim.test.ts:57-75` fires a **3-balloon cascade in one tick** and checks each balloon's *own* range propagated (splash at x=9, none at x=10). `:76-88` proves splash **stops at the first castle** *and* that the pre-rolled `kick` is revealed, then that a second burst destroys the exposed pickup. `:43-56` is the anti-cheat test that matters: same layout seed with two different loot seeds ⇒ **identical `tiles`, different `hiddenPowerups`** — a direct assertion of the layout/contents separation. `:143-158` replays 100 ticks and diffs full state each tick. `elo.test.ts` carries **6 exact fixtures** including 4-player pairwise, shared placements (`[1,2,2,4] → [16,0,0,-16]`), and the all-tied case. `queries.test.ts` verifies the hash is not the token, is 64 hex, never appears in a profile, that profanity and `<script>` are rejected, that a locked cosmetic throws, and that tutorial XP pays **once**. `net.test.ts` pins the extra-key rejection (`{x:20}`) and `1e40`.

The scripts are largely real, not completion-checks. `scripts/integration.ts` (225 lines) runs a **true end-to-end over WebSockets**: guest auth, public 4p room + 2 Hard bots discovered via the room browser by a second socket, ready/start, deterministic replay diff (`:132`), XP persisted to SQLite, rematch, ranked duel via `matchmaker.tick()`, socket-kill reconnect, forfeit, and **exact Elo values** (`1032`/`968`), leaderboard order, and no-double-XP on a second `finish` — plus `assert(!JSON.stringify(data).includes("hiddenPowerups"))`. `scripts/browser.ts` drives **two isolated Playwright contexts** through create→browse→join→ready→start→keyboard play→reload-reconnect at `?latency=150`, plus a 390 px no-horizontal-scroll check, asserting zero page errors. `scripts/tutorial.ts` drives the real tutorial with real key events and a Hard bot as the puppeteer, asserting all 5 server goals plus persisted XP. All four pass.

The weak link is `scripts/soak.ts`: 10 fixed seeds, a *number* `lootSeed` that production never uses, and `assert.equal(selfSoaks, 0)` / `assert(hardWins > easyWins)` (6 vs 3 — one flipped round from failing) that my 900-round replication contradicts. Nothing tests the matchmaker's throw path, and `browser.ts:40-42` only ever selects `"hard"`, which is precisely why the dead Easy option shipped.

---

## TOP FINDINGS

1. **Remote, unauthenticated process kill (P0).** One guest socket creating and abandoning 200 rooms fills `CONFIG.MAX_ROOMS`; the next ranked pairing makes `Matchmaker.tick` (`packages/server/src/matchmaker.ts:94`) call `Rooms.create`, which throws at `packages/server/src/rooms.ts:100-101` inside a bare `setInterval` with no `uncaughtException` handler and no try/catch (the only one is `packages/server/src/index.ts:319-323`). Reproduced: `HEALTH FAILED -> server is DOWN` with the stack trace above — every live match dies.

2. **Astra is the first entry to actually close the hidden-power-up hole, and it holds under attack.** `packages/server/src/rooms.ts:336-338` draws one `crypto.randomInt(2^32)` per tile every round and `packages/shared/src/map.ts:42` rolls contents from `mulberry32(lootSeed[index])`, decoupling contents from the broadcast `mapSeed`. Deriving from the wire scores at chance (3 location / 1 kind hits vs ~4.8 / ~1 expected), `P(tile B | tile A)` is flat across all conditioning values over 40 000 rounds, the array is passed at the *only* server call site so the derivable `seed ^ 0x718b45da` default at `map.ts:8` is unreachable, and the client hard-blanks `hiddenPowerups` at `packages/client/src/prediction.ts:56`.

3. **Easy bots cannot be assigned in casual rooms.** `packages/client/src/screens/lobby.ts:21` emits `</option value="easy" ...>` — a closing tag with attributes — so Chromium renders only `open / medium / hard` plus a stray `Easy Bot` text node, and `selectOption("easy")` times out. The spec's Easy/Medium/Hard per-slot requirement is one-third dead; `scripts/browser.ts:40-42` never selects Easy, so nothing caught it.

4. **A last-round disconnect permanently kills the rematch.** With status already `results`, `packages/server/src/gameLoop.ts:21` skips the bot conversion, so the dropped slot stays `kind:"human", connected:false`; `packages/server/src/index.ts:262-265` only bot-fills `open` slots, and `rooms.ts:283-285` then throws forever. Reproduced: the survivor's every vote returns `"Every player must be connected and ready."`.

5. **The soak script's "bots never soak themselves" guarantee is a fixture artifact.** `scripts/soak.ts:82` asserts `selfSoaks === 0` over 10 fixed seeds using a *number* `lootSeed` (`scripts/soak.ts:27`) that production never uses. On the real per-tile crypto path I measured **Hard: 26 self-soaks over 900 bot-rounds (5.3 % of Hard deaths)**, Medium 7/300, Easy 4/600 — Hard is not the spec's "zero mistakes". (Relative strength is fine: Hard beats Easy 278–80–42d over 400 duels, Hard beats Medium 122–74, zero freezes.)

---

## ONE-LINE VERDICT

The first entry to genuinely solve the unguessable-power-up problem — per-tile CSPRNG loot streams that survive a real derivation attack, wrapped in the cohort's best validator, purest shared sim, and most honest test suite — but it ships a proven one-socket remote kill of the whole Node process, a dead Easy-bot option, and a rematch that a last-round disconnect bricks forever.

---

## Independent fact-checker verdict (second subagent)

All servers stopped. Here are my independent findings.

---

**1. Remote unauthenticated process kill — CONFIRMED (reproduced end-to-end).**
`packages/server/src/rooms.ts:100-101` throws `"All pools are busy…"` when `this.rooms.size >= CONFIG.MAX_ROOMS` (200, `config.ts:65`), and `packages/server/src/matchmaker.ts:94` calls `this.rooms.create(...)` from a bare `setInterval` (`matchmaker.ts:15`) with no try/catch; the only handler is the WS message one at `index.ts:319-323`, and there is no `process.on('uncaughtException')` anywhere in the repo. `Rooms.leave` (`rooms.ts:206-235`) only blanks the slot — it never deletes the room — and the reaper (`gameLoop.ts:14-20`) needs `ROOM_TTL_MS` = 10 min, so one guest socket create/leave-looping fills the map. I reproduced it: one anonymous socket made exactly 200 rooms, then two anonymous sockets `queue_join`ed duel; ~1 s later the process was gone and `/health` stopped answering. Server log: `Error: All pools are busy. Please try again shortly. at Rooms.create (rooms.js:65) at Matchmaker.tick (matchmaker.js:78) at Timeout._onTimeout`. Every live match died with it. Only nuance: the trigger needs 3 anonymous sockets (flooder + 2 queuers), all guests, no credentials — so "unauthenticated" holds.

**2. Hidden power-ups genuinely unguessable — CONFIRMED, with one small correction.**
`rooms.ts:336-338` builds `lootSeed` as one `crypto.randomInt(0x100000000)` **per tile per round**, and `map.ts:41-42` rolls contents from `mulberry32(lootSeed[index])`, fully decoupled from the broadcast `mapSeed` (`rooms.ts:390`). I ran the derivation attack over **40,000 production-identical maps**: guessing with the derivable default `seed ^ 0x718b45da` scores **0.3002 location hit-rate vs a 0.3000 chance baseline**, kind hit-rate **0.0985 vs 0.0982 expected by chance**; using `lootSeed = seed` scores 0.3001. Conditional independence is flat: `P(loot at B | loot at A) = 0.3019` vs `P(loot at B | no loot at A) = 0.3026`. A live in-process capture of a full match (506 frames, ground truth read from server memory) showed `hiddenPowerups`/`lootSeed` never on the wire, and 13 of 26 loot tiles still secret after 25 s of play; reveal happens only on wash (`sim.ts:402-407`). **Correction:** the auditor's "the derivable default at `map.ts:8` is unreachable" is wrong — `packages/client/src/debug.ts:34` calls `createGame` with no `lootSeed`, and `debug.html` is shipped and served (HTTP 200). It is a purely local single-player sim lab with no server and no opponent, so it does not reintroduce the hole, but the default is reached in shipped code.

**3. Easy bot un-selectable in casual rooms — CONFIRMED (verified in a real Chromium DOM).**
`packages/client/src/screens/lobby.ts:21` emits `</option value="easy" ...>Easy Bot</option>` — a closing tag carrying attributes. Chromium parses the select as exactly 3 options (`open:Open slot`, `medium:Medium Bot`, `hard:Hard Bot`) with `"Easy Bot"` left as a stray text node (`sel.innerHTML` = `<option value="open" selected="">Open slot</option>Easy Bot<option value="medium">…`). `selectOption("easy")` and `selectOption({label:"Easy Bot"})` both time out; medium/hard/open all work. `scripts/browser.ts:40-42` only ever selects `"hard"`, so nothing caught it. The server side is fine (`net.ts:80-81` and `rooms.botSlot` accept `easy`; the tutorial hard-codes Easy at `rooms.ts:154`) — this is a client-only defect.

**4. Last-round disconnect bricks the rematch — CONFIRMED (reproduced).**
`gameLoop.ts:21` (`if (room.status !== "playing" || !room.match) continue;`) short-circuits before the disconnect→bot conversion at lines 23-38, so once `finish()` sets `room.status = "results"` (`rooms.ts:475`) the pending grace entry is never processed and the slot stays `kind:"human", connected:false`. `index.ts:262-263` bot-fills only `open` slots, then `rooms.ts:283-285` throws. Repro: casual duel, roundsToWin 2, loser's socket terminated mid-fuse on the deciding round → `match_end` fires, and the survivor's rematch vote returns `"Every player must be connected and ready."` at +1 s, +10 s, +25 s and +45 s (well past the 15 s grace), with the room still alive (`rooms:1, players:1`). It stays bricked until the dropped player reconnects or the survivor leaves; the TTL reaper can't clear it while the survivor is connected. Scope nuance: it needs the disconnect within the final ~15 s, not any last-round disconnect.

**5. Soak script's zero-self-soak guarantee — PARTIALLY CONFIRMED (right conclusion, wrong cause).**
`scripts/soak.ts:27` does pass a *number* `lootSeed` production never uses and `scripts/soak.ts:82` asserts `selfSoaks === 0`, and the substantive claim replicates: on the production per-tile crypto path I measured **Hard 22–26 self-soaks per 1,000 bot-rounds (5.3–6.0 % of Hard deaths)**, Medium 13–19/1,000 (3.0–4.5 %), Easy 8–9/1,200 (0.8 %) — so Hard is not the spec's "zero mistakes" (`prompt.md:158`). **But the causal attribution is refuted:** holding volume constant at 300 rounds per mode, number-`lootSeed` and array-`lootSeed` self-soak identically (duel 5 vs 7; ffa 25 vs 25). The fixture passes because it is tiny — 22,577 ticks, where the measured ~2.6e-5/tick rate predicts ≈0.6 events and P(zero) ≈ 55 %. It is a sample-size artifact, not a seed-type artifact. Also **"Hard beats Medium 122–74" does not replicate**: over 1,200 duel rounds I got Hard 584 / Medium 586 (z = −0.06), and FFA winners were Medium 80 / Hard 75.

---

**SEED VERDICT: contents unguessable.**
Every server round goes through the single call site `rooms.ts:339` with the per-tile CSPRNG array; the whole `ServerMessage` union (`protocol.ts:43-80`) has no field capable of carrying contents; `Snapshot` omits `hiddenPowerups`; reveal is emitted only inside the castle-wash branch (`sim.ts:402-407`), so revealing one drop discloses nothing about any other (measured `P(B|A)` ≈ `P(B|¬A)` ≈ 0.302). Attacks from the wire (`mapSeed` + `castleGrid`) score exactly at chance over 40 k trials, and the client blanks the field at `prediction.ts:56`. The `seed ^ 0x718b45da` default is reachable only in the offline `/debug` sim lab (`client/src/debug.ts:34`), which has no adversary. Astra also keeps the spec's replay determinism (`prompt.md:193`) by making the map deterministic in `(seed, lootSeed)` rather than dropping determinism. On the "first entry" claim: a grep across all 13 results shows **gpt-6-astra is the only entry containing any second/secret loot seed**, and every other entry ships a `mapSeed` in a round-start message — consistent with the auditor, though I did not fully audit the other 12 codebases' derivation paths, so treat "first/only to solve it" as strongly supported rather than exhaustively proven.

**CRASH VERDICT: triggerable crash at `packages/server/src/rooms.ts:100-101` (reached from `matchmaker.ts:94`).** No *pre-auth* crash exists: I fired 29 malformed frame classes (raw `null`/`true`/number/string/`[]`, non-JSON, empty frame, `hello` with numeric/object/array/boolean/null token, no token, `__proto__` token, prototype-pollution payload, 5 KB and 100 KB oversized, deep-nested arrays, binary frames, and pre-auth `queue_join`/`start_match`/`create_room`/`rematch_vote`/`leave_room`/`tutorial_complete`/`input`, out-of-range `set_slot`) — every one was rejected cleanly with `BAD_MESSAGE` or `"Say hello before joining the pool."`, the process stayed up and `/health` kept returning `ok:true` throughout. `net.ts:42-131` is a genuinely tight validator. The kill is post-`hello` but pre-*credential* (guest accounts are free), reproduced as described above: process dead, `/health` = `TypeError: fetch failed`.

**BOT VERDICT: Hard beats Easy, and bots self-soak.** Over 600 duel rounds Hard 443 / Easy 106 / 51 draws (z = 14.4); Medium 468 / Easy 118 (z = 14.5). But **Hard and Medium are indistinguishable**: 1,200 rounds gave Hard 584 / Medium 586 / 30 draws (z = −0.06), and mixed FFA gave Medium 80 / Hard 75 / Easy 27. Self-soaks on the production path: Hard 26/1,000 bot-rounds (6.0 % of Hard deaths), Medium 19/1,000 (4.5 %), Easy 8/1,200 (0.8 %). Zero timeouts, zero freezes, zero NaN positions across ~4,000 simulated rounds.

**ROUND-1 VERDICT: renders.** Headless Chromium created an FFA room, filled slots 1-3 with Hard bots, started the match, and the gameplay screen mounted: 256×224 canvas with 42 distinct colours at 100 % coverage, HUD reading `ROUND 1` with a live 2:00→1:54 tide timer, four player cards, four sprites and the castle grid drawn, zero page errors. Screenshot at `/private/tmp/claude-501/-Users-jackychou-dondi/39fb472c-a733-4659-802a-af47b9c6d112/scratchpad/round1.png`.
