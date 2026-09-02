# Splash Critters — one prompt, twelve AI coding agents

An experiment: give twelve frontier LLM coding setups the **same ~200-line spec** —
build a complete, shippable 8-bit online multiplayer water-balloon battler
(deterministic shared sim, server-authoritative netcode, bots, ranked Elo,
SQLite, lobby browser, cosmetics, procedural pixel art) — and compare what
comes back, untouched.

The full prompt is in [`prompt.md`](prompt.md). Each agent's output is
committed verbatim under [`results/`](results/) (only `node_modules/`, build
output, and database files were stripped).

> **Disclosure:** this comparison README was compiled by **Claude Fable 5 —
> one of the contestants.** Every claim below comes from a scripted,
> reproducible check (harness + raw logs + screenshots are in
> [`comparison/`](comparison/)), and the one evaluation mistake made along the
> way (which initially made *both Kimi builds look broken when they weren't*)
> is documented in the Methodology section. Judge for yourself.

## Contenders

| Folder | Setup |
| --- | --- |
| [`results/fable-5/`](results/fable-5/) | **Claude Fable 5** (Claude Code, single agent) |
| [`results/glm-5.2/`](results/glm-5.2/) | **GLM 5.2** (zcode) |
| [`results/kimi-k2.7/`](results/kimi-k2.7/) | **Kimi K2.7** (opencode) |
| [`results/kimi-k2.6-agent-swarm/`](results/kimi-k2.6-agent-swarm/) | **Kimi K2.6 agent swarm** (multi-agent; its own `plan.md`/`SPEC.md` orchestration artifacts are included) |
| [`results/grok-4.5/`](results/grok-4.5/) | **Grok 4.5** (added to the experiment two weeks after the first four; same prompt, same gauntlet) |
| [`results/kimi-k3/`](results/kimi-k3/) | **Kimi K3** (added alongside Grok 4.5; re-submitted — the first upload was an incomplete agent run, see Methodology) |
| [`results/opus-4.8-ultracode/`](results/opus-4.8-ultracode/) | **Opus 4.8 (ultracode)** (Claude Opus 4.8 running multi-agent "ultracode" orchestration; added 2026-07-19) |
| [`results/gpt-5.6-sol-xhigh/`](results/gpt-5.6-sol-xhigh/) | **GPT-5.6 SOL (xhigh)** (OpenAI GPT-5.6 "SOL" at xhigh reasoning effort; added 2026-07-20) |
| [`results/opus-5/`](results/opus-5/) | **Claude Opus 5** (added 2026-07-24; audited under three passes — neutral, adversarial, steelman) |
| [`results/grok-4.6/`](results/grok-4.6/) | **Grok 4.6** (xAI; added 2026-08-12; direct successor to the Grok 4.5 entry) |
| [`results/0x-alpha/`](results/0x-alpha/) | **0x alpha** (added 2026-08-22) |
| [`results/muse-spark-1.3/`](results/muse-spark-1.3/) | **Muse Spark 1.3** (added 2026-09-02) |

## Code audit & rankings

Beyond "does it run," every codebase got a deep **independent code audit** (one
Claude Fable 5 subagent each, same six-dimension rubric, every claim cites
`file:line`). Full reports in [`comparison/audits/`](comparison/audits/),
synthesis + methodology in
[`comparison/AUDIT-RANKINGS.md`](comparison/AUDIT-RANKINGS.md).

> **⚠️ Conflict of interest:** Three entries are Claude-family (Fable 5, Opus 5,
> Opus 4.8), and Fable 5 both wrote one of them and ran the comparison — then
> ranked itself #1. **The Opus 5 audit produced a correction against the
> orchestrator:** its adversarial auditor showed that omitting the map seed
> isn't enough, because the transmitted castle grid pins the seed by brute force
> (~76s for Opus 5). Running that same attack on Fable 5's own code broke it in
> **21.8s** — half the keyspace — so Fable 5's Security score was cut 8 → 7 and
> its total 8.60 → 8.45. The remaining #1-vs-#2 gap is one fact: Opus 5's client
> sits on the VS card for the whole of round 1 of every match (reproduced 5× in
> a real browser). Verify both yourself —
> [`harness/attack-seed-recovery.mjs`](comparison/harness/attack-seed-recovery.mjs)
> and a single "Practice vs bots" click.

| Rank | Model | Weighted score /10 | One-line |
| :-: | --- | :-: | --- |
| 🥇 1 | **Fable 5** † | 8.45 | No fatal bug, working ranked-Elo path — but its "hidden" power-ups fall to a 21.8s brute force, plus a flaky Hard bot |
| 🥈 2 | **Opus 5** ¶ | 7.75 | Best engineering in the field (103 tests, 47 hostile frames survived, no seed on the wire) — but the client loses round 1 of every match |
| 🥉 3 | **Opus 4.8 (ultracode)** ‡ | 7.40 | Excellent, playable, cleanly integrated — but leaks the real map seed AND one malformed packet crashes the whole server |
| 4 | **GPT-5.6 SOL (xhigh)** ‡ | 7.00 | Playable, robust, clean — but leaks the seed, bots crawl in production, and `npm start` 404s without `NODE_ENV=production` |
| 5 | **Kimi K3** | 6.70 | Playable — but ranked duels can draw (killing Elo), forfeit is dead code, and the default Space key can't drop a balloon |
| 6 | **Grok 4.5** | 6.18 | Real netcode, playable — but a malformed WS frame crashes the server, and the HUD ping is fake |
| 7 | **Grok 4.6** ‡ | 5.80 | Fixes two of 4.5's bugs (draw handling, bot self-soak) but audits *below* it: weaker netcode, still leaks the seed, still one-packet-crashes, still fake ping |
| 8 | **0x alpha** ‡ | 4.40 | Strong sim + 26 tests + survives fuzzing + playable *offline* tutorial — but the server never sends `match_start`, so online play freezes on the lobby |
| 9 | **GLM 5.2** | 3.60 | Renders a match, but it's a hologram: players phase through walls and the client is never sent the real map |
| 10 | **Kimi K2.7** | 3.60 | Deterministic core, but the server crashes on the first connection and ranked never starts |
| 11 | **Muse Spark 1.3** ‡ | 3.20 | Actually runs through round 2 — but every bot suicides in ~3s (the soak says PASS), five one-packet crashes, seed leaked, clients pick their own credentials, and the server rate-limits its own player's inputs |
| 12 | **Kimi K2.6 swarm** | 3.20 | Textbook swarm failure: competent modules never wired together — crashes at boot, never sends snapshots, no mouse handling |

† Fable 5 audited under the harsher adversarial framing; ‡ Opus 4.8 and SOL under
neutral framing + an extra verifier; ¶ Opus 5 under three passes (neutral,
adversarial, steelman) — the neutral pass missed the round-1 bug the adversarial
pass caught. Scored on correctness (25%), spec fidelity (20%), netcode (15%),
security (15%), code quality (15%), test depth (10%).

**The headline finding: all twelve entries fail the spec's "unguessable,
unhackable" power-up requirement — they just fail at different prices.** Ten
broadcast the real seed (free, instant recovery). Opus 5 omits it and Fable 5
sends a decoy, but both still ship the castle grid, which pins the seed by brute
force: ~76s for Opus 5 (2³²) and **21.8s for Fable 5** (2³¹). Nobody rolled the
contents from an independently seeded PRNG. **A second near-universal flaw:** one
malformed packet crashes the server for **six** of them (K2.7, K2.6, Opus 4.8,
*both* Groks, and Muse Spark — which has five distinct vectors); only Fable 5,
SOL, Opus 5 and 0x alpha validate inputs well enough to survive it. The common thread: every model's shared sim is
strong, and the games break at the *integration seams* — a SQL string, a circular
import, an event emitted to no one, a numeric `hello` token, a key bound `'Space'`
but read `' '`, a `pendingInput` deleted a tick too early, a `hashchange` that
lands one task too late — which is exactly where each model's own tests don't look.

## Scoreboard

Same machine (macOS, Node 23), same gauntlet for everyone
([`comparison/harness/evaluate.sh`](comparison/harness/evaluate.sh)):
`npm install` → `npm test` → `npm run build` → `npm start` → `/health` →
client served → headless browser probe.

| Check | Fable 5 | GLM 5.2 | Kimi K2.7 | K2.6 swarm | Grok 4.5 | Kimi K3 | Opus 4.8 | SOL xhigh | Opus 5 | Grok 4.6 | 0x alpha | Muse Spark 1.3 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `npm install` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `npm test` (own suite) | ✅ 28 tests | ✅ 12 tests | ✅ 7 tests | ✅ 26 tests | ✅ 14 tests | ✅ 18 tests | ✅ 22 tests | ✅ 7 tests | ✅ 103 tests ¹ | ✅ 16 tests | ✅ 26 tests | ✅ 11 tests |
| `npm run build` | ✅ | ✅ | ✅ ¹ | ✅ ¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Server boots, `/health` OK | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Built client served on one port | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ needs NODE_ENV=prod ¹⁰ | ✅ | ✅ | ✅ | ✅ |
| **Client loads in a browser** | ✅ | ✅ | ✅ | ❌ crashes on load ² | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A player can actually connect** | ✅ | ✅ | ❌ server crashes ³ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Full match playable vs bots** | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ ¹¹ | ⚠️ round 1 invisible ¹² | ✅ | ❌ no match_start ¹³ | ⚠️ bots suicide ~3s ¹⁴ |
| Bot-vs-bot soak script | ⚠️ flaky ⁴ | ✅ ⁵ | ✅ ⁵ | ❌ broken ⁶ | ✅ ⁵ | ✅ ⁵ | ✅ skill-asserting ⁹ | ⚠️ passes but masks a bug ¹¹ | ✅ 4 scenarios | ✅ skill-asserting | ❌ mis-wired ¹³ | ⚠️ passes, certifies broken bots ¹⁴ |
| E2E acceptance script included | ✅ passes | — | — | — | — | ⚠️ ranked section fails ⁸ | — | — | — | — | — | — |

¹⁴ **Muse Spark 1.3:** `dangerMap.ts:85` marks a tile safe when the burst is
more than 22 ticks away, so with a 90-tick fuse every bot difficulty places a
balloon and stands on it (Hard 0/12 vs Easy; an idle human beat three Medium
bots 8/8 in ~3-second rounds). The shipped `soak.ts` asserts completion only, so
it reports PASS. Separately, the client sends inputs from a
`requestAnimationFrame` loop (`game.ts:167-179`) against a 60/s server cap
(`config.ts:87`), so the server discards the player's own inputs as `rate_limit`
errors — observed 9 in one short match, worse on 120Hz displays.

¹³ **0x alpha:** the server plays the match (round_start → events → round_end
stream on the wire) but **never emits `match_start`**, which is the client's
only entry into gameplay (`main.ts:150-152`), so online play freezes on the
lobby (reproduced firsthand). Its `npm run soak` is also mis-wired — it runs
`node dist/soak.js` but the server tsconfig sets `noEmit:true`, so no `dist/`
is produced and the script fails `MODULE_NOT_FOUND` (only `tsx` works). Its
*offline* tutorial renders and plays fine.

¹² **Opus 5:** `router.ts:69-77` navigates via `location.hash` and relies on an
async `hashchange`, so the game screen mounts one task *after* the server's
back-to-back `match_start`/`round_start`; `round_start` hits an empty handler set
and is buffered nowhere, so the VS card never clears. Reproduced 5×: at t+60s the
server is `phase:"playing"` streaming events while the client still reads "GET
READY"; it recovers exactly at round 2 (`R2/3`). The player is bombed blind for
all of round 1 in Practice/Casual/Ranked; the tutorial is immune. One-line fix.

¹ Both Kimi zips **and the Opus 5 zip** shipped **prebuilt `dist/` folders plus stale
`tsconfig.tsbuildinfo`** files. After stripping `dist/` (as this repo does),
the stale buildinfo makes `tsc` no-op ("already built") and `npm run build`
fails. Deleting the buildinfo files — i.e., building from genuinely clean
sources — both builds pass. Opus 5 hit the same artifact: stripping its shipped
`packages/shared/dist` made `npm test` unable to resolve `@splash/shared` (5 of 9
files errored); after `npm run build`, **all 103 tests pass**. The scoreboard
shows the clean-source result in every case.

² **K2.6 swarm:** the client throws
`ReferenceError: Cannot access 'DEFAULT_SETTINGS' before initialization`
(a circular-import TDZ bug) the moment the page loads — in the production
bundle *and* in Vite dev mode. No canvas ever mounts. The likely
multi-agent failure mode: modules written by parallel agents that never got
integration-tested together.

³ **Kimi K2.7:** the server process **crashes on the very first client
`hello`**: `SqliteError: incomplete input` from
`INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at)` — two of
the three default-unlock inserts are missing their `VALUES (?, ?, ?)`
clause. One missing SQL fragment, and no player can ever connect (there is
no error handling around it, so the whole process dies). Its soak test
passes because it bypasses the network/DB layer entirely.

⁴ **Fable 5's soak is skill-asserting** (Hard bots must beat Easy in ≥70% of
duels), not just crash-freedom — one of only two that check skill (Opus 4.8's
is the other, footnote 9), but unlike Opus's it is *flaky*. Across 6 recorded runs the Hard-vs-Easy score was 9/10,
10/10, 6/10, 7/10, 6/10, 6/10 — i.e. it **failed its own bar half the
time**. Honest reading: Hard reliably *outperforms* Easy (~70% duel win
rate) but "reliably beats" at a 70% threshold is marginal. Logged as-is.

