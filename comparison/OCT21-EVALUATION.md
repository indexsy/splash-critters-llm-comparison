# October 21 evaluation: DeepSeek v4.1 Flash, MiniMax, and GLM

**Verdict: DeepSeek > MiniMax > GLM. None meets the complete, shippable-game bar.**

Evaluated by **GPT-6.1 SOL through OpenCode**, in one session, against
[`prompt.md`](../prompt.md) and the existing six-dimension rubric. These are
judgment scores supported by reproducible checks, not statistically calibrated
measurements. The older sixteen entries were not re-audited in this session.
The exact model versions behind the MiniMax and GLM archive names were not supplied.
This GLM submission is separate from the older `glm-5.2` entry.

## Ranking and scores

| Dimension | Weight | DeepSeek v4.1 Flash | MiniMax | GLM (Oct 21) |
| --- | ---: | ---: | ---: | ---: |
| Correctness | 25% | 3 | 3 | 1 |
| Spec fidelity | 20% | 7 | 7 | 3 |
| Netcode | 15% | 7 | 3 | 3 |
| Security / anti-cheat | 15% | 6 | 6 | 4 |
| Code quality | 15% | 7 | 6 | 4 |
| Test depth | 10% | 5 | 6 | 5 |
| **Weighted score /10** | | **5.65** | **5.00** | **3.00** |

**Why DeepSeek wins this batch:** its authoritative-state restoration and
ranked/account integration are substantially more coherent. MiniMax completes
a visible match and ships more delivery artifacts, but its predictor can ignore
the server, later-round inputs are rejected, and one ranked pairing creates two
matches. GLM has substantial backend code behind an unstarted client.

These scores place DeepSeek between the SOL estimates for Kimi K3 (**5.80**) and
Grok 4.6 (**5.40**), MiniMax between Grok 4.7 default (**5.20**) and Grok 4.7
xhigh (**4.90**), and GLM below the SOL bottom-tier estimates. The comparison is
across evaluators, not a freshly validated nineteen-way ranking.

**Follow-up:** the [independent historical-score review](SCORE-REVIEW.md) finds
uneven calibration in those older numbers. The numerical placements above should
not be interpreted as equivalent-standard quality gaps.

## Checks actually run

Same machine and **Node v23.7.0**, fresh dependency installs, rebuilt from source.

| Check | DeepSeek | MiniMax | GLM |
| --- | --- | --- | --- |
| `npm install --no-audit --no-fund` | Pass | Pass | Pass |
| `npm test` | **17/17** | **34/34** | **23/23** |
| `npm run build` | Pass, includes typecheck | Pass | Pass |
| `npm start`, `/health` | Pass | Pass | Pass |
| Homepage on server port | **200** | **200** | **404** |
| Browser guest/menu/live match | Yes, round 1 loads | Yes, round 1 loads | No; dev mode also blank |
| Full idle-human browser practice | Reached round 5; **180s observation limit** | **Completed in 156s**, results +35 XP | Unreachable |
| Supplemental production-room bot match | Completed, 3 rounds | **12/12 completed** | Not evaluated |
| Ranked duel → disconnect → rating update | **1032 / 968 persisted**, API + leaderboard verified | Normal forfeit emits **1032 / 968**; duplicate-match defect | Backend socket test: **1032 / 968**, API + leaderboard verified |
| Twenty malformed-message cases | Health survived 20/20 | Health survived 20/20 | Health survived 20/20; one case throws globally |
| Shipped `npm run soak` | **Fails: missing script** | Real-time run stopped after 120s in round 2; **inconclusive** | **Fails: missing script** |

The observation limits are **not** evidence of nontermination. DeepSeek's browser
match was still receiving snapshots. MiniMax's shipped soak allows up to 15
minutes **per match**; its two-minute run does not establish a soak failure.
The accelerated MiniMax probe calls the shipped `Room.tick()` with a virtual wall
clock; DeepSeek probes call the shipped sim/bot and, separately, the production
`Room.tick()`. These supplement rather than replace browser checks.

