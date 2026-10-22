# Independent review of the historical scores

**Verdict: the broad tiers are credible, but several original scores are too
high for the game actually delivered. Here are my exact point estimates.**

Reviewed on October 21, 2026 by GPT-6.1 SOL through OpenCode. I read all sixteen
historical audit reports, their appended fact-checks, the ranking synthesis, and
selected source. I rebuilt and reran the unit suites for five entries and
independently exercised several ranking-critical defects. This is a score
calibration review with targeted reproduction, not sixteen fresh full audits.

## My assessment of each score

These are **exact point estimates**, rather than claims of mathematical
precision. They are my direct replacement scores under the same six-dimension
weighting, after the targeted rechecks below. This was not a fresh full
sixteen-way audit.

| Historical entry | Published | SOL point estimate | Assessment |
| --- | ---: | ---: | --- |
| Fable 5 | 8.45 | **7.80** | Top tier, but recoverable loot, flaky bot-strength gating and long tide-draw matches prevent a near-9 score. |
| GPT-6 Astra | 8.35 | **7.50** | Strongest loot-isolation design, but a reproduced room-exhaustion attack kills the entire server. |
| Opus 5.5 | 8.30 | **7.80** | Strongest overall engineering candidate; reconnect ordering and very long bot matches remain real shipped defects. |
| Opus 5 | 7.75 | **6.40** | Excellent internals, but ordinary matches lose round 1. That is too severe for a nearly-8 shipped game. |
| Opus 4.8 ultracode | 7.40 | **6.80** | Coherent and playable, but a one-message process kill plus free loot disclosure are major delivery defects. |
| GPT-5.6 SOL xhigh | 7.00 | **6.30** | Good foundation, but default production hosting fails and real-loop bots crawl. |
| Kimi K3 | 6.70 | **5.80** | Casual foundation works; default Space, ranked forfeit and drawn-duel rating flows are broken. |
| Grok 4.7 default | 6.30 | **5.20** | Strong netcode and typing cannot compensate for bots that never place balloons. The alleged hello-race crash is refuted. |
| Grok 4.5 | 6.18 | **5.80** | Playable with real prediction, but remote crashability, draw handling and fake ping are substantial. |
| Grok 4.6 | 5.80 | **5.40** | Better sim decisions, but weaker netcode and unchanged seed, reconnect and crash flaws. |
| Grok 4.7 xhigh | 5.60 | **4.90** | Bots fight, but first-run tutorial freeze, multiple kill vectors, free loot and fake ping make it worse than the published score. |
| 0x alpha | 4.40 | **3.90** | Strong isolated sim, but normal online gameplay never mounts. |
| GLM 5.2 | 3.60 | **3.30** | Collision and authoritative-map integration are broken. |
| Kimi K2.7 | 3.60 | **2.80** | First legitimate connection crashes the server and ranked remains unreachable. |
| Muse Spark 1.3 | 3.20 | **2.80** | Runs, but own-balloon collision can trap humans and bots; server kills and input pacing are broken. |
| Kimi K2.6 swarm | 3.20 | **2.40** | Boot crash, absent snapshots, inert buttons and unintegrated modules. |

### Ordering I would defend

- **Leading group: Opus 5.5 and Fable 5**, with different liabilities; Astra is
  also clearly in the strongest group, with a serious availability defect.
- **Opus 4.8 above Opus 5** when judging the normal playable journey. Choosing
  between them on adversarial robustness is a different tradeoff: 4.8 is remotely
  crashable, while 5 loses ordinary round-1 play.
- Grok 4.7 default's dead bots deserve a larger gameplay penalty. Its exact
  placement relative to xhigh is tradeoff-sensitive, because xhigh fixes the bots
  while breaking first-run and server robustness.
- The bottom group is convincingly weak. There is little value in treating a
  3.20 versus 3.60 distinction as a robust model ranking.

## What I independently reran

### Builds and unit suites

Using existing installed dependencies, `npm run build` then `npm run test`:

| Entry | Build | Unit tests |
| --- | --- | ---: |
| Fable 5 | Pass | 28/28 |
| GPT-6 Astra | Pass | 22/22 |
| Opus 5.5 | Pass | 774/774 |
| Opus 5 | Pass | 103/103 |
| Grok 4.7 default | Pass | 8/8 |

Logs: [`score-review-checks.json`](logs/score-review-checks.json) and the
`score-review-<entry>.txt` files in [`logs/`](logs/).

### First-round and reconnect listener ordering

The browser probe observes the real WebSocket frames and the handler Map's
`round_start` lookup/registration, without editing application source.

- **Opus 5:** normal Practice receives `match_start` and `round_start`, but the
  latter dispatch finds **no handlers**. The game listener registers afterward.
  At 12 seconds, 180 snapshots have arrived and the server is playing at tick
  360. This reproduces the mechanism that leaves `roundStarted` false
  (`packages/client/src/screens/game.ts:100-101`) and holds the intro card.
  Observed on all three browser-probe runs in this review.
- **Opus 5.5:** ordinary first-round startup subscribes in time. For eight actual
  document reopens, alternating bare root and `#/menu` with unique query strings,
  **six lose `round_start` and two receive it**. Thus the historical race is real,
  but its frequency is timing-dependent. This review does not claim a universal
  6/6 failure rate. The observation is dropped initialization, supported by the
  source; screenshots were captured but not visually inspected.

Evidence: [`score-review-browser.json`](logs/score-review-browser.json),
[`review-historical-browser.mjs`](harness/review-historical-browser.mjs).

### Astra's remote process kill

