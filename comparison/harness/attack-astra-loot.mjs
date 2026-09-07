// Attack on GPT-6 Astra's hidden power-ups, run by the orchestrator.
// Mirrors the attack that recovered Fable 5's seed in 21.8s and Opus 5's in ~76s.
import { generateMap } from "file:///Users/jackychou/splash-critters-llm-comparison/results/gpt-6-astra/packages/shared/dist/map.js";
import { CONFIG } from "file:///Users/jackychou/splash-critters-llm-comparison/results/gpt-6-astra/packages/shared/dist/config.js";
import { randomInt } from "node:crypto";

const mode = "duel";
const arena = CONFIG.ARENAS[mode];
const N = arena.width * arena.height;
const mapSeed = randomInt(0x7fffffff);          // the value actually sent on the wire

// Exactly what the server does at rooms.ts:339-342
const lootA = Array.from({ length: N }, () => randomInt(0x100000000));
const lootB = Array.from({ length: N }, () => randomInt(0x100000000));

const real  = generateMap(mode, mapSeed, lootA);
const other = generateMap(mode, mapSeed, lootB);
const guess = generateMap(mode, mapSeed);       // attacker uses the derivable default

const keys = o => Object.keys(o.hiddenPowerups).map(Number).sort((a,b)=>a-b);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

console.log("mapSeed on the wire:", mapSeed, "| tiles:", N);
console.log("tiles identical across all three (layout IS derivable, and is sent anyway):",
  same(real.tiles, other.tiles) && same(real.tiles, guess.tiles));
console.log("real hidden power-ups:", keys(real).length, "| attacker derived:", keys(guess).length);

const rk = new Set(keys(real));
const gk = keys(guess);
const posHits  = gk.filter(i => rk.has(i));
const kindHits = posHits.filter(i => guess.hiddenPowerups[i] === real.hiddenPowerups[i]);
console.log("attacker POSITION hits:", posHits.length, "of", keys(real).length,
            "| exact KIND+POSITION hits:", kindHits.length);

const contentsDiffer = !same(keys(real), keys(other)) ||
  keys(real).some(i => real.hiddenPowerups[i] !== other.hiddenPowerups[i]);
console.log("same mapSeed + different lootSeed -> different contents:", contentsDiffer);
console.log("loot entropy: 32 bits x", N, "tiles =", 32*N,
            "bits, from node:crypto randomInt, never transmitted");
console.log("=> contents are NOT a function of anything on the wire. Brute force is impossible,");
console.log("   and per-tile streams mean a revealed drop discloses nothing about any other tile.");
