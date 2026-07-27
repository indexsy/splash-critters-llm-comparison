// Optimized seed-recovery attack vs Fable 5 (my own entry), mirroring the technique
// that broke Opus 5: walk the generation stream and reject a candidate seed at the
// FIRST castle-placement mismatch. Attacker input = round_start.castleGrid only.
import { generateMap } from "/Users/jackychou/splash-critters-llm-comparison/results/fable-5/packages/shared/dist/map.js";

const W = 15, H = 13;              // ffa arena
const DENSITY = 0.75, BLOCK = 0.30;
const TILE_EMPTY = 0, TILE_CASTLE = 2;

// Spawn-clear set + border/pillars are seed-independent, so recompute the eligible
// tile list exactly as the generator does.
function eligibleTiles(grid) {
  const out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    const pillar = x % 2 === 0 && y % 2 === 0;
    if (border || pillar) continue;
    if (grid[i] !== TILE_EMPTY && grid[i] !== TILE_CASTLE) continue;
    out.push(i);
  }
  return out;
}

const trueSeed = Math.floor(Math.random() * 0x7fffffff);
const victim = generateMap("ffa", trueSeed);
const grid = victim.grid;
// Tiles the generator actually rolled for = eligible AND not spawn-cleared.
// Spawn-clear tiles are always EMPTY; we can't distinguish them from failed rolls,
// so derive the true roll list by regenerating with any seed and noting which tiles
// the generator touches (structure is seed-independent).
const probe = generateMap("ffa", 12345);
const rolled = [];
for (let i = 0; i < grid.length; i++) {
  if (probe.grid[i] === TILE_CASTLE || (probe.grid[i] === TILE_EMPTY && victim.grid[i] === TILE_CASTLE)) rolled.push(i);
}
// Use the union of positions either map made a castle — a superset of roll sites is
// unsafe, so instead reconstruct precisely: eligible minus spawn-clear.
const eligible = eligibleTiles(probe.grid).filter((i) => {
  // a tile is spawn-cleared iff NO seed ever places a castle there; approximate by
  // checking a few seeds
  for (const s of [1, 7, 99, 4242, 31337]) {
    if (generateMap("ffa", s).grid[i] === TILE_CASTLE) return true;
  }
  return false;
});

const observed = eligible.map((i) => grid[i] === TILE_CASTLE);
const N = eligible.length;

const started = Date.now();
let found = -1, scanned = 0;
for (let s = 0; s < 0x7fffffff; s++) {
  scanned++;
  let a = s >>> 0, ok = true;
  for (let k = 0; k < N; k++) {
    // mulberry32 inline
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r1 = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    const isCastle = r1 < DENSITY;
    if (isCastle !== observed[k]) { ok = false; break; }
    if (isCastle) {
      a = (a + 0x6d2b79f5) | 0;
      let u = Math.imul(a ^ (a >>> 15), 1 | a);
      u = (u + Math.imul(u ^ (u >>> 7), 61 | u)) ^ u;
      const r2 = ((u ^ (u >>> 14)) >>> 0) / 4294967296;
      if (r2 < BLOCK) { // weighted pick consumes one more draw
        a = (a + 0x6d2b79f5) | 0;
        let v = Math.imul(a ^ (a >>> 15), 1 | a);
        v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
      }
    }
  }
  if (ok) { found = s; break; }
  if (scanned % 20000000 === 0) {
    const rate = scanned / ((Date.now() - started) / 1000);
    process.stdout.write(`  ...${(scanned / 1e6).toFixed(0)}M, ${(rate / 1e6).toFixed(1)}M/s\r`);
  }
}
const secs = (Date.now() - started) / 1000;
console.log(`\nconstraint positions: ${N} | true seed: ${trueSeed}`);
if (found >= 0) {
  const rec = generateMap("ffa", found);
  const hid = victim.contents.map((c, i) => (c ? `${i % W},${Math.floor(i / W)}=${c}` : null)).filter(Boolean);
  const got = rec.contents.map((c, i) => (c ? `${i % W},${Math.floor(i / W)}=${c}` : null)).filter(Boolean);
  console.log(`RECOVERED seed ${found} in ${secs.toFixed(1)}s (${(scanned / secs / 1e6).toFixed(1)}M seeds/s)`);
  console.log(`hidden contents match: ${JSON.stringify(hid) === JSON.stringify(got)}  (${hid.length} power-ups exposed)`);
  console.log(`first 6: ${hid.slice(0, 6).join(" ")}`);
} else {
  console.log(`not found; scanned ${(scanned / 1e6).toFixed(0)}M at ${(scanned / secs / 1e6).toFixed(1)}M/s`);
  console.log(`projected full 2^31 sweep: ${(0x7fffffff / (scanned / secs) / 60).toFixed(1)} min single-threaded`);
}