An isolated server starts normally. One guest creates and leaves **200 rooms**
at a bounded rate while answering heartbeats. `/health` reports `rooms:200`.
Two guests set nicknames and queue ranked Duel. The interval calls
`Rooms.create()` at capacity; Node exits and `/health` stops answering.

Source confirms the path: `results/gpt-6-astra/packages/server/src/rooms.ts:100-101`
throws, called by the unguarded matchmaking timer at `matchmaker.ts:15,94`.
This is more than a missing defensive handler or a hypothetical resource risk.
An initial probe omitted pong replies and hit the heartbeat timeout at 150 rooms;
the recorded result is the corrected, restarted run.

Evidence: [`score-review-network.json`](logs/score-review-network.json),
[`score-review-server-gpt-6-astra.txt`](logs/score-review-server-gpt-6-astra.txt).

### Grok 4.7's alleged concurrent-hello crash

**Refuted as described.** Ten groups of six simultaneous same-token connections
yield **60 welcomes**, one account identity per group, and a healthy server.
The token lookup and better-sqlite3 transaction are synchronous; there is no
asynchronous gap between lookup and insertion in this handler.

The existing audit's own fact-check already refutes this at
[`audits/grok-4.7.md:82`](audits/grok-4.7.md), yet the ranking synthesis still
calls it a crash. The independent resource-degradation finding remains relevant.

Evidence: [`score-review-network.json`](logs/score-review-network.json),
source `results/grok-4.7/packages/server/src/index.ts:103-109` and
`db/index.ts:61-85`.

### Loot checks

- Reran `attack-seed-recovery.mjs` against rebuilt Fable 5. It recovered seed
  **82488203** from the grid and reproduced **all 26 hidden items** in 5.5 s.
  This run happened to draw a small key; the time is not a new worst-case or
  average cracking benchmark.
- Reran `attack-astra-loot.mjs`: identical layouts with independent per-tile
  secrets produce different contents; guessing the derivable default matched
  only **2 of 18** hidden items by exact kind and location in this sample.
- Reran `attack-opus55-content.ts`: **1.55 attacker hits/map versus 1.48 control**
  over 400 maps. It demonstrates layout/content separation for that guess.

These checks support the practical distinction between seed-sharing designs and
independent loot designs. They do **not** prove that every possible inference
attack against Opus 5.5's SFC32 stream is impossible.

Recorded outputs: [`score-review-loot.json`](logs/score-review-loot.json).

## Why I disagree with the published calibration

1. **Scores compensate too readily for unusable gameplay.** Correctness is only
   25% of the weighted total. With the other dimensions at 10, Correctness 3 can
   still yield **8.25 overall**. Feature/code inventories deserve credit, but
   the resulting number should not be described as a shippability score without
   separately marking acceptance failures. Opus 5 at 7.75 is the clearest example.

2. **Security penalties are uneven.** Astra receives Security 8 despite a
   demonstrated all-room process kill; Opus 4.8 receives 3 for a cheaper
   process-kill input plus a seed leak. Exploit effort and loot secrecy matter,
   but the same availability impact is treated very differently. Conversely,
   absence of a global `uncaughtException` listener is not itself a defect:
   proper local validation and error isolation matter more than swallowing a
   process-level exception and continuing.

3. **The leading margin rests on soft judgments.** Fable gets Test Depth 9,
   Astra 8, and Opus 5.5 8.5. More tests alone do not imply better tests, but the
   audits document meaningful integration and negative-path coverage in the
   later entries. These marks do not establish that Fable deserves an exact
   0.10-point lead. Nor are these subjective totals a **"statistical tie"**:
   no statistical model or error estimate defines that statement.

4. **Refutations and updates were not consistently propagated.** Grok's hello
   race remains in the synthesis after being refuted. Fable's raw audit still
   says its loot is underivable, though the synthesis later correctly lowers
   Security to 7. The SOL audit's supposed 500-line spec cap was refuted by its
   fact-check; no such requirement appears in the original task specification,
   yet the cap still appears as a spec claim elsewhere in the synthesis.

5. **Some security conclusions overstate the proof.** Opus 5.5 uses an
   independently generated 128-bit key but feeds a non-cryptographic SFC32 PRNG.
   The argument "average reveal entropy < key bits, therefore never recoverable"
   is insufficient: average entropy is not a worst-case information bound, and
   predicting an output need not require identifying the original key. This
   review found no practical SFC32 loot exploit. The defensible statement is
   **separate secret stream; tested layout-seed guess fails**, rather than a
   proof of universal unguessability. Astra's per-tile independent secrets have
   a stronger isolation argument.

6. **The conclusions concern these artifacts, not model families generally.**
   Different tools, orchestration, memory, dates and sampling conditions are
   disclosed. They make broad claims such as "higher effort makes a worse game"
   unsupported beyond the specific pair of submitted builds.

## Relation to the three new scores

I retain **DeepSeek > MiniMax > the new GLM** on the evidence from their full
batch evaluation. However, it would be misleading to read DeepSeek's 5.65 beside
Kimi K3's SOL estimate of 5.80 as a precisely calibrated 0.15-point quality gap.
The older scores are generally more generous about code/features behind broken
integration. The three new scores and these historical point estimates are more
consistent with my assessment of the delivered game, but a replacement
nineteen-way exact scoreboard would require the same acceptance harness and
grading anchors for all.

### Reproduce the targeted checks

```bash
python3 comparison/harness/review-historical.py checks
python3 comparison/harness/review-historical.py start
node comparison/harness/review-historical-browser.mjs
node comparison/harness/review-historical-network.mjs
python3 comparison/harness/review-historical.py stop
```

The network probe deliberately terminates its isolated Astra process. Ports
4410–4414 and temporary SQLite directories are reserved for these checks.
Original source and historical evaluation logs were preserved.
