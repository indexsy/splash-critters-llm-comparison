# Splash Critters — build log & open items

Shared brain across sessions. Newest entries at the top of each section.

## Status: all 6 milestones built (2026-07-02)

- M1 core sim ✅ — shared deterministic sim, map gen w/ pre-rolled power-ups,
  chains resolve in one tick, 28 Vitest tests green
- M2 netcode ✅ — rooms by code, prediction + reconciliation, interpolation,
  `LATENCY_MS` dev flag
- M3 bots online ✅ — per-slot difficulties, kick in sim + danger map,
  soak suite passes (hard beats easy 9/10)
- M4 lobby system ✅ — public browser, create-room options, rematch votes,
  3 themes, rising tide, revenge ducks, emotes
- M5 ranked ✅ — tokens/SQLite, duel+FFA queues, pairwise FFA Elo,
  leaderboard/profile REST + screens, forfeit handling
- M6 full product ✅ — tutorial, XP/levels/locker, settings (remap,
  colorblind, shake), all screens, synth audio, soak + e2e scripts,
  Dockerfile, README

## Verification that has been run

- `npm test` — 28 tests: chain bursts single-tick, splash stops at first
  castle, boulder blocking, seed determinism (map + hidden contents), kick
  slide/stop, tide, draw rounds, Elo fixtures (duel + pairwise FFA + ties)
- `npm run soak` — full bot matches complete, no freezes, hard≥easy 9/10
- `node scripts/e2e.mjs` — real server: guest hello, room browser join,
  4p match w/ bots to completion, XP persistence, ranked queue → forfeit →
  Elo 1032/968, leaderboard reflects it
- `npm run build && npm start` serves everything on :3000

## Known rough edges / next up

- [ ] Hard bots still self-soak occasionally (~20% of rounds) in tight
      corridors; acceptable but could improve escape-time estimation
      (real ticks-per-tile vs BFS estimate under corner assist)
- [ ] Snapshot JSON is uncompressed; fine at 4 players, consider delta
      encoding if rooms grow
- [ ] Duck riders only render at tile resolution (pos rounds to a border
      tile); smooth sub-tile duck movement would look nicer
- [ ] No spectators, no touch controls (explicitly out of scope for v1)
- [ ] Rematch restarts instantly on majority; could show a 3s "rematch!"
      interstitial
- [ ] `.claude/launch.json` exists for the preview tool (port 3000); the
      preview MCP is rooted in another repo so it went unused this session

## Decisions (why things are the way they are)

- `round_start.mapSeed` is a cosmetic-only random value — the REAL seed never
  leaves the server or hidden castle contents would be derivable client-side.
- Server compiles shared into its own dist (`rootDir: ".."`), so `npm start`
  path is `packages/server/dist/server/src/index.js`.
- Two tabs / one browser: second `hello` with an in-use token mints a fresh
  guest (token kept in sessionStorage) so local testing "just works".
- Movement corner assist re-centers into the current lane when straddling a
  blocked neighbor lane — without this, players (and bots) deadlock on pillar
  corners while holding a direction. Regression-tested via soak.
- Draw rounds don't score; `MAX_ROUNDS = 15` caps infinite-draw matches
  (winner = most round wins at the cap).
- Ping is client-initiated: client sends `pong{ts}`, server echoes `ping{ts}`.
