# Kimi K3.1 Pro evaluation

**Score: 7.05/10.** The archive delivers a substantial, playable game with
working browser practice, ranked matchmaking, persistent ratings, and a useful
deterministic bot soak. The main security result is severe: the server broadcasts
the same seed used to generate both the map and every hidden power-up. FFA rating
rounding also creates or destroys rating points, and guests can fill the room map
without a creation cap.

Evaluated by **GPT-6.1 SOL through OpenCode** on October 24, 2026. The
six-dimension weights are correctness 25%, spec fidelity 20%, netcode 15%,
security / anti-cheat 15%, code quality 15%, and test depth 10%. These are
judgment scores, supported by the checks below, not calibrated measurements.

## Score

| Dimension | Weight | Score | Evidence |
| --- | ---: | ---: | --- |
| Correctness | 25% | 8 | Full practice rounds, account flows, ranked pairing, forfeits, and persistence work. FFA Elo independently rounds each player's change and is not zero-sum. |
| Spec fidelity | 20% | 8 | Core game, power-ups, bots, ranked play, reconnect grace, rematches, tutorial, controls, settings, cosmetics, and progression are implemented. |
| Netcode | 15% | 8 | Server-authoritative simulation, 30 Hz input, 15 Hz snapshots, local prediction/reconciliation, 100 ms timestamped remote interpolation, ping, and reconnect resync. |
| Security / anti-cheat | 15% | 4 | Hidden power-ups are fully derivable from the public map seed. One guest created 205 rooms; no room-creation cap exists. Input schema, size, and rate are bounded. |
| Code quality | 15% | 7 | Clear TypeScript workspaces, shared simulation, separated game/server/client concerns, parameterized SQLite, transactional match persistence, and shutdown cleanup. Main weaknesses are uncapped room growth and FFA Elo rounding. |
| Test depth | 10% | 6 | 21 passing tests cover map generation, deterministic simulation, major mechanics, Elo fixtures, and database basics. The deterministic soak adds a Hard-vs-Easy gate. No WebSocket integration or browser acceptance tests are included. |
| **Weighted score /10** | | **7.05** | |

## Checks Run

| Check | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Pass |
| `npm test` | **21/21** across 3 files |
| `npm run build` | Pass; shared, client, and server compile |
| `npm run typecheck` | Pass |
| `npm run soak` | Pass; four-bot FFA completed and Hard won **8/8** seeded duels |
| Production `/health` and homepage | **200 / 200** |
| Browser title, tutorial, skip, menu, and four-player practice | Pass; active match remained responsive and browser console had no errors |
| Browser `?latency=150` practice | Pass; active FFA gameplay rendered with no browser-console errors |
| Ranked two-human duel | Pairing and `match_start` succeeded |
| Ranked forfeit | Match result delivered; ratings persisted as **1000 → 968** and **1000 → 1032** |
| Malformed numeric token | Rejected as `BAD_MESSAGE`; server remained healthy |
| Oversized WebSocket frame | Connection closed by the `ws` max-payload guard; server remained healthy |
| Hidden-drop derivation probe | Public `mapSeed` reproduced the castle grid and **14 hidden drops** in the tested duel map |
| Room-creation probe | One guest created **205/205** private rooms; server remained healthy |

## Findings

1. **Public seed reveals every hidden power-up.** `round_start` sends
   `mapSeed` and `castleGrid` in [`gameLoop.ts`](../results/kimi-k3.1-pro/packages/server/src/gameLoop.ts#L78).
   [`map.ts`](../results/kimi-k3.1-pro/packages/shared/src/map.ts#L42) rolls terrain
   and hidden contents from the same `mulberry32(seed)` stream. The shipped client
   contains that generator. I reran it using the wire seed; its castle grid matched
   the server's and it exposed 14 hidden drops before any castle was washed. Omitting
   `hiddenPowerups` from snapshots does not help because the deterministic seed is
   public.

2. **Room creation has no global cap.** [`RoomManager.createRoom`](../results/kimi-k3.1-pro/packages/server/src/rooms.ts#L506)
   allocates and stores another room for each valid request. The probe paced 205
   private-room requests at 25 ms intervals; all 205 were accepted. This can grow
   server memory and makes room-list broadcasts progressively more expensive.

3. **FFA Elo is not zero-sum.** [`ffaDeltas`](../results/kimi-k3.1-pro/packages/shared/src/elo.ts#L26)
   independently rounds each participant's floating delta. With ratings
   `[800, 800, 1000, 800]`, placements `[1, 2, 3, 4]`, and zero prior games, it
   returns `[38, 16, -27, -26]`, a net **+1** rating point. Other fixtures produce
   a net -1. Existing Elo tests cover equal ratings and ties but miss uneven ratings.

4. **Revenge lobs are unavailable in ranked play.** [`updateRevenge`](../results/kimi-k3.1-pro/packages/shared/src/sim.ts#L369)
   exits whenever `state.config.ranked` is true. The lobby configuration also
   disables `revengeDucks` for ranked rooms. The spec calls for a revenge throw after
   elimination, but no ranked exception is provided.

5. **Automated coverage is solid for local logic but light end to end.** The suite
   verifies meaningful simulation invariants, Elo fixtures, and SQLite behavior.
   It does not test client-server protocol integration, ranked matchmaking, reconnect
   behavior, room capacity, or browser progression. The soak checks deterministic
   clone agreement and Hard's win gate, but only across eight duel seeds.

## Reproduction

From the submission directory:

```sh
npm ci
npm test
npm run build
npm run typecheck
npm run soak
```

The evaluation screenshot is [`Kimi K3.1 Pro practice`](screenshots/kimi-k3.1-pro-practice.png).