## 1. DeepSeek v4.1 Flash — 5.65/10

Source: [`results/deepseek-v4.1-flash/`](../results/deepseek-v4.1-flash/).
Paths in this section are relative to that directory.

### What works

- Fresh account, title → tutorial Skip → menu → live four-player practice.
- A real predictor reconstructs authoritative players, balloons, splashes,
  power-ups and tide, then replays unacknowledged inputs:
  `packages/client/src/prediction.ts:133-161`.
- Ranked duel pairing, 15-second disconnect handling, XP, match history and
  leaderboard integration work in the socket test. Profile API reports the
  winning player's persisted **1032** rating and a **1000 → 1032** match row.
- Integer/direction validation, 4 KiB WebSocket payload bound, rate limiting,
  token hashing and parameterized SQLite queries. The twenty malformed probes
  left the server healthy.

### Important defects

1. **Bots find tile paths they cannot physically follow, then soak themselves.**
   `packages/server/src/bots/bot.ts:395-405` removes a waypoint as soon as the
   player's floored position enters its tile. The body can still be off-center;
   the next perpendicular move collides with a pillar. The escape trace for seed
   1 sticks Hard at **(1.6333, 1.9)** from tick 30 through tick 103, repeatedly
   requesting right movement, then its own balloon soaks it.

   In 24 fixed-seed duel rounds with Hard in slot 0, Hard wins **1/24** and every
   round ends with an own-splash death. **Reversing the slots matters:** Hard wins
   **17/24**. Combined, Hard wins **18/48 (37.5%)**, below the spec's reliable
   superiority requirement. This is a fixture result, not a population estimate.
   One complete production-room match also ends **Easy 3, Hard 0**.

2. **Exposed power-ups survive a later burst.**
   `packages/shared/src/sim.ts:381-383,439-452` records preexisting power-ups, then
   destroys an exposed item only when its tile is **absent** from that set. A probe
   puts an exposed Extra Balloon at (3,3) and detonates a balloon on it: the splash
   exists through tick 13, but the item survives. This reverses the spec's rule.

3. **Hidden loot is recoverable from the public seed.**
   `packages/server/src/rooms.ts:706-707,742-757` sends the same seed used by
   `packages/shared/src/map.ts:92-159` for both terrain and hidden contents.
   Running the public generator reproduces the loot; omitting `hidden` from
   snapshots provides no secrecy.

4. **Remote smoothing falls short of the requested netcode.**
   `packages/client/src/screens/game.ts:340-355` exponentially smooths toward
   current snapshot-derived positions. It does not keep the specified timestamped
   interpolation buffer at `serverTime − 100ms`. Local reconciliation deserves
   credit; the full latency requirement was not verified.

5. **Delivery is incomplete.** `package.json:18` references
   `scripts/soak.ts`, absent from the archive. There is also no Dockerfile or
   README. The 17 passing tests cover useful sim/Elo invariants but exercise
   neither bot escape execution nor browser/server integration.

## 2. MiniMax — 5.00/10

Source: [`results/minimax/`](../results/minimax/).
Paths in this section are relative to that directory.

### What works

- A real browser practice match completes through all three rounds, displays
  placements and awards **35 XP**. It is the only submission in this batch whose
  full browser match completed within the observation window.
- Useful shared sim, **34 passing tests**, procedural sprite/audio code, room
  browser, cosmetics, settings, Dockerfile, README, and a supplied integration
  script. The supplied integration script was inspected; this evaluation uses
  the separate recorded socket probes rather than claiming that script passed.
- Twelve deterministic supplemental bot-room matches complete; Hard wins all
  twelve in this fixed sample. Bots do place balloons.
- WebSocket handler and room-loop exceptions are caught. All twenty malformed
  probes leave `/health` working.

### Important defects

1. **Reconciliation can restore a client history entry without applying the
   authoritative snapshot.** `packages/client/src/prediction.ts:139-175` clones
   local history whenever an eligible entry exists. Only the no-history branch
   calls `stateFromSnapshot()`. A probe gives it an authoritative position
   **(9,7)** with an existing tick-1 history entry; the result stays **(1,1)**.
   It then replays history and pending inputs. This undermines the authority
   correction at the heart of the required netcode.

