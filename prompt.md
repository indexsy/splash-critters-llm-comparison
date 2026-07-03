# Prompt: SPLASH CRITTERS — 8-Bit Online Water Balloon Battler (Full Game, Beginning to End)

Build a complete, shippable browser game called **Splash Critters** (working title — pick a final name later): an 8-bit online arena battler where cute pixel animals drop **water balloons** that burst into cross-shaped **splashes**, washing away **sandcastles** and soaking opponents. Last critter dry wins. Up to 4 players online, server-side AI bots in casual play, ranked Elo matchmaking for 1v1 and 4-player free-for-all, a public room browser, accounts, progression, and cosmetics. This is an original game — do not reference or copy Bomberman assets, names, or characters anywhere in code or UI.

Build it end to end following the milestones at the bottom. Follow this spec exactly.

---

## 1. Tech stack (use exactly this)

- **Language:** TypeScript 5.x everywhere, strict mode, ES modules
- **Runtime:** Node.js ≥ 20 LTS
- **Monorepo:** npm workspaces, three packages: `shared`, `server`, `client`
- **shared:** zero-dependency pure TS — types, CONFIG, seeded PRNG (mulberry32), map generator, deterministic `simulateTick(state, inputs)`. Identical code runs on server (authority) and client (prediction).
- **server:** `ws` (^8) for WebSockets + `express` serving the built client, REST API, and `/health`, all on one `PORT`. **Database: SQLite via `better-sqlite3`** (single file, WAL mode, numbered SQL migrations run at boot; store at `DATA_DIR/splash.db` so it persists on a mounted volume). Bots, matchmaker, and Elo all run server-side.
- **client:** Vite 5 + vanilla TypeScript — **no React, no Phaser**. Canvas 2D rendering, Web Audio API sound. Vite dev proxy for `/ws` and `/api`.
- **Testing:** Vitest for shared sim (splash propagation, chain bursts, RNG determinism) and Elo math (fixture-based); a headless bot-vs-bot soak script that completes a full match with no crash/desync.
- **Deploy:** single Node process, Dockerfile, Railway/Fly/Render-ready behind a reverse proxy (`wss://` support). Scripts: `npm run dev` (server :3000, client :5173), `npm run build && npm start` (one port). Desktop web only for v1 (no touch controls).

### Folder structure

```
splash-critters/
├─ package.json / tsconfig.base.json / Dockerfile
└─ packages/
   ├─ shared/src/ config.ts, types.ts, rng.ts, map.ts, sim.ts, protocol.ts, elo.ts
   ├─ server/src/
   │  ├─ index.ts, net.ts (validation + rate limit), rooms.ts, gameLoop.ts
   │  ├─ matchmaker.ts, elo.ts (apply/persist), db/ (migrations, queries)
   │  └─ bots/ dangerMap.ts, bot.ts
   └─ client/
      ├─ index.html
      └─ src/ main.ts, net.ts, prediction.ts, audio.ts,
              render/ (sprites.ts, hud.ts, particles.ts),
              screens/ (title.ts, tutorial.ts, menu.ts, browser.ts, lobby.ts,
                        queue.ts, game.ts, results.ts, leaderboard.ts,
                        locker.ts, settings.ts)
```

---

## 2. Accounts & identity (lightweight, no passwords)

