# Splash Critters — Build Brain (TODO / progress log)

8-bit online water-balloon battler. Monorepo: `shared` (pure deterministic sim), `server` (ws + express + SQLite + bots + Elo), `client` (Vite + Canvas2D + Web Audio). Built from scratch per `~/Downloads/prompt.md`. Do NOT reference any other codebase.

## STATUS: COMPLETE ✅ (all 6 milestones)
Built from scratch. `npm test` (22 green), `npm run soak` (PASSED), `npx tsc -b` clean,
`npm run build` OK. Verified in a real browser: guest auto-create → title → menu →
practice → full match (countdown, gameplay, chains, kill feed, revenge ducks, powerups,
HUD) → results (placements + awards + XP bar) → lobby. Reconnect works. Server on one
port serves built client + /ws + REST. Dockerfile provided (not built in this session).
Manual test left to owner: 2-tab multiplayer (rooms by code), ranked matchmaking (needs
2+ humans), audio (start muted via localStorage during dev). Artificial latency: `?lag=150`.

## Milestones
- [~] **M1 — Core sim**: shared sim + map gen + balloons/splash/chains/power-ups; Vitest GREEN (22 tests: chain-in-one-tick, splash-stops-at-castle, boulder-block, soak/draw, place/fuse/cap, kick-slide, map+sim determinism, Elo duel+FFA fixtures, placements, tiers). shared typechecks clean. Debug harness pending (client).
- [ ] **M2 — Netcode**: rooms by code, 2 tabs w/ prediction + interpolation; artificial-latency dev flag.
- [ ] **M3 — Bots online**: bot slots + difficulties; 4p mixed matches; kick mechanic in sim + bots.
- [ ] **M4 — Lobby**: public browser, create-room, 2p/4p, rematch vote, themes, tide sudden death, revenge ducks, emotes.
- [ ] **M5 — Ranked**: accounts/tokens, SQLite, Duel + FFA queues, Elo (pairwise FFA), leaderboard + profile API/screens, forfeit.
- [x] **M6 — Full product**: tutorial, XP/levels/locker, settings/accessibility, all 12 screens, audio pass (chiptune), soak script (PASSED), Dockerfile, README.

## Build order (dependency-first)
1. [x] Scaffolding: root pkg, tsconfig, workspaces, Dockerfile, .gitignore
2. [ ] shared: config.ts, types.ts, rng.ts, map.ts, sim.ts, protocol.ts, elo.ts (+ index barrel)
3. [ ] shared tests: sim (chain/splash/determinism), elo fixtures — Vitest green
4. [x] server: db (migrations+queries), index.ts, net.ts, room/roomManager, match, gameLoop, matchmaker, results(elo+xp), bots(dangerMap+bot), handlers — typechecks clean; SOAK PASSED (FFA completes w/ 299 castles; 11/11 duels complete; Hard beats Easy 8/11).
5. [x] client: main.ts, store, net, prediction (predict+reconcile+interp), input, audio (chiptune synth), render/(pixel,sprites,particles,world,hud), 12 screens. Typechecks + Vite build clean (59KB). VERIFIED in real browser: guest auto-created, title→menu→practice, full 4p match renders (backyard theme, animals+hats, sandcastles, splashes, powerups, kill feed, HUD), reconnect works.
6. [x] soak script — PASSES reliably: FFA completes, all-Hard self-soak ~3% (bots don't suicide), Hard beats Easy ~70% (30 duels). Bot tuning: strict escape-commitment (retreat to fully-safe before re-engaging) = key to no self-soak; Easy recklessness (misjudge 0.25 + place-without-escape 0.4) = the Hard>Easy skill gap.
7. [ ] Dockerfile verified, README with deploy steps

## Bot design notes (hard-won)
- simulateTick is deterministic (no RNG); bots run SERVER-ONLY and may use Math.random (they feed inputs like players; client never simulates them).
- Self-soak killer: after dropping a balloon, set escaping=true; DON'T re-decide/attack until current tile is fully Infinity-safe. Relaxing this ("out of imminent danger") regressed Hard self-soaks 8→56.
- verifyEscape must budget against the balloon's CHAIN-effective burst tick (dm.dangerAt[cur]), not the raw 90-tick fuse — else it approves placements that chain-burst before escape.
- follow() must not walk into a tile bursting within ~tpt*1.5 (tight), but flee-from-current uses tpt*4 (generous).
- Hard>Easy comes from Easy MISTAKES (spec), not just Hard skill: Easy misjudge 0.25 + reckless-place 0.4, no escape-commitment.

## Key decisions (locked)
- Grid: flat `number[]` of TileType (0 empty,1 boulder,2 sandcastle,3 flooded), idx = y*width+x.
- Coords: players use continuous tile-center coords (float); balloons/powerups on integer tiles.
- Sim: `simulateTick(state, inputs)` MUTATES state, advances tick, returns SimEvent[]. `cloneState` for client rewind-replay.
- Determinism: no Date.now / Math.random in shared. All RNG = mulberry32 seeded from mapSeed. Powerups pre-rolled at map gen (castleContents[]).
- Build: server bundled with esbuild (shared source inlined, node deps external); client via Vite; one Node process serves both on PORT.
- Package name for shared: `@splash/shared`, main = src/index.ts (source; tsx/vite/esbuild all handle TS).

## Notes
- Files < 500 lines. Split by function.
- Ranked never uses bots. Casual disconnect -> Medium bot after 15s.