⁵ GLM's, K2.7's, Grok 4.5's, and K3's soak scripts assert only that
matches complete without crashing — no bot-skill assertion. (K2.7's duel
soak logs `winner: null`; K3's is the most thorough of these, covering
several scenarios including a revenge-duck match.)

⁶ **K2.6 swarm:** a soak script exists at `scripts/soak-test.mjs` but was
never wired into `npm run soak` and crashes immediately (it imports `.js`
paths that only exist as TypeScript source).

¹⁰ **SOL's** `attachStatic` only runs when `NODE_ENV=production` (or `PRODUCTION=1`
/ `CLIENT_DIST` set), but the shipped `npm start` is bare `node dist/index.js`, so
`npm run build && npm start` 404s the client — it misses the spec's single-port
acceptance criterion as-shipped. `NODE_ENV=production npm start` serves it (verified
200). Playable in dev mode or with the env var.

¹¹ **SOL's** bots barely move in real matches: `advancePending` (`gameLoop.ts:242`)
deletes each bot's `pendingInput` every tick, so bots only act on decision ticks;
an auditor PoC measured 65/300 vs 232/300 moves. Its soak *reimplements* the tick
loop without that deletion, so the soak passes while the real game's bots crawl.

⁹ **Opus 4.8's** soak is skill-asserting like Fable 5's (checks Hard beats Easy,
not just completion) and passes reliably — Hard won 22/30 duels in the gauntlet
run with per-difficulty self-soak telemetry (Hard 7 vs Easy 49 self-soaks).