- First visit: client generates a UUID device token → `hello{token?}` → server creates a guest player with a generated name like `SoggyOtter#4821`; returns `welcome{playerId, profile, token}`. Token stored in localStorage; hash stored server-side.
- Player can set a nickname (3–16 chars, profanity-filtered, unique with #tag suffix) — required before ranked queue.
- No OAuth/passwords in v1. Losing the token = losing the account; say so in Settings.

**DB tables:** `players(id, token_hash, nickname, tag, created_at, xp, level, selected_animal, selected_hat)`, `ratings(player_id, mode, rating, games, wins, peak)`, `matches(id, mode, ranked, started_at, ended_at)`, `match_players(match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)`, `unlocks(player_id, item_id, unlocked_at)`.

---

## 3. Game modes & lobbies

**Modes:**
- **Duel (1v1):** 13×11 arena, first to 3 round wins.
- **Free-for-All (4p):** 15×13 arena, first to 3 round wins.

**Ranked (matchmaker, humans only — never bots):**
- Separate queues and separate Elo ratings for Duel and FFA.
- Matchmaker ticks every 2s; matches players within ±100 rating, widening +50 every 10s, cap ±400. Shows live queue status (`queue_status{eta, searchRange}`).
- Ranked disconnect: 15s reconnect grace; failing that, forfeit loss (opponents credited a win; in FFA the leaver takes last place). No bot substitution in ranked.

**Casual (multi-room lobby system):**
- **Public room browser:** live list of open casual rooms — name, mode (2p/4p), players `n/max`, map theme, host. Filter by mode; refresh; join in one click.
- **Private rooms:** 6-char code + shareable link `/#/room/CODE`.
- Create-room dialog: room name, size (**2-player or 4-player**), public/private, map theme (Backyard / Beach / Pool Party / random), rounds to win (2/3/5), bot fill toggle.
- Host assigns empty slots to **bots with per-slot difficulty (Easy/Medium/Hard)**. Casual disconnects convert to a Medium bot after 15s. Post-match rematch vote (majority restarts same room).
- Server hosts many rooms concurrently; rooms GC after 10 min idle. Ranked matches run in hidden rooms created by the matchmaker.

---

## 4. Core gameplay

**Arena:** grid per mode above. Border + pillars at even (x,y) = indestructible **boulders**. ~75% of remaining tiles = destructible **sandcastles**, generated from the round's `mapSeed`. Corner spawns (FFA) / opposite corners (Duel), spawn tile + 2 adjacent tiles per direction kept clear.

**Player stats (upgradeable):**
- `speed` — base 4.0 tiles/sec, +0.4 per Flippers, cap 7.0
- `balloonCount` — max simultaneous balloons, base 1, cap 8
- `splashRange` — splash reach in tiles per direction, base 2, cap 10

**Water balloons:**
- Dropped on the occupied tile (Space or E; WASD or arrows to move). One per tile; fuse = **90 server ticks (3.0s)** with a wobble/inflate animation; solid after placement but the owner may walk off it. Server-validated.
- **Burst:** cross-shaped splash up to `splashRange` per direction; blocked by boulders; washes away the FIRST sandcastle per direction and stops; splash lingers 12 ticks (~0.4s). Splash soaks players (elimination) and destroys exposed power-ups.
- **Chain splashes (required):** any balloon touched by a splash bursts immediately; resolve the whole cascade in one server tick via a queue/BFS; chained balloons use their own `splashRange`. Emit `chain_burst` events — the client announces "DOUBLE SPLASH!" / "TRIPLE SPLASH!+" with escalating jingles.
- Last two players soaked on the same tick = draw round.
- **Balloon Kick (depth mechanic, config `ENABLE_KICK: true`):** the rare Rubber Boots power-up lets you walk into a balloon to kick it — it slides tile-by-tile in that direction until hitting a boulder, sandcastle, balloon, or player, keeping its fuse. Fully server-simulated and included in the shared sim + bot danger map.

**Power-ups — RNG, hidden inside sandcastles:**
- **Pre-rolled at map generation** with the round's seeded PRNG: every sandcastle's contents are fixed the moment the map spawns; contents are never sent to clients until revealed (unguessable, unhackable). Deterministic per seed for tests/replays.
- Per castle: `POWERUP_BLOCK_CHANCE = 0.30`, then weighted table (all in CONFIG):
  - **Extra Balloon** (+1 balloonCount) — 0.38
  - **Big Splash** (+1 splashRange) — 0.38
  - **Flippers** (+speed) — 0.19
  - **Rubber Boots** (kick, once per player per round) — 0.05
- Revealed on castle wash-away (`powerup_revealed`), drawn as chunky 8-bit icons, collected on contact (server-validated), destroyed if splashed while exposed.

**Round timer & sudden death — Rising Tide:** at 2:00 the water level rises: tiles flood inward from the perimeter one ring per ~1.5s (animated water). Flooded tiles soak anyone standing there and dissolve sandcastles. Showdown music speeds up when 2 players remain.

**Revenge Ducks (casual-only fun, config `ENABLE_REVENGE_DUCKS`, default ON casual / OFF ranked):** soaked players ride rubber duckies around the arena border and can lob one straight 3-tile balloon every 5s. Revenge soaks count in stats but score no points — it keeps eliminated players engaged instead of alt-tabbing.

**Emotes:** keys 1–4 fire quick animal-sound emotes (quack, ribbit, squeak, honk) with a pixel speech bubble; rate-limited server-side.

---

## 5. Ranked & Elo

Implement in `shared/elo.ts` (pure functions + unit tests):
- Start 1000. K = 64 for a player's first 10 games in a mode, then 32.
- **Duel:** standard Elo. Win = 1, loss = 0 (no draws possible at first-to-3).
- **FFA (4p):** pairwise Elo — final placement (by round wins, tiebreak total soaks; unresolved ties share placement) gives each pair a score (win 1 / tie 0.5 / loss 0); each player's delta = Σ over the other 3 of `K′(S − E)` with `K′ = K/3`.
- Persist `rating_before/after` per match; update `peak`.
- **Rank tiers** (CONFIG bands, shown as pixel badges): Puddle <1000 · Pond 1000–1149 · River 1150–1299 · Lake 1300–1499 · Ocean 1500–1749 · **Tsunami 1750+**.
- REST: `GET /api/leaderboard?mode=duel|ffa` (top 100: rank, nickname#tag, rating, tier, games, winrate) and `GET /api/profile/:id` (ratings, recent matches, level, unlocks).

---

## 6. Progression & cosmetics (all cosmetic, never pay/power)

- XP per match: participation + placement + soaks + castles washed (rates in CONFIG). Level curve: `xpForLevel(n) = 100 + 25n`.
- Levels unlock **animals** and **hats** in the Locker: start with Frog & Duck; unlock Otter, Penguin, Cat (hates water — extra-dramatic soak animation), Raccoon, Turtle, and **Capybara** (level 20 flex). Hats: bucket hat, snorkel, tiny crown, pirate bandana, propeller cap.
- Locker screen: pick animal + hat, live 8-bit preview with walk cycle.

---

## 7. Full player journey (beginning → end)

1. **First visit:** auto guest account → animated pixel title screen → **Tutorial** (skippable, <2 min): scripted small arena vs one Easy bot — move → drop a balloon behind a sandcastle and dodge → grab a power-up → chain two balloons → soak the bot. Completion grants first XP.
2. **Main menu:** Play Ranked (Duel / Free-for-All) · Casual (Browse Rooms / Create Room / Join by Code) · Practice vs Bots (offline-style solo room) · Leaderboard · Locker · How to Play · Settings.
3. **Queue screen:** mode, elapsed time, current search range, cancel.
4. **Match intro:** VS card with animals, nicknames, tiers/ratings (ranked), map theme → Round 1 "3-2-1-SPLASH!"
5. **In match:** HUD per player (animal icon, nickname, live stats, round score, ping); kill-feed ("DuckyDan soaked SoggyCat!"); round results between rounds.
6. **Match results:** placements, fun stats (Most Soaks, Castle Crusher, Longest Survivor, Biggest Chain), XP bar animation, rating change with tier progress (ranked), rematch vote (casual), continue.
7. **Settings:** SFX/music volume, mute (M), keybind remap, colorblind-safe splash palette toggle, reduced screen shake, delete-account note about token.

---

## 8. Netcode (server-authoritative)

- Server sim **30Hz** fixed tick; snapshots **15Hz**; clients send inputs only (`{seq, tick, dir, balloonPressed}` sampled 60Hz, sent 30Hz).
- Client prediction for the local player with ~1s input buffer and rewind-replay reconciliation on snapshots; remote entities interpolate at `serverTime − 100ms`; ping/pong every 2s for clock offset; balloon fuses render from server tick timestamps.
- Snapshots carry dynamic state (players, balloons, splashes, exposed power-ups, tide ring); sandcastle grid sent at `round_start`; destructions as events.
- Anti-cheat basics: server validates speed/collision/balloon availability/tile occupancy, ignores impossible inputs, rate-limits 60 msgs/sec, never trusts client positions.

**Protocol (`protocol.ts`, discriminated unions):**
- C→S: `hello`, `set_nickname`, `queue_join{mode}`, `queue_leave`, `create_room{opts}`, `join_room{code}`, `room_list_request`, `leave_room`, `set_slot{slot, kind, difficulty}`, `set_ready`, `start_match`, `input`, `emote{id}`, `rematch_vote`, `pong{t}`.
- S→C: `welcome`, `error{code,msg}`, `queue_status`, `match_found`, `room_created`, `room_list{rooms[]}`, `lobby_state`, `match_start{config}`, `round_start{roundNo, mapSeed, castleGrid, theme}`, `snapshot`, `event{castle_washed | powerup_revealed | powerup_collected | player_soaked | chain_burst | balloon_kicked | tide_advance | revenge_lob}`, `round_end`, `match_end{placements, ratingDeltas, xp}`, `ping{t}`.

---

## 9. Server-side bots (casual & practice)

Shared foundation: a **danger map** recomputed every tick — for each live balloon (including sliding kicked ones), mark all splash tiles with time-to-burst, **propagating chains** (balloon B inside A's splash inherits `min(B, A)`); a tile is unsafe if the bot can't exit before burst + splash duration. Rising tide tiles are permanently unsafe.

Decision loop (BFS; boulders, castles, balloons are obstacles): 1) flee if current tile is dangerous; 2) never place a balloon without simulating its splash + existing dangers and confirming a reachable safe tile; 3) otherwise farm castles, collect power-ups, or attack.

