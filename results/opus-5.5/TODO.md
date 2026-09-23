# Splash Critters build log (shared brain across sessions)

Spec: `docs/SPEC.md`. Design + contracts: `ARCHITECTURE.md`. Remote: github.com/indexsy/splash-critters-opus55 (private).

## Plan
- [x] Scaffold monorepo (npm workspaces shared/server/client), tsconfig, vite, vitest, esbuild
- [x] Contract: shared types, CONFIG, protocol, cosmetics, ARCHITECTURE.md
- [x] Wave 1: shared sim + tests | data layer (elo, progression, db, accounts) | client shell | art | audio
- [x] Wave 2: server core | bots + soak | client game | client menus (each built, reviewed, fixed)
- [x] Integration fixes: independent hidden-item content seed, trigger-based chain soak credit,
      absent players in snapshots, re-attach table status, key-code fallback, inline dialog errors
- [x] Wave 3: Docker PROVEN (one port, image, SQLite on volume, non-root, amd64 buildx, Railway/Fly fixes);
      e2e + browser suites written; bots hunt dummies 30/30 (agents stalled on long commands)
- [x] Wave 3b finding: the '520 s bot decision' and every agent stall were the laptop SLEEPING
      (pmset + CPU profile). Real bot cost avg 70 us / p99 < 1 ms. Soak CPU metric now sleep-aware.
- [x] WS e2e 14/14 PASS (awake). Browser flows 1,3,4,5,6 PASS: fresh load->tutorial->menu 37.8 s;
      ?lag=150 local move <= 1 frame, remote 0 stutters/snaps, corrections 0 px.
- [ ] Bots final: unforced self-soak in tide endgame, forced self-soaks, far fewer tide draws
- [ ] Browser flow2 (4p casual with 2 Hard bots, full match) after bots final
- [ ] Wave 4: multi-lens review (spec, security, netcode, UX, hygiene) -> verify -> fix (running)
- [ ] Final: README verified, all gates green, pushed

## Milestones (spec section 12)
- [x] M1 core sim + vitest (practice vs 1 Hard bot serves as the single-screen harness)
- [x] M2 netcode (rooms by code, prediction/interp, ?lag= flag)
- [x] M3 bots online, 4p mixed matches, kick
- [x] M4 lobby system, browser, rematch, themes, tide, ducks, emotes
- [x] M5 ranked, accounts, SQLite, Elo, leaderboard/profile, forfeits
- [ ] M6 tutorial tuning, soak gate green, Dockerfile verified, README final

## Open items
- Soak gate: Medium/Hard "forced" self-soaks over limit after the chain-credit change
  (bots under-read chains through opponent balloons). Bots unit in wave 3.
- Many rounds end in tide draws (bots rarely trap each other). Bots unit in wave 3.
- Tutorial step 5 (soak the bot) may be too hard for beginners. e2e unit in wave 3.

## Log
- 2026-09-22: scaffold + contract; wave 1 (15 agents); wave 2 (server, bots, client game, menus).
- 2026-09-22: integration fixes, first push, wave 3 launched.
- 2026-09-23: wave 3 checkpoint c55a74a; openDb fails fast on unwritable DATA_DIR; wave 3b launched.
- 2026-09-23: sleep diagnosed; e2e + browser acceptance green; bots-final + final review launched.