2. **New rounds reset the client sequence, but not the server slot sequence.**
   `packages/client/src/prediction.ts:105-111` resets to zero;
   `packages/server/src/rooms.ts:398-415` does not reset `slot.lastSeq`.
   `rooms.ts:559-567` rejects inputs at or below that retained value. After
   starting round 2 with a previous sequence of 600, the probe's new `seq:1`
   is rejected. Normal controls must wait for the client counter to catch up.

3. **One ranked pairing starts two distinct matches.**
   `packages/server/src/matchmaker.ts:138` calls every participant's callback;
   each callback creates and starts a whole room in
   `packages/server/src/index.ts:374-396`. Both clients receive **two distinct
   `match_found` room IDs, two `match_start`s, and two `round_start`s**. This was
   observed on both network-probe runs.

4. **Reconnect does not restore the match.** The `hello` handler at
   `packages/server/src/index.ts:190-222` welcomes the account but does not reattach
   its reserved room slot or send match/round/snapshot state. Browser reloads
   return to the title. A replacement ranked socket receives only `welcome` and
   `ping`, including after the other player disconnects. A separate **no-reconnect**
   forfeit test does produce the expected +32/−32 rating payload.

5. **Ranked FFA starts with only two humans.**
   `packages/server/src/matchmaker.ts:108-132` sets the minimum to two for both
   modes. A two-account FFA queue starts immediately with two empty roster slots,
   reproducing a direct violation of the required four-human mode.

6. **Gameplay rules diverge.**
   - Lingering splashes are explicitly visual-only in
     `packages/shared/src/sim.ts:580-590`. A player standing inside an active
     nine-tick splash remains alive in the probe.
   - `packages/shared/src/map.ts:147` skips loot when `rng() < 0.30`, producing a
     **70%** drop probability instead of 30%.
   - `packages/shared/src/sim.ts:314-319` awards round wins on a draw. The full
     browser match records a drawn round that increments **both** players' scores.
   - `beginRound()` preserves speed/range/balloon upgrades; the probe retains
     **7 speed, 10 range, 8 balloons** into a fresh round.
   - Bot brains are not reset between rounds. Their previous-round decision tick
     can make them idle well into the next round. In the twelve-match probe,
     first movement in round 2 ranges from tick **209 to 1881**. Across 41 rounds,
     **11 own-splash deaths** are recorded.

7. **Public seed leaks loot.** `packages/server/src/rooms.ts:401-414` broadcasts
   the seed consumed by `packages/shared/src/map.ts:95-153` for both layout and
   contents. Clearing the client's predicted contents does not prevent recovery.

## 3. GLM (October 21 archive) — 3.00/10

Source: [`results/glm-oct21/`](../results/glm-oct21/).
Paths in this section are relative to that directory.

### What works

The backend boots, runs migrations, serves `/health`, and passes 23 shared tests.
A raw-socket ranked duel starts and a disconnect updates ratings to **1032 / 968**;
the leaderboard reflects those values. This is meaningful backend work.

### Blocking and important defects

1. **The client never boots.** `packages/client/src/main.ts:159-219` defines and
   exports `boot(canvas, net)`, but neither that file nor the HTML entry calls it.
   No application `Net` is instantiated or connected. Vite builds a **752-byte JS
   asset** because the unused game code is tree-shaken. In dev mode, Enter does
   nothing and **all canvas pixels remain zero**. The only observed WebSocket is
   Vite's HMR connection, not a game connection. This is a blank page without a
   thrown browser exception.