⁸ **Kimi K3** is the only other submission that ships its own end-to-end
acceptance script — and, run to completion, that script is honest about a
real defect: the casual section fully passes (room browser, 4p match with
hard bots, XP persistence), but the ranked section ends with
`✗ FAIL: winner gained rating (+0)` — the ranked duel finished with no Elo
delta surfaced — after which the script itself crashes on a `TypeError`
(no 2nd-place entry in the placements, consistent with a drawn duel, which
the spec says first-to-3 duels can't produce). The server has rating-update
code; whether the fault is in the Elo wiring or the match-end payload was
not adjudicated further — either way its own gate reports 2 FAILURES.

## How far can you actually get?

The spec's core acceptance test is a human one: open the game, reach the
menu, play a full match against bots.

| Stage | Fable 5 | GLM 5.2 | Kimi K2.7 | K2.6 swarm | Grok 4.5 | Kimi K3 | Opus 4.8 | SOL | Opus 5 | Grok 4.6 | 0x alpha | Muse Spark 1.3 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Title screen renders | ✅ | ✅ | ✅ | ❌ blank page | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Guest account created | ✅ | ✅ | ❌ (server dead) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Main menu | ✅ | ✅ | ❌ stuck on title | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Lobby / practice setup | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (auto-starts) |
| Live match vs bots | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ (bots sluggish ¹¹) | ⚠️ round 2+ only ¹² | ✅ | ❌ never mounts ¹³ | ⚠️ runs, bots suicide ¹⁴ |

### Fable 5 — title / menu / live match

<p>
<img src="comparison/screenshots/fable-5-title-detail.png" width="45%"> <img src="comparison/screenshots/fable-5-menu.png" width="45%">
</p>
<p><img src="comparison/screenshots/fable-5-match.png" width="60%"></p>

*Live 4-player match: pool theme, castles, revealed power-ups, kill-feed,
per-player HUD, and a "DOUBLE SPLASH!" chain announcement.*

### GLM 5.2 — title / live match

<p>
<img src="comparison/screenshots/glm-5.2-action.png" width="45%"> <img src="comparison/screenshots/glm-5.2-game.png" width="45%">
</p>

*GLM's match is real and running (3 Medium bots, backyard theme). Visuals
are rough — all four critters share one green sprite, the grid/HUD glyphs
misrender, and one critter draws outside the arena — but it plays.*

### Grok 4.5 — menu / live match

<p>
<img src="comparison/screenshots/grok-4.5-menu.png" width="45%"> <img src="comparison/screenshots/grok-4.5-game.png" width="45%">
</p>

*Grok's game plays: keyboard-driven menu with guest account + rank badge, a
"How to Play" walkthrough that flows into a practice bout, and a working duel
vs a bot (castles, HUD, kill feed). Simpler visuals than Fable 5's and its
in-game ping readout is clearly wrong (steady "2002ms" on localhost), but the
loop works end to end.*

### Opus 4.8 (ultracode) — title / live match

<p>
<img src="comparison/screenshots/opus-4.8-ultracode-title.png" width="45%"> <img src="comparison/screenshots/opus-4.8-ultracode-game.png" width="45%">
</p>

*The most polished of the field: a title with live connection status + guest
badge, a full practice-setup screen (size + bot difficulty), and a clean 4-bot
FFA match with detailed HUD plates and a splash cascade in progress. Playable
end to end — its liabilities are under the hood (audit: seed leak + one-packet
server crash).*

### GPT-5.6 SOL (xhigh) — title / live match

<p>
<img src="comparison/screenshots/gpt-5.6-sol-xhigh-title.png" width="45%"> <img src="comparison/screenshots/gpt-5.6-sol-xhigh-game.png" width="45%">
</p>

*Slick HTML-chrome shell (side wordmark, live PING readout, version tag) framing
a pixel arena; a full lobby with per-slot bot difficulty, and a live FFA match
with HUD plates + a splash burst. Playable end to end — caveats are the seed
leak, sluggish production bots, and that `npm start` needs `NODE_ENV=production`
to serve the client.*

### Muse Spark 1.3 — a real match, won by standing still

<p>
<img src="comparison/screenshots/muse-spark-1.3-menu.png" width="45%"> <img src="comparison/screenshots/muse-spark-1.3-game.png" width="45%">
</p>

*Left: the full menu (ranked duel/FFA, casual rooms, practice, tutorial, locker,
leaderboard). Right: a live 4-player FFA at Round 2 — the human is at 🏆1 having
done nothing, and the kill feed reads "Bot-medium soaked Bot-medium!" four times,
because every bot stands on its own first balloon. Note "Ping 0ms" (fake) and the
unscaled ~240px arena.*

### 0x alpha — playable offline tutorial vs. stuck online lobby

<p>
<img src="comparison/screenshots/0x-alpha-tutorial.png" width="45%"> <img src="comparison/screenshots/0x-alpha-stuck-lobby.png" width="45%">
</p>

*Left: the offline tutorial runs a full playable arena (frog, castles, bot,
dropped balloon, all 5 steps ✓) — the sim and renderer work. Right: 16 seconds
after clicking "Start Match", the client is still frozen on the Practice lobby
while the server has already played round 1 into round 2 — because it never
receives `match_start`.*

### Grok 4.6 — menu / live round-1 match

<p>
<img src="comparison/screenshots/grok-4.6-menu.png" width="45%"> <img src="comparison/screenshots/grok-4.6-game.png" width="45%">
</p>

*Canvas-rendered menu with a guest account, and a live duel practice match that
renders correctly from round 1 ("3-2-1-SPLASH!"). The "40ms" ping in the HUD is
a hardcoded constant, not real RTT.*

### Opus 5 — tutorial / round 2 / the round-1 bug

<p>
<img src="comparison/screenshots/opus-5-tutorial.png" width="45%"> <img src="comparison/screenshots/opus-5-round2.png" width="45%">
</p>
<p><img src="comparison/screenshots/opus-5-stuck60s.png" width="45%"></p>

*Left: the tutorial, fully playable and immune to the bug. Middle: a real match
at round 2 — 4 critters, live balloons, per-player power-up counters and round
scores. Right: the same game at t+60s of round 1, still showing the VS card while
the server plays the round out without the human.*

### Kimi K2.7 — permanently stuck at title

<p><img src="comparison/screenshots/kimi-k2.7-title.png" width="45%"></p>

*"Press SPACE to splash in" — pressing it sends `hello`, which kills the
server (see ³). Every retry: `ERR_CONNECTION_REFUSED`.*

### K2.6 agent swarm — blank page

<p><img src="comparison/screenshots/kimi-k2.6-agent-swarm-action.png" width="45%"></p>

*The most interesting contrast in the experiment: the swarm produced the
second-largest codebase, near-best test count, all 12 screen files, and
detailed planning artifacts — and none of it is reachable behind a
client that crashes on load.*

### Kimi K3 — menu / live match

<p>
<img src="comparison/screenshots/kimi-k3-menu.png" width="45%"> <img src="comparison/screenshots/kimi-k3-game.png" width="45%">
</p>

*K3's game plays: DOM-driven menus, a skippable 5-step tutorial, a
create-room flow with every spec option, and a clean duel vs a bot (tidy
tile art, HUD plates, round banner). Nits: the title screen uses OS emoji
rather than the spec's procedural pixel art, the lobby's start button
renders unlabeled, and ranked Elo fails its own e2e gate (see ⁸).*

## Static metrics

| Metric | Fable 5 | GLM 5.2 | Kimi K2.7 | K2.6 swarm | Grok 4.5 | Kimi K3 | Opus 4.8 | SOL | Opus 5 | Grok 4.6 | 0x alpha | Muse Spark 1.3 |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| TypeScript lines | 7,934 | 4,450 | 4,540 | 8,944 | 6,581 | 6,536 | 8,842 | 7,392 | **20,510** | 5,394 | 6,358 | 4,828 |
| TypeScript files | 53 | 30 | 40 | 39 | 43 | 45 | 89 | 42 | **136** | 45 | 39 | 42 |
| Unit tests | 28 | 12 | 7 | 26 | 14 | 18 | 22 | 7 | **103** | 16 | 26 | 11 |
| Client screen modules | 12 | 1 consolidated ⁷ | 11 | 12 | 12 | 12 | 12 | 12 | 17 | 12 | 10 | 11 |
| Extra verification shipped | soak + WS e2e script | soak | soak | (broken soak) | soak | soak + e2e ⁸ | soak (skill-asserting) | soak ¹¹ | soak (4 scenarios) | soak (skill-asserting) | broken soak ¹³ | soak (completion-only ¹⁴) |

⁷ GLM consolidated all screens into one 400-line file (every spec screen
**except the tutorial, which GLM skipped entirely** — `grep -ri tutorial
packages/` → 0 hits). Every submission except GLM implements the tutorial.

Feature-keyword footprint (case-insensitive grep hits across `packages/`,
a *rough* proxy for how deeply a mechanic is wired through sim + bots + UI):

| Keyword | Fable 5 | GLM 5.2 | Kimi K2.7 | K2.6 swarm | Grok 4.5 | Kimi K3 | Opus 4.8 | SOL | 0x alpha | Muse Spark 1.3 |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| kick | 57 | 15 | 28 | 78 | 15 | 16 | 28 | 20 | 35 | 19 |
| revenge (ducks) | 57 | 31 | 27 | 37 | 53 | 28 | 79 | 55 | 50 | 36 |
| tide | 55 | 42 | 26 | 33 | 40 | 57 | 45 | 36 | 42 | 41 |
| emote | 53 | 2 | 17 | 48 | 32 | 51 | 61 | 37 | 39 | 30 |
| rematch | 22 | 12 | 13 | 21 | 32 | 33 | 16 | 22 | 28 | 17 |
| tutorial | 28 | 0 | 15 | 11 | 31 | 30 | 21 | 35 | 7 | 14 |
| colorblind | 11 | 0 | 0 | 11 | 10 | 11 | 46 | 8 (dead ¹¹) | 8 | 13 |
| reconcil… (netcode) | 3 | 5 | 0 | 10 | 1 | 0 | 7 | 0 | 5 | 2 |

## Methodology & fairness notes

- Every submission ran the **identical** gauntlet
  ([`comparison/harness/`](comparison/harness/)) on the same machine;
  trimmed raw logs are in [`comparison/logs/`](comparison/logs/).
- Zips were committed with `node_modules/`, `dist/`, and `*.db` stripped.
  **This initially broke both Kimi builds** (stale `tsconfig.tsbuildinfo`
  without their shipped `dist/` made `tsc` a no-op). That was an evaluation
  artifact, not their bug — the buildinfo files were deleted and both
  builds re-run clean, which is what the scoreboard reports.
- Both Kimis were additionally given a chance in **dev mode**
  (`npm run dev`): K2.7's Vite dev server fails on the same package-entry
  issue its build had before cleaning, and K2.6's client throws the same
  TDZ crash. The blocking bugs above are not artifacts of production
  bundling.
- **Grok 4.5 and Kimi K3 were added two weeks after the original four**
  (zips dated 2026-07-16 vs 2026-07-02) and ran the exact same harness;
  their zips were stripped identically (`node_modules/`, `dist/`,
  `*.tsbuildinfo`, databases).
- **K3 was re-submitted once.** The first K3 zip was accidentally uploaded
  while its agent was still mid-run: the client's sprite-helper module was
  truncated (functions imported by three files existed nowhere), so nothing
  could build or load. The experimenter replaced it with the completed run
  the same day; the scoreboard reflects only the finished submission. The
  incomplete version's evaluation survives in the git history for the
  curious. The Fable 5 folder remains the frozen
  2026-07-02 submission even though development continued in its source
  repo afterward.
- Fable 5's flaky soak result is reported exactly as measured (see ⁴) —
  its bot-skill assertion simply has a threshold its bots only clear
  ~half the time.
- Deeper flows (ranked queues, reconnects, rematch votes) were only
  end-to-end verified for Fable 5, via its own `scripts/e2e.mjs` (guest
  hello → room browser join → full 4p bot match with XP persistence →
  ranked queue → forfeit → Elo 1032/968 → leaderboard). The script is in
  its folder; the other three had no equivalent to run, and the two
  playable games were probed manually only as far as the tables above show.

## Reproduce

```bash
git clone https://github.com/indexsy/splash-critters-llm-comparison
cd splash-critters-llm-comparison/results/<model>
npm install
npm test
npm run build
npm start          # then open http://localhost:3000
```

For Fable 5's full acceptance suite: `npm run soak` and `node scripts/e2e.mjs`
from `results/fable-5/`.