- **Easy:** ~450ms decisions, wanders/farms, 10–15% danger misjudgment, rarely attacks.
- **Medium:** ~250ms, full danger awareness, balanced farm/collect, attacks within ~4 tiles, always verifies escape.
- **Hard:** ~120ms, zero mistakes, hunts nearest player, predicts movement, cuts escape corridors, engineers chain bursts, uses kicks if it has Boots, power-ups early → aggression late.

---

## 10. 8-bit presentation

- Internal resolution 256×224, integer-scaled, `image-rendering: pixelated`. NES-ish limited palette.
- All art procedural/embedded pixel data: animal sprites with 2-frame walk cycles + hats, balloon wobble, expanding splash sprays with droplet particles, dramatic soak animation, sandcastle crumble, tide water shimmer, rubber duckies.
- Three tilesets (Backyard grass/fence, Beach sand/shells, Pool tiles/floaties) — pure reskins over identical logic.
- Audio via Web Audio oscillators (square/triangle/noise): drop, burst, chain jingle (escalating), pickup, soak "sploosh", tide alarm, victory fanfare; simple looping chiptune per screen with showdown speed-up. Mute on M.
- Juice: subtle screen shake on bursts (toggleable), particles, hit-stop 2 ticks on soaks, kill feed, announcer text pops.