2. **The production server does not serve the client.**
   `packages/server/src/index.ts:438-459` only enables static hosting when a
   `staticDir` argument is supplied; its executable entry passes none. The shipped
   `npm start` returns **404 / Cannot GET /** despite a successful client build.

3. **Default keybind lookup is reversed.**
   `packages/client/src/main.ts:15-32` defines **code → action**, while
   `actionFor()` and `isDown()` at lines 94-105 expect **action → code**.
   This is a latent source defect behind the missing boot, not a separately
   browser-reproduced gameplay failure.

4. **Validation permits exceptions and rejects legitimate pong messages.**
   `packages/server/src/net.ts:64-67` checks room size but not the name type.
   Sending `{t:"create_room",opts:{size:4,name:12}}` triggers
   `TypeError: (msg.opts.name ?? "").slice is not a function`. The global
   `uncaughtException` listener at `index.ts:453-455` keeps the process alive;
   this was **not a process-kill result**. At `net.ts:88-90`, the pong branch
   requires `m.t` to be a number even though that branch requires `m.t === 'pong'`,
   so a legitimate pong cannot validate.

5. **Loot secrecy and delivery are incomplete.**
   `packages/server/src/rooms.ts:567-569` publishes the seed;
   `packages/shared/src/map.ts:38-83` derives hidden contents from it.
   `npm run soak` references a nonexistent `scripts/soak.ts`; the archive also
   lacks a Dockerfile and README.

## Evidence and reproduction

- Build/test/soak logs: [`logs/deepseek-v4.1-flash.log`](logs/deepseek-v4.1-flash.log),
  [`logs/minimax.log`](logs/minimax.log), [`logs/glm-oct21.log`](logs/glm-oct21.log).
- Browser journey + reconnect frames: [`logs/oct21-browser.json`](logs/oct21-browser.json).
- Full-match observations: [`logs/oct21-fullmatch.json`](logs/oct21-fullmatch.json).
- Ranked, reconnect, FFA and malformed frames: [`logs/oct21-network.json`](logs/oct21-network.json).
- Deterministic sim/bot/prediction probes: [`logs/oct21-probes.json`](logs/oct21-probes.json).
- Screenshots: [`screenshots/`](screenshots/), prefixes matching the submission
  names above. **Screenshots were captured but could not be visually inspected
  by this evaluator.** No comparative visual-polish score is asserted.

```bash
# From the repository root; install/build each submission first.
python3 comparison/harness/ingest-oct21.py --verify
python3 comparison/harness/start-oct21.py
node comparison/harness/browser-oct21.mjs
node comparison/harness/network-oct21.mjs
node comparison/harness/fullmatch-oct21.mjs
./results/deepseek-v4.1-flash/node_modules/.bin/tsx comparison/harness/probe-oct21.ts
python3 comparison/harness/start-oct21.py --stop
```

Browser harnesses accept `PLAYWRIGHT_MODULE` pointing to an installed
`playwright-core` module. The default points to the evaluator's local install.
Ports are 4317–4320; SQLite data is isolated under the approved temporary folder.
The full-match harness intentionally does not issue movement or balloon inputs.
Tutorial **Skip** was tested; completing every tutorial objective, 150ms-latency
acceptance, Docker deployment, and the full two-human/two-bot casual acceptance
flow were not certified.

### Archive integrity

Imported source files are byte-identical to the archive entries, verified after
testing. `npm install` changed two lockfiles; both were restored from the supplied
archives before the final integrity check. No submitted game source was patched.
Dependencies, built output, databases, macOS metadata and DeepSeek's screenshot
`tmp/` folder were excluded. MiniMax's archive also contains a nested DeepSeek
directory and ZIP; these packaging artifacts were excluded from MiniMax's entry.

| Archive | SHA-256 | Imported files |
| --- | --- | ---: |
| `minimax.zip` | `8ffad2cbe02ed3ecc795d65e11d802ef1e0671dfbcdd98ce56b33308f402ef55` | 63 |
| `deepseekv4.1flash.zip` | `2ae6f322f984bb13cfdc4c708e74a1c3644f181eb3999b748eb66a722385eaa0` | 57 |
| `GLM.zip` | `c1af1b9ac9fe3c976738d60eafca9aeeee01ef7cf79c8ef346a8b139608bc04a` | 43 |
