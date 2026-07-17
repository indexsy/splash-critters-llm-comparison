# Code Audit & Rankings

Six independent code audits — one Claude Fable 5 subagent per codebase, all
given the **same six-dimension rubric** and required to cite `file:line` and
quote the code for every claim. Full per-model reports are in
[`audits/`](audits/); this file synthesizes and ranks them. Every headline
finding was independently re-verified against the source before publishing.

> ## ⚠️ Conflict of interest — read this first
>
> **Fable 5 wrote one of the six submissions AND ran this whole comparison.**
> It ranks its own entry #1 below. Treat that with the skepticism it deserves.
> Here is exactly what was done to keep it honest, so you can discount it
> yourself:
>
> - **Its own entry was audited by an independent subagent, like the rivals —
>   but under a deliberately *harsher* framing.** That auditor was told to hold
>   the code to a stricter standard than a stranger's, to *assume a fatal bug
>   was hiding until proven otherwise*, and to actively disprove the author's
>   self-congratulatory claims. The five rival auditors got a neutral framing.
>   So if anything, Fable 5 was graded on a tougher curve than the field it
>   tops. (Full framing in [`audits/fable-5.md`](audits/fable-5.md) header.)
> - **The load-bearing claims are checkable from the public code in seconds** —
>   don't take the score on faith:
>   - Map-seed anti-cheat: `grep -n mapSeed results/fable-5/packages/server/src/gameLoop.ts`
>     (the real seed at :151 never leaves; :174 sends an independent decoy).
>   - Ranked Elo works end-to-end: `cd results/fable-5 && npm i && node scripts/e2e.mjs`
>     (asserts a forfeit lands 1032/968 on the leaderboard).
> - **The frozen 2026-07-02 snapshot was audited**, same as the rivals' frozen
>   zips — not Fable 5's later continued work.
> - **Its real weaknesses are recorded as prominently as anyone's** (flaky Hard
>   bot that fails its own soak ~half the time; no process-level crash guard,
>   the same gap Grok has; FFA bot matches that drag to the draw cap).
>
> The margin (8.60 vs 6.70) rests on three *verified, load-bearing* facts, not
> polish: it's the only entry with no fatal integration bug, the only one that
> doesn't leak the map seed, and the only one whose ranked-Elo path actually
> works. If you distrust the messenger, verify those three and decide for
> yourself.

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

| Dimension (0–10) | Fable 5 † | Kimi K3 | Grok 4.5 | GLM 5.2 | Kimi K2.7 | K2.6 swarm |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| Correctness (×.25) | 8 | 5 | 5 | 2 | 3 | 2 |
| Spec fidelity (×.20) | 9 | 8 | 8 | 4 | 4 | 3 |
| Netcode (×.15) | 9 | 7 | 6.5 | 2 | 3 | 2 |
| Security (×.15) | 8 | 6 | 3 | 5 | 3 | 4 |
| Code quality (×.15) | 9 | 8 | 8 | 5 | 5 | 4 |
| Test depth (×.10) | 9 | 7 | 7 | 5 | 4 | 6 |
| **Weighted total** | **8.60** | **6.70** | **6.18** | **3.60** | **3.60** | **3.20** |
| Playable end-to-end? | ✅ | ✅ | ✅ | ⚠️ renders, desynced | ❌ crashes on connect | ❌ crashes on load |

† Audited under the harsher/adversarial framing described in the disclosure
above; the auditor was told to assume a fatal bug was hiding and failed to find
one. Take every scores-drift concern seriously — the numbers come straight from
each independent auditor with no post-hoc adjustment by the orchestrator (same
as the five rivals).

## Final ranking

Weighted audit score, with **empirical playability** as the tiebreaker for the
middle tier (the spec grades the shipped artifact, so "does it run" breaks the
GLM/K2.7 score tie in favor of the one that reaches a live match).

### 🥇 1. Fable 5 — 8.60 *(see the conflict-of-interest disclosure above)*

The only entry with no fatal integration bug, the only one that doesn't leak
the map seed, and the only one whose ranked-Elo path works end to end — the
three facts that carry the margin, all independently verifiable. Real
rewind-replay netcode with per-seat input acks and a working 150ms-latency
test; a provably pure sim (zero `Math.random`/`Date.now` in `shared/`); zero
`any` in source; every file under the spec's 500-line cap; 28 tests that pin
exact Elo fixtures and the chain-in-one-tick invariant. Its adversarial auditor
verified the anti-cheat claim is true, not a decoy story (`gameLoop.ts:151` real
seed stays server-side; `:174` ships an independent decoy; the client mirror
null-fills contents at `prediction.ts:57`). **Genuine weaknesses, held to the
same bar as everyone's:** (1) no `process.on('uncaughtException')` guard — the
same latent gap as Grok, though Fable 5's is not currently triggerable because
its message handlers validate input where Grok's don't; (2) a marginally-tuned
Hard bot whose BFS escape-time ignores corner-assist turn cost (`bot.ts:64,287`
vs `movement.ts:88-137`), so it fails its own soak's "Hard beats Easy ≥70%" bar
about half the time; (3) FFA bot matches drag to the `MAX_ROUNDS` draw cap.
Nothing here is game-breaking — the distinction from the field is that its
defects are quality/robustness gaps, not "the game doesn't work" gaps.

### 🥈 2. Kimi K3 — 6.70

The most complete and cleanest of the six by the audit, and playable. Genuine
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

### 🥉 3. Grok 4.5 — 6.18

Neck-and-neck with K3 on spec fidelity, architecture, and tests, and also
playable end to end. Its netcode is real (rewind-replay + 100ms interpolation).
It ranks below K3 mainly on **security**: it broadcasts the real map seed AND
has no message validation or exception guard, so a single malformed WebSocket
frame (e.g. `join_room` with a numeric code) crashes the whole server — a
remote DoS. Plus concrete logic bugs: the HUD ping shows the 2000ms *ping
interval* instead of RTT (clock-sync is dead code), same-tick mutual soak awards
a win instead of the spec's draw, and Easy bots skip their escape-check 20% of
the time and self-soak.

### 4. GLM 5.2 — 3.60 *(playable-but-broken)*

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

### 5. Kimi K2.7 — 3.60 *(doesn't boot)*

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

### 6. Kimi K2.6 agent swarm — 3.20

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
because the bug lives *between* the tested units. And one security flaw is
**near-universal**: all five *rivals* broadcast the real map seed that rolls the
"hidden, unguessable" power-up contents, so their hidden power-ups are
client-derivable — none of them built the separate secret-seed the spec's threat
model requires. Fable 5 is the sole exception (real seed stays server-side, an
independent decoy is sent instead), which is a large part of why it tops the
security dimension.
