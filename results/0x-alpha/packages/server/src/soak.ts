/**
 * Headless soak test: runs a full 4-player bot match through the shared sim
 * with no crashes/desync. Exits non-zero on failure.
 */
import { CONFIG, TICK_MS, createSimState, simulateTick, defaultMatchConfig } from "@sc/shared";
import { createBot, botThink } from "./bots/bot";
import type { SimPlayerInput } from "@sc/shared";

const mode = (process.argv[2] as "duel" | "ffa") ?? "ffa";
const difficulties = ["hard", "easy"].slice(0, mode === "duel" ? 2 : 4);

const config = defaultMatchConfig(mode, { mapSeed: (Math.random() * 0xffffffff) >>> 0 });
const ids = difficulties.map((_, i) => `bot${i}`);
const state = createSimState(config, ids);
const brains = difficulties.map((d, i) => createBot(ids[i]!, d as never));

let rounds = 0;
let ticks = 0;
const maxTicks = CONFIG.tickRate * 60 * 20; // 20 min safety

while (rounds < config.roundsToWin && ticks < maxTicks) {
  const inputs: Record<string, SimPlayerInput> = {};
  for (let i = 0; i < brains.length; i++) {
    inputs[ids[i]!] = botThink(state, brains[i]!);
  }
  const events = simulateTick(state, inputs);
  for (const ev of events) {
    if (ev.type === "player_soaked") {
      const target = state.players.find((p) => p.id === ev.target)!;
      const tile = Math.round(target.y) * config.w + Math.round(target.x);
      console.log(`    soak @tick ${state.tick} tideRing=${state.tideRing} victim=${ev.target} by=${ev.by ?? "?"} revenge=${!!ev.revenge} tileGrid=${state.grid[tile]}`);
    }
  }
  if (state.roundOver) {
    rounds++;
    console.log(`  round ${rounds} winners: [${state.winnerIds.join(", ") || "draw"}]`);
    if (rounds < config.roundsToWin) {
      // reset for next round with fresh seed like the server does
      const seed = (config.mapSeed ^ ((rounds + 1) * 0x9e3779b9)) >>> 0;
      const next = createSimState({ ...config, mapSeed: seed }, ids);
      Object.assign(state, next);
      for (const b of brains) {
        b.decideAt = 0;
        b.targetTile = null;
      }
    }
  }
  ticks++;
}

if (ticks >= maxTicks) {
  console.error("SOAK FAIL: match did not complete in time");
  process.exit(1);
}
console.log(
  `SOAK OK: ${mode} completed ${rounds} rounds in ${ticks} ticks (${((ticks * TICK_MS) / 1000).toFixed(1)}s game time)`,
);
for (const p of state.players) {
  console.log(`  ${p.id}: soaks=${p.soaks} castles=${p.castlesWashed} revengeSoaks=${p.revengeSoaks}`);
}