---

## 11. CONFIG (single typed object in `shared/config.ts`)

Tick/snapshot rates, interpolation delay, stat bases/caps, fuse & splash ticks, castle density, `POWERUP_BLOCK_CHANCE` + drop weights, `ENABLE_KICK`, `ENABLE_REVENGE_DUCKS` (+ per-ranked override), tide start/interval, bot intervals/error rates, matchmaking ranges/widening, K-factors, tier bands, XP rates, level curve, reconnect grace, room TTL, rate limits.

---

## 12. Build order (milestones — each one playable/demoable)

1. **M1 — Core sim:** shared sim + map gen + balloons/splashes/chains/power-ups with Vitest green; local single-screen debug harness with one keyboard player + one Hard bot.
2. **M2 — Netcode:** rooms by code, 2 tabs playing with prediction/interpolation; artificial-latency dev flag.
3. **M3 — Bots online:** bot slots + difficulties in casual rooms; full 4p matches with mixed humans/bots; kick mechanic in sim + bots.
4. **M4 — Lobby system:** public room browser, create-room options, 2p and 4p rooms, rematch voting, map themes, tide sudden death, revenge ducks, emotes.
5. **M5 — Ranked:** accounts/tokens, SQLite, Duel + FFA queues, Elo with pairwise FFA math, leaderboard + profile API/screens, forfeit handling.
6. **M6 — Full product:** tutorial, XP/levels/locker/cosmetics, settings/accessibility, all screens polished, audio pass, soak-test script, Dockerfile, README with deploy steps.

## 13. Acceptance criteria

- Fresh browser: guest auto-created → tutorial completes → main menu, all in under 3 minutes.
- Tab A creates a public 4p room with 2 Hard bots; Tab B sees it in the browser list, joins, and a full match completes with correct results and XP.
- Tabs A+B queue ranked Duel → matched → finish → both ratings update in SQLite and the leaderboard reflects it after refresh.
- With a 150ms artificial-latency flag, local movement feels instant and remote players don't rubber-band.
- Vitest passes: a 3-balloon chain bursts in one tick; splash stops at the first sandcastle; identical seed → identical map + identical hidden power-up contents; Elo fixtures (duel + 4p pairwise) match expected values.
- Bots never freeze or soak themselves; Hard reliably beats Easy.
- `npm run build && npm start` serves everything on one port; Dockerfile deploys with SQLite persisting on a volume.
