// Loot-secrecy check on the Opus 5.5 entry, run by the orchestrator (itself Claude Opus 5.5).
// Server: contents = sfc32(secretContentKey()) where the key is 128 bits from node:crypto
// (rounds.ts secretContentKey -> randomFillSync(new Uint32Array(4))), fresh per round.
// The wire carries a COSMETIC mapSeed plus the castleGrid; neither is a function of the key.
// Test 1: attacker vs an independent-secret control (both should sit at chance).
// Test 2: information ceiling: bits an attacker could learn if EVERY castle in a round were revealed.
// @ts-ignore
import { generateMap } from "../../results/opus-5.5/packages/shared/src/map.ts";
// @ts-ignore
import { CONFIG } from "../../results/opus-5.5/packages/shared/src/config.ts";
import { randomFillSync, randomInt } from "node:crypto";
const key = () => { const w = randomFillSync(new Uint32Array(4)); return [w[0], w[1], w[2], w[3]] as const; };
let T = 400, att = 0, ctrl = 0, castles = 0;
for (let t = 0; t < T; t++) {
  const seed = randomInt(0x7fffffff);
  const truth: any = generateMap("duel", seed, key());
  const ctl: any = generateMap("duel", seed, key());
  const guess: any = generateMap("duel", seed);          // derivable default key from the layout seed
  for (let i = 0; i < truth.hidden.length; i++) {
    if (truth.tiles[i] === 2) castles++;
    if (truth.hidden[i] && truth.hidden[i] === guess.hidden[i]) att++;
    if (truth.hidden[i] && truth.hidden[i] === ctl.hidden[i]) ctrl++;
  }
}
const w: Record<string, number> = (CONFIG as any).POWERUP_WEIGHTS; const p = (CONFIG as any).POWERUP_BLOCK_CHANCE;
const ws = Object.values(w); const S = ws.reduce((a, b) => a + b, 0);
const hK = -ws.reduce((a, x) => a + (x / S) * Math.log2(x / S), 0);
const hC = -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p)) + p * hK;
console.log(`attacker hits/map ${(att / T).toFixed(2)} vs control ${(ctrl / T).toFixed(2)} (chance)`);
console.log(`full-round info ceiling ~${(hC * castles / T).toFixed(0)} bits of a 128-bit key`);
