// Attack on Grok 4.7's hidden power-ups, run by the orchestrator.
// Server: this.rng = mulberry32(Date.now() ^ Math.random()) (gameLoop.ts:106)
//         seed     = floor(rng() * 0x7fffffff)      -> BROADCAST as round_start.mapSeed (:272)
//         lootSalt = floor(rng() * 0x7fffffff) + 1  -> "secret", the very next draw (:254)
// mulberry32's entire state is one 32-bit int advancing by 0x6d2b79f5, so the broadcast
// seed pins the state, and the state pins lootSalt.
import { generateMap } from "/Users/jackychou/splash-critters-llm-comparison/results/grok-4.7/packages/shared/src/map.ts";
import { mulberry32 } from "/Users/jackychou/splash-critters-llm-comparison/results/grok-4.7/packages/shared/src/rng.ts";
import { randomInt } from "node:crypto";

const C = 0x6d2b79f5;
const F = (a: number): number => {            // mulberry32 output for post-increment state a
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
};
const W = 13, Hh = 11, PLAYERS = 2;           // duel arena

// ---- server side (ground truth) ----
const server = mulberry32(randomInt(0x100000000));
const burned = randomInt(5000);               // bots + earlier rounds consume the stream
for (let i = 0; i < burned; i++) server();
const seed = Math.floor(server() * 0x7fffffff);
const lootSalt = Math.floor(server() * 0x7fffffff) + 1;
const truth = generateMap({ width: W, height: Hh, seed, players: PLAYERS, lootSalt });

// ---- attacker: knows ONLY the broadcast seed ----
const lo = Math.max(0, 2 * seed - 4), hi = 2 * seed + 6;   // cheap integer prefilter
const t0 = Date.now();
const salts: number[] = [];
for (let m = 0; m < 0x100000000; m++) {
  const o = F(m | 0);
  if (o < lo || o > hi) continue;
  if (Math.floor((o / 4294967296) * 0x7fffffff) !== seed) continue;
  salts.push(Math.floor((F((m + C) | 0) / 4294967296) * 0x7fffffff) + 1);
}
const secs = (Date.now() - t0) / 1000;

const key = (p: { x: number; y: number; kind: string }[]) =>
  p.map((q) => `${q.x},${q.y}:${q.kind}`).sort().join("|");
const truthKey = key(truth.powerups);
const hits = salts.filter((s) => key(generateMap({ width: W, height: Hh, seed, players: PLAYERS, lootSalt: s }).powerups) === truthKey);

console.log(`burned draws before round: ${burned} | broadcast seed: ${seed}`);
console.log(`scanned all 2^32 mulberry32 states in ${secs.toFixed(1)}s (single thread)`);
console.log(`candidate lootSalts: ${salts.length} | true lootSalt among them: ${salts.includes(lootSalt)}`);
console.log(`candidates reproducing ALL ${truth.powerups.length} hidden power-ups exactly: ${hits.length}`);
// How many PUBLIC reveals (castles washed, drop or no drop) until one candidate remains?
const cands = salts.map((s) => generateMap({ width: W, height: Hh, seed, players: PLAYERS, lootSalt: s }));
const castleIdx = truth.tiles.map((t, i) => ({ t, i })).filter((c) => c.t === 2).map((c) => c.i);
const lootAt = (m: typeof truth, i: number) =>
  m.powerups.find((q) => q.y * W + q.x === i)?.kind ?? "none";
const sureTiles = castleIdx.filter((i) => new Set(cands.map((c) => lootAt(c, i))).size === 1).length;
let alive = cands.slice(), reveals = 0;
const order = castleIdx.slice().sort(() => Math.random() - 0.5);  // castles washed in arbitrary order
for (const i of order) {
  if (alive.length <= 1) break;
  reveals++;
  const seen = lootAt(truth, i);
  alive = alive.filter((c) => lootAt(c, i) === seen);
}
console.log(`castles known with certainty from the wire ALONE (all ${cands.length} candidates agree): ${sureTiles} of ${castleIdx.length}`);
console.log(`public reveals needed to pin the exact loot map: ${reveals}`);
console.log(hits.length ? "=> RECOVERED" : "=> not recovered");
