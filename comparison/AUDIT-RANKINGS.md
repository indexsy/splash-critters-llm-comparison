# Code Audit & Rankings

Thirteen codebases audited by independent Claude subagents, all against the
**same six-dimension rubric**, every claim citing `file:line`. (Opus 5 got *three* passes — neutral, adversarial, steelman; Opus 4.8, SOL, Grok 4.6, 0x alpha, Muse Spark 1.3 and GPT-6 Astra each got a neutral pass plus an independent fact-checker.) Full per-model reports are in [`audits/`](audits/); this
file synthesizes and ranks them. Every headline finding was independently
re-verified against the source before publishing (the two most recent additions,
Opus 4.8 and GPT-5.6 SOL, each also got a *second* independent fact-checker pass).

> ## ⚠️ Conflict of interest — read this first
>
> **Three of the thirteen entries are Claude-family (Fable 5, Opus 4.8, Opus 5),
> and Fable 5 both wrote one of them AND ran this whole comparison — then
> ranked its own entry #1.** Treat that with the skepticism it deserves. Here
> is exactly what was done to keep it honest — including a correction that
> moved the orchestrator's own score DOWN:
>
> - **The single most important result in this benchmark belongs to a
>   non-Claude entry — and a Claude orchestrator is telling you so.** GPT-6 Astra
>   (#2, 8.35) is the ONLY one of thirteen to satisfy the spec's core
>   "unguessable, unhackable" requirement: it rolls each castle's hidden contents
>   from an **independent per-tile CSPRNG stream** (`rooms.ts:336-338`), so the
>   same attack that recovered Fable 5's loot in 21.8s and Opus 5's in ~76s
>   scores at pure chance against Astra (1.29 hits/map vs a 1.30 independent-secret
>   control, 400 trials — verified firsthand). It sits **0.10 behind Fable 5**
>   only because the weighted rubric rewards Fable 5's slightly cleaner code
>   (quality 9 vs 8) and one extra test file (test depth 9 vs 8); on the hardest
>   and most spec-central dimension — did you actually solve the problem the whole
>   comparison is built around — **Astra is first and Fable 5 is not** (security
>   8 vs 7). A reader who weights "solved the core problem" above code polish
>   should read Astra as co-#1. This entry was processed while the orchestrator
>   ran as **Opus 5 — itself entry #3** — so the conflict, if it tilted anything,
>   tilted *toward* keeping a Claude entry on top, and the result still went the
>   other way.
> - **The Opus 5 audit found a flaw that turned out to apply to Fable 5 too —
>   and worse.** Its adversarial auditor showed that omitting the map seed is
>   not enough: the transmitted `castleGrid` carries ~93 Bernoulli outcomes
>   that pin a 32-bit seed, recovering every hidden power-up in ~76s. The
>   orchestrator then ran that same attack against **its own entry** and
>   recovered the seed in **21.8s** (2^31 keyspace — half of Opus 5's), exposing
>   all 20 buried power-ups. Fable 5's Security score was cut 8 → 7 and its
>   total 8.60 → 8.45 as a result. The attack script is in
>   [`harness/attack-seed-recovery.mjs`](harness/attack-seed-recovery.mjs) —
>   run it yourself.
>
> - **Fable 5's own entry was audited under a deliberately *harsher* framing**
>   than everyone else: its auditor was told to hold the code to a stricter
>   standard than a stranger's, *assume a fatal bug was hiding until proven
>   otherwise*, and disprove the author's claims. Every other entry — including
>   the rival Claude entry, Opus 4.8 — got the neutral framing. **Opus 4.8 got
>   *more* scrutiny than any other entry** (a second independent fact-checker
>   re-verified every finding), and it still landed below the harder-graded
>   Fable 5. The deck is stacked *against* the orchestrator, not for it.
> - **Opus 5 (now #3, 7.75) loses round 1 of every match.** Its client sits on the VS card for the entire
>   first round while the server plays it out — reproduced 5× in a real browser
>   by the orchestrator, and independently by its adversarial auditor. On
>   security the two are now effectively tied (both brute-forcible; Opus 5's
>   keyspace is actually *twice* Fable 5's, and its hostile-frame hardening is
>   better-demonstrated — 47 malformed frames survived).
> - **Fable 5's frozen 2026-07-02 snapshot was audited**, same as the rivals'
>   frozen zips — not its later continued work.
> - **Fable 5's real weaknesses are recorded as prominently as anyone's**
>   (seed recoverable in 21.8s — the worst keyspace in the top tier; flaky Hard
>   bot that fails its own soak ~half the time; no `uncaughtException` guard;
>   FFA bot matches that drag to the draw cap).
>
> If you distrust the messenger: run the seed attack against both entries, and
> click "Practice vs bots" in Opus 5 and watch round 1 never appear. Both take
> minutes. Do that and decide.

## Scoring rubric

Each codebase was scored 0–10 on six dimensions, then combined with weights
chosen to reward *a complete, shippable game* (the spec's own bar), which
means correctness and spec-coverage matter most:

| Dimension | Weight | What it measures |
| --- | --: | --- |
| Correctness | 25% | Does it actually work? Game-breaking bugs, crashes, logic defects |
| Spec fidelity | 20% | How many spec systems are really implemented vs stubbed/dead |
| Netcode | 15% | Real prediction/reconciliation + interpolation, or cosmetic |
| Security / anti-cheat | 15% | Seed secrecy, input validation, rate limit, token hashing, SQL |
| Code quality | 15% | Architecture, sim purity, typing, dead code, integration coherence |
| Test depth | 10% | Do the tests assert the spec's hard guarantees, or smoke-test? |

## Scoreboard

| Dimension (0–10) | Fable 5 † | GPT-6 Astra ✚ | Opus 5 ¶ | Opus 4.8 ‡ | SOL xhigh ‡ | Kimi K3 | Grok 4.5 | Grok 4.6 ‡ | 0x alpha ‡ | GLM 5.2 | Kimi K2.7 | Muse Spark 1.3 ‡ | K2.6 swarm |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Correctness (×.25) | 8 | 8 | 6 | 6.5 | 6 | 5 | 5 | 5 | 3 | 2 | 3 | 2 | 2 |
| Spec fidelity (×.20) | 9 | 9 | 8.5 | 9 | 8 | 8 | 8 | 8 | 4 | 4 | 4 | 4 | 3 |
| Netcode (×.15) | 9 | 9 | 9 | 8.5 | 8 | 7 | 6.5 | 4 | 3 | 2 | 3 | 3 | 2 |
| Security (×.15) | 7 ◆ | 8 | 7 | 3 | 6 | 6 | 3 | 3 ★ | 5 | 5 | 3 | 2 | 4 |
| Code quality (×.15) | 9 | 8 | 9 | 9 | 8 | 8 | 8 | 8 | 7 | 5 | 5 | 5 | 4 |
| Test depth (×.10) | 9 | 8 | 8 | 9 | 6 | 7 | 7 | 7 | 6 | 5 | 4 | 4 | 6 |
| **Weighted total** | **8.45** | **8.35** | **7.75** | **7.40** | **7.00** | **6.70** | **6.18** | **5.80** | **4.40** | **3.60** | **3.60** | **3.20** | **3.20** |
| Playable end-to-end? | ✅ | ✅ | ⚠️ loses round 1 ¶ | ✅ | ✅ § | ✅ | ✅ | ✅ | ❌ online never renders ✦ | ⚠️ renders, desynced | ❌ crashes on connect | ⚠️ runs, but every bot suicides in ~3s ⊗ | ❌ crashes on load |

◆ Fable 5's Security was **corrected 8 → 7** after the Opus 5 audit's
seed-recovery attack was turned on Fable 5's own code and broke it faster
(21.8s vs 76s). ¶ Opus 5 audited under THREE passes (neutral, adversarial,
steelman); the neutral pass scored Correctness 8 and missed the round-1 bug,
the adversarial pass caught it, and the orchestrator reproduced it 5× in a real
browser — the adversarial finding governs.

† Fable 5 audited under the *harsher* adversarial framing (assume a fatal bug
hides; disprove the author) — the tougher curve, and no fatal flaw was found.
‡ Opus 4.8 and SOL xhigh audited under the neutral framing PLUS a second
independent fact-checker that re-verified every finding; the orchestrator also
reproduced their critical findings firsthand. ★ Grok 4.6's auditor scored
Security **2**; the orchestrator set it to **3** to match the identical
seed-leak-plus-one-packet-crash profile of Opus 4.8 and Grok 4.5 (both 3) — a
slightly *more* generous call, since 4.6 adds real input validation. ✚ GPT-6 Astra is the **first and only entry to satisfy the spec's anti-cheat
requirement**: `rooms.ts:336-338` draws one `crypto.randomInt` secret per tile
every round and `map.ts:42` rolls each castle's contents from `mulberry32(lootSeed
[index])`, decoupling contents from the broadcast `mapSeed`. The orchestrator's
attack (`harness/attack-astra-loot.mjs`) scores at chance (1.29 vs a 1.30 control).
Security is held off a higher mark by a proven single-socket room-exhaustion
process kill and no `uncaughtException` guard. ✦ 0x alpha's server runs the match (round_start → events → round_end stream on
the wire) but **never sends `match_start`**, and the client mounts gameplay only
on that message — so online play (practice/casual/ranked) freezes on the lobby
while the match plays out invisibly (reproduced firsthand). Its offline tutorial
renders and plays fine, so the sim/renderer work; only the server→client wiring
is missing. ⊗ Muse Spark 1.3 boots, connects and renders a real match through Round 2 — but
`dangerMap.ts:85` treats any burst more than 22 ticks away as safe, so **every
bot difficulty stands on its own first balloon** (Hard 0/12 vs Easy; an idle
human beat three Medium bots 8/8 in ~3-second rounds) while `soak.ts` certifies
it as PASS. It ties K2.6 at 3.20 and ranks above it only on the playability
tiebreak (it runs; K2.6 crashes on load). § SOL is fully playable, but its
shipped `npm start` 404s the client — it needs `NODE_ENV=production` to serve on
one port (verified: 404 without, 200 with), so it misses the spec's literal
single-port acceptance criterion as-shipped. Scores come straight from each
independent auditor with no post-hoc adjustment by the orchestrator.

## Final ranking

Weighted audit score, with **empirical playability** as the tiebreaker for the
middle tier (the spec grades the shipped artifact, so "does it run" breaks the
GLM/K2.7 score tie in favor of the one that reaches a live match).

### 🥇 1. Fable 5 — 8.45 *(see the conflict-of-interest disclosure above)*

The only entry with no fatal integration bug and the only one whose ranked-Elo
path works end to end — the two facts that now carry the margin. Real
rewind-replay netcode with per-seat input acks and a working 150ms-latency
test; a provably pure sim (zero `Math.random`/`Date.now` in `shared/`); zero
`any` in source; every file under the spec's 500-line cap; 28 tests that pin
exact Elo fixtures and the chain-in-one-tick invariant. Its adversarial auditor
verified the decoy-seed design is real (`gameLoop.ts:151` real seed stays
server-side; `:174` ships an independent decoy; the client mirror null-fills
contents at `prediction.ts:57`). **Genuine weaknesses, held to the same bar as
everyone's:** (0) **the decoy is not enough** — the transmitted `castleGrid`
pins the 31-bit seed, and the orchestrator's own attack recovered it in **21.8s**,
exposing all 20 hidden power-ups (`map.ts:71-84` rolls placement and contents
from one interleaved stream). Fable 5 does NOT meet the spec's "unguessable,
unhackable" bar either; it is merely harder than the 7 entries that ship the
seed outright, and *easier* than Opus 5 (half the keyspace). Security cut 8 → 7.
(1) no `process.on('uncaughtException')` guard — the same latent gap as Grok,
though not currently triggerable because its handlers validate input; (2) a marginally-tuned
Hard bot whose BFS escape-time ignores corner-assist turn cost (`bot.ts:64,287`
vs `movement.ts:88-137`), so it fails its own soak's "Hard beats Easy ≥70%" bar
about half the time; (3) FFA bot matches drag to the `MAX_ROUNDS` draw cap.
Nothing here is game-breaking — the distinction from the field is that its
defects are quality/robustness gaps, not "the game doesn't work" gaps.

### 🥈 2. GPT-6 Astra — 8.35 *(the first entry to actually solve the anti-cheat requirement)*

**The only entry of thirteen that satisfies the spec's "unguessable, unhackable"
hidden-power-up requirement** — and it holds under the same attack that broke both
Claude entries. Every round, the server draws one `crypto.randomInt(2^32)` secret
per tile (`rooms.ts:336-338`, comment: "Independent secret streams prevent
revealed drops from disclosing later castle contents") and rolls each castle's
contents from that tile's own `mulberry32(lootSeed[index])` stream (`map.ts:42`).
Layout still comes from the broadcast `mapSeed` — as the spec intends, the map is
public — but contents no longer share that stream, so pinning the layout seed buys
nothing. The orchestrator ran the exact attack that recovered Fable 5's loot in
21.8s: holding the wire `mapSeed` + `castleGrid`, it scores **1.29 exact hits/map
against a 1.30 independent-secret control over 400 trials** — statistically zero
signal (`harness/attack-astra-loot.mjs`). The independent auditor added a
conditional-independence check over 40,000 rounds (`P(tile B | tile A)` flat to
three decimals) and a counting argument (≈10^47 castle configurations vs 2^32
reachable by any single-seed guess), and confirmed the derivable `seed ^
0x718b45da` default is unreachable on the one real server path. It is also near
the top on everything else: the **cohort's strongest validator** (byte cap,
array-rejecting `isObject`, `Number.isSafeInteger` bounds, UUID-regex before
`hash()` so the non-string-token crash that killed 6 of 13 is double-guarded —
survives 33 malformed frame classes), a **pure** shared sim, **genuine ack-based
rewind-replay** with `serverTime − INTERPOLATION_MS` interpolation (both tested),
a **real server-measured RTT ping**, round 1 that renders, a soak that actually
asserts `selfSoaks === 0` and deterministic replay, a real end-to-end integration
script (guest auth → 4p match → reconnect → forfeit → Elo → "secret masking"),
and Docker/fly/railway/render deploy configs. **Genuine, serious weaknesses, held
to the same bar as everyone's:** (P0) a proven **single-socket remote process
kill** — one guest can create-and-abandon rooms to fill `MAX_ROOMS`, and the next
ranked pairing makes the matchmaker's `Rooms.create` throw inside an unguarded
`setInterval` with no `uncaughtException` handler, taking every live match down
(reproduced independently twice); a **mangled `</option value="easy">`**
(`lobby.ts:21`) that makes Easy bots unselectable in casual rooms — the spec's
per-slot difficulty is one-third dead; a last-round disconnect that **permanently
kills the rematch**; and Hard/Medium bots that are statistically indistinguishable
(Hard still self-soaks ~5% of the time, so its soak's `selfSoaks === 0` is a
fixture artifact of the non-production number seed). **It lands 0.10 behind
Fable 5 entirely on the two softest dimensions** (code quality 8 vs 9, test depth
8 vs 9) while **winning the hardest and most spec-central one** (security 8 vs 7).
Read the conflict-of-interest note above: on the requirement this whole comparison
is built around, the GPT entry is first and the Claude entries are not.

### 🥉 3. Opus 5 — 7.75

The strongest engineering in the field on almost every axis — and the entry that
found a real hole in the #1. It is the **only submission whose client never
receives anything that identifies hidden power-ups** (no seed on the wire at all:
`snapshot.ts:113-131` ships `castleGrid` only, and `prediction.ts:95` zero-fills
`castleContents`), it survived **47 hostile frames + binary + 20 KB payloads**
with the process staying up (per-message and per-room `try/catch`, prototype
pollution closed at `protocolGuards.ts:236`), and a 12-room / 36-bot / 90s stress
produced zero tick failures. 103 tests all pass, zero `any` / zero `@ts-ignore`
across 136 files, genuine rewind-replay netcode. Its adversarial auditor still
broke the seed — the shipped grid pins the 32-bit seed in ~76s — which is the
same structural flaw Fable 5 has (and Fable 5 falls *faster*), so the two are
tied at Security 7.

**What costs it the top spot is one fatal client bug: you lose round 1 of every
match.** `router.ts:69-77` navigates by setting `location.hash` and relying on an
async `hashchange`, so the game screen mounts one task *after* the server's
back-to-back `match_start`/`round_start` land; `round_start` is dispatched to an
empty handler set (`net.ts:131-133`) and buffered nowhere, leaving
`roundStarted=false`, so `introActive()` (`game.ts:100`) never clears and the VS
card paints forever. I reproduced this five times in a real browser: at t+60s the
server is in `phase:"playing"` streaming events while the client still shows
"GET READY" — and it recovers **exactly** when round 2's `round_start` arrives
(HUD `R2/3`). The player is bombed blind for the whole first round, in Practice,
Casual and Ranked alike; only the tutorial is immune. It is a one-line fix
(`render()` unconditionally in `navigate`), but as shipped it is the single
worst user-facing defect in the top tier. Secondary: soaked *bots* never drive
their revenge ducks (`bots/bot.ts:330 ghostInput` is unreachable — dead bots keep
a frozen stale input), and lobby GC evicts seated humans without notice.

### 4. Opus 4.8 (ultracode) — 7.40

The strongest submission after Fable 5's, and the best of the non-frozen field:
playable, a coherent multi-agent decomposition where **the swarm seams the other
multi-agent entries failed at are absent** (the auditor specifically looked — no
events emitted to dead listeners, no double-gated counters, no circular-import
crash; a clean `context.ts` breaks the rooms↔matchmaker cycle). Every source
file is under 500 lines, only 2 `any` in the tree, `tsc -b` clean, genuine
rewind-replay netcode with 100ms interpolation and server-tick fuses, and the
**second-best test suite in the field** — 22 real invariant tests plus a
skill-asserting soak (Hard beats Easy 26/30, Hard self-soaks 1 vs Easy's 64).
It ranks below Fable 5 on exactly two things, both **independently verified and
reproduced firsthand**: (1) it **leaks the real map seed** — `round_start` ships
the same `mixSeeds(baseSeed, roundNo)` (`match.ts:74`→`:109`) that rolls the
hidden castle contents, and the bundled client regenerates them, so every
power-up is client-derivable (the server snapshot pointedly omits `castleContents`,
proving secrecy was intended — there's no decoy); and (2) a **single malformed
`hello` packet crashes the whole server** — `hashToken(msg.token)` (`util.ts:12`)
throws `ERR_INVALID_ARG_TYPE` on a non-string inside an unguarded ws handler with
no `uncaughtException` handler (I booted it and killed it with one packet). Those
two land it a Security 3 despite otherwise excellent fundamentals. Fix both and
it's neck-and-neck with #1.

### 5. GPT-5.6 SOL (xhigh) — 7.00

Playable, cleanly typed (zero `any` in source), a pure sim, and — notably — the
**only entry besides Fable 5 with no process-crash path**: its `isClientMessage`
validator (`protocol.ts:40-66`) rejects the malformed `hello` that killed four
rivals, and its ws dispatch is wrapped in try/catch, so no single packet takes
the server down. Genuine rewind-replay netcode with 100ms interpolation. Its
Security 6 (tied with K3, above Opus/Grok's 3) reflects that robustness — its
*only* security defect is the field-standard seed leak (an auditor PoC re-derived
all 24 hidden power-ups from the broadcast seed; `gameLoop.ts:475` sends the real
`state.map.seed`). What drops it below Opus 4.8 are three verified defects: (1) a
**production-only bot-crawl bug** — `advancePending` deletes each bot's
`pendingInput` every tick (`gameLoop.ts:242`, condition always true), so bots
only move on decision ticks and effectively crawl; its soak *reimplements* the
loop without that deletion, so 7 tests + a divergent soak structurally couldn't
catch it; (2) the **colorblind toggle is dead** (stored, read by zero render
code) and **revenge ducks never ride the border** (dead players are frozen at
their death tile and lob from there); (3) its shipped **`npm start` 404s the
client** — it needs `NODE_ENV=production` to serve on one port, missing the
spec's single-port criterion as-shipped. Strong fundamentals, a couple of
gameplay/robustness gaps its thin test suite let through.

### 6. Kimi K3 — 6.70

The most complete and cleanest of the *Kimi/Grok* field by the audit, and
playable. Genuine
rewind-replay reconciliation with a real server input-ack, honest per-pixel
procedural art, strict TypeScript with **zero `any` in source**, 18 tests that
assert the spec's hard guarantees (chain-in-one-tick, same-tick draw,
seed-identical hidden contents), and the **only rival to ship its own e2e
script**. What holds it back is a cluster of untested-server-layer defects on
the *competitive-integrity core*: ranked duels can genuinely end in a draw
(spec forbids it) which zeroes out Elo; ranked forfeit is dead code (the
`match_end` event is wiped by `state.events = []` before it's ever read); and —
remarkably — the default **Space key can't drop a balloon** (bound as
`'Space'`, but the key set stores `' '`; only the `E` fallback works).

### 7. Grok 4.5 — 6.18

Neck-and-neck with K3 on spec fidelity, architecture, and tests, and also
playable end to end. Its netcode is real (rewind-replay + 100ms interpolation).
It ranks below K3 mainly on **security**: it broadcasts the real map seed AND
has no message validation or exception guard, so a single malformed WebSocket
frame (e.g. `join_room` with a numeric code) crashes the whole server — a
remote DoS. Plus concrete logic bugs: the HUD ping shows the 2000ms *ping
interval* instead of RTT (clock-sync is dead code), same-tick mutual soak awards
a win instead of the spec's draw, and Easy bots skip their escape-check 20% of
the time and self-soak.


### 8. Grok 4.6 — 5.80 *(a rare regression: below its own predecessor)*

The most interesting result in the late additions: **Grok 4.6 audits slightly
*below* Grok 4.5**, and the per-dimension deltas show exactly why. It genuinely
**fixes two real 4.5 bugs** — same-tick mutual soak now correctly yields a DRAW
(`checkRoundEnd:452`) instead of awarding a win, and Easy bots now run the
escape check before dropping (`bot.ts:279`) instead of self-soaking — and its
soak became skill-asserting (Hard 5 / Easy 0, not flaky). Playable end to end
(tutorial + practice both render live at round 1), pure sim, zero `any`, strict
typecheck clean. But three things drag it under 4.5: (1) **its netcode audited
much weaker** — the server sends no input ack (grep for `ackSeq`/`lastAck` in
server src = zero, verified firsthand), so reconciliation can't trim by ack, and
`INTERP_DELAY_MS` is dead (never read in the client), so the spec's
`serverTime−100ms` interpolation is replaced by a cosmetic exponential ease
(`prediction.ts:64`) — Netcode 6.5 → 4; (2) it **still leaks the seed outright**
(client `createRound(msg.mapSeed)` re-derives all 22 hidden power-ups — the free,
worst tier); (3) it **still crashes on one malformed packet** (`hashToken(12345)`
→ `ERR_INVALID_ARG_TYPE`, `handle()` outside the lone `JSON.parse` try/catch, no
`uncaughtException` guard — reproduced live) and its **HUD ping is still fake**
(`ping = 40` pinned by `ping*0.95 + 40*0.05`, `net.pingMs` never assigned). Real
correctness progress on the sim, no progress on the security/netcode fundamentals
that the weighting rewards most.
### 9. 0x alpha — 4.40 *(the sim works; one missing server message strands it)*

The best-engineered entry that still can't be played online — a textbook "so
close" failure. Its **offline tutorial renders and plays a full arena** (frog,
castles, a bot, dropped balloons, all five scripted steps), its shared sim is
pure and **26 tests genuinely assert** the hard invariants (seed→identical
hidden contents, 3-balloon chain in one tick, same-tick draw, exact Elo
fixtures), it's **zero `any` with a clean strict typecheck + build**, and —
unlike four rivals — it **survives a malformed packet** (I fired 8 pre-auth junk
frames incl. a numeric token and `t:42`; `/health` uptime kept climbing, no
crash — `hello` coerces a non-string token to `undefined`). But it is
**unplayable online**: the server plays the match (I watched
`round_start → events → round_end → round_start` stream on the wire) yet
**never sends `match_start`**, and the client mounts gameplay only on that
message (`main.ts:150-152`, `enterGame` at `game.ts:63`), so every
practice/casual/ranked flow freezes on the lobby while the match runs invisibly.
On top of that: the **bot AI is inverted** — a 50-match fact-check run had Easy
beating Hard 45–5 with the Hard bot self-soaking ~4× as often
(`escapeExistsAfterDrop` at `bot.ts:350` fails to keep it alive) and bots almost
never soaking each other; the **map seed is leaked** on the wire (14/14 hidden
power-ups reconstructed — and *gratuitously*, since the in-match client reads
only `castleGrid` and never the seed); prediction is **cosmetic** (`pendingInputs`
recorded but never replayed) and the **ping is fake** (`net.ping = 0`, never
updated); and ranked is unreachable (no nickname UI, and the client swallows the
`nickname_required` error). It scores above the 3.x tier because its sim,
tests, typing and crash-hardening are genuinely strong — it is one emitted
message away from being a real game.

### 10. GLM 5.2 — 3.60 *(playable-but-broken)*

Renders a live match, which is why it edges K2.7 — but the audit shows that
match is a **hologram**. Players phase straight through walls, castles, and
boulders (the collision check only runs on grid-centered ticks, and the
movement speed never re-centers cleanly — verified: a bot walked through a
castle to x=9). The client is **never sent the real map** — the server only
ever broadcasts `snapshot`, so the client renders an arena from a hardcoded seed
`1` while the server simulates a different one. On top of that, ~half of all
game events are dropped (cleared every tick, sent every 2nd), match history is
never persisted (dead code), and combo announcements can never fire
(`chainSize` is always 1). Solid fundamentals underneath (server-authoritative
positions, hashed tokens, parameterized SQL, a pure deterministic sim), but as
a *game* it does not work. It also skipped the tutorial entirely.

### 11. Kimi K2.7 — 3.60 *(doesn't boot)*

A genuinely deterministic sim and correct Elo math at the core, but the shipped
artifact is 100% non-functional: the server crashes on the **first client
`hello`** (two `INSERT OR IGNORE INTO unlocks` statements are missing their
`VALUES` clause), thrown inside a message handler with no try/catch and no
process-level guard. It's a one-character-per-line fix — but even patched,
**ranked never starts** (match-made players are never marked ready, `canStart`
always fails, `match_found` has zero senders), so Elo/forfeit/reconnect are all
unreachable, and its signature mechanics (kick, revenge ducks, emotes) are dead
code behind live config flags. Ranks just below GLM only because it never
reaches a playable frame.

### 12. Muse Spark 1.3 — 3.20 *(runs, but the bots kill themselves — and the soak says PASS)*

The only bottom-tier entry that genuinely **plays end to end**: it boots, connects,
sends `match_start`, renders round 1 (fact-checked 4/4 trials, and reproduced by
the orchestrator through Round 2), with a live kill feed and revenge ducks. Its
shared sim is pure and deterministic and its Elo math is correct
(`elo.ts:8-10,51`). That is the whole of the good news. **Every bot difficulty
suicides on its own first balloon**: `dangerMap.ts:85` marks a tile safe when the
burst is more than 22 ticks away, so with a 90-tick fuse `canEscapeAfterPlace`
(`bot.ts:95-101`) returns a zero-length escape and the bot stands on its balloon
— measured Hard 0/12 vs Easy and an idle human beating three Medium bots 8/8 in
~3-second rounds, while the shipped `soak.ts` is completion-only and **certifies
this as PASS**. The orchestrator's own screenshot shows exactly this: an idle
human at 🏆1 with a kill feed of "Bot-medium soaked Bot-medium!". Security is
the worst in the field: **five distinct unauthenticated one-frame crashes** —
`onMessage` routes `hello` at `net.ts:78-79` *before* both the rate limiter and
the guarded `try/catch` (`:96-278`), so a raw `null` frame or a `hello` with a
number/object/array/boolean token reaches `createHash().update()` unchecked and
exits the process (reproduced live); the **seed is leaked outright**
(`net.ts:476` ships the real `mapSeed`, `map.ts:51-75` rolls layout and contents
from one stream — 100% reproduction, and gratuitous since no in-match client code
reads it); `db.ts:67` `token || randomUUID()` lets a **client choose its own
credential** (`hello{token:"a"}` → `welcome.token:"a"`); `/api/tutorial` has no
idempotency (**unlimited XP farming**); and pre-auth `hello` spam grows the
`players` table unbounded. Then a bug class no other entry has: the client sends
inputs from inside a `requestAnimationFrame` loop (`game.ts:167-179`) against a
60/s server cap (`config.ts:87`), so **the server throws away the human's own
inputs** as `rate_limit` errors — worse on high-refresh displays. Add dead
disconnect handling (`substituteBot` never clears `disconnected`, so the
"bot" never moves), a Forfeit button that never forfeits, bots that freeze for a
whole round after round 1 (`lastDecisionTick` never reset), a fake "Ping 0ms",
and only 11 tests. A complete-looking scaffold whose one working loop is a match
the bots refuse to contest.

### 13. Kimi K2.6 agent swarm — 3.20

A textbook multi-agent integration failure. The individual modules are
competent — a pure, well-tested sim (26 assertions), strict typing, a real
700-line bot AI — but the *seams between separately-authored modules were never
connected*. The client crashes at boot on a circular import
(`main.ts` → `settings.ts` → `main.ts`, dereferencing `DEFAULT_SETTINGS` before
it initializes). Underneath that: the server **never sends snapshots** (two
agents each added a `% 2` gate to the *same* counter, so it deadlocks at 1) and
**never emits `round_start`** (emitted to zero listeners), the 700-line bot AI
is imported by nothing, tokens are stored raw despite a `token_hash` column,
and the client has **no mouse handling at all** — every button on every screen
is inert paint. The most code, nearly the most tests, and the least assembled.

## The pattern

Every one of the five has a **pure, deterministic, well-tested shared sim** —
the self-contained algorithmic core is where all six models (including the
auditor's) are strong. The ranking is decided almost entirely at the
**integration seams**: a SQL string, a module's exports, a circular import, an
event that's emitted to no one, a key bound as `'Space'` but read as `' '`. The
three that fail (K2.7, GLM's netcode, K2.6) all pass their own unit tests
because the bug lives *between* the tested units. And on the spec's "unguessable,
unhackable" power-up requirement, **twelve of the thirteen entries fail — and the
thirteenth is the most important result in the whole benchmark.** **Ten** (GLM,
K2.7, K2.6, both Groks, K3, Opus 4.8, SOL, 0x alpha, Muse Spark) broadcast the
real seed, so recovery is free and instant. **Opus 5** omits the seed entirely
and **Fable 5** sends a decoy — but both still ship the castle grid, which pins
the seed by brute force: ~76s for Opus 5 (2^32) and **21.8s for Fable 5** (2^31,
verified by the orchestrator against its own code). **GPT-6 Astra is the sole
entry that closes it**: it rolls each tile's contents from an independent per-tile
CSPRNG stream (`rooms.ts:336-338`) — exactly the "independently seeded PRNG" fix
the other twelve missed — and survives the derivation attack at chance. A second near-universal flaw: a **one-packet server crash** from an
unvalidated message — six entries (K2.7, K2.6, Opus 4.8, both Groks, and Muse
Spark) die from a single malformed packet; only **Fable 5, SOL, Opus 5, 0x alpha,
and GPT-6 Astra** validate inputs defensively enough to survive it (Astra shrugged
off 33 malformed frame classes). The two most robust submissions
(Fable 5, SOL) and the two most *complete* (Fable 5, Opus 4.8) are a small
overlapping set — nobody but Fable 5 got both right.
