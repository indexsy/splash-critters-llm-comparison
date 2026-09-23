// DangerMap: chain propagation, hypothetical balloons, the tide, and a property check that its
// predictions match what the real simulation does tick by tick.
import { describe, expect, it } from 'vitest';
import {
  ALL_DIRS,
  CONFIG,
  Tile,
  createRoundState,
  generateMap,
  hashSeed,
  idx,
  isFlooded,
  makeRules,
  mulberry32,
  simulateTick,
  spawnBalloon,
  type RoundState,
} from '@splash/shared';
import { DangerMap, getDangerMap } from '../src/bots/dangerMap';
import { putBalloon, stateFromAscii } from '../../shared/test/fixtures';

const OPEN = [
  '###########',
  '#0........#',
  '#.#.#.#.#.#',
  '#.........#',
  '#.#.#.#.#.#',
  '#........1#',
  '###########',
];

describe('DangerMap', () => {
  it('marks a lone balloon splash from its burst tick for SPLASH_TICKS', () => {
    const s = stateFromAscii(OPEN, { rules: { tide: false } });
    putBalloon(s, 5, 3, 0, { fuse: 40, range: 2 });
    const d = DangerMap.fromState(s);
    expect(d.dangerAt(5, 3)).toBe(40);
    expect(d.dangerAt(7, 3)).toBe(40);
    expect(d.dangerAt(8, 3)).toBe(Infinity);
    expect(d.wetUntil(6, 3)).toBe(40 + CONFIG.SPLASH_TICKS);
    expect(d.isSafeForever(8, 3)).toBe(true);
    expect(d.isSafeForever(5, 1)).toBe(false);
  });

  it('propagates chains: a balloon inside an earlier splash inherits its burst tick', () => {
    const s = stateFromAscii(OPEN, { rules: { tide: false } });
    const early = putBalloon(s, 3, 3, 0, { fuse: 20, range: 2 });
    const late = putBalloon(s, 5, 3, 1, { fuse: 80, range: 3 });
    const d = DangerMap.fromState(s);
    expect(d.burstTickOf(early.id)).toBe(20);
    expect(d.burstTickOf(late.id)).toBe(20);
    // The late balloon's own reach (column 5 and x = 8) turns wet with the early burst.
    expect(d.dangerAt(5, 1)).toBe(20);
    expect(d.dangerAt(8, 3)).toBe(20);
  });

  it('lets a later splash reach past a castle washed by an earlier burst', () => {
    const s = stateFromAscii(
      [
        '#########',
        '#0......#',
        '#.#.#.#.#',
        '#..C....#',
        '#.#.#.#.#',
        '#......1#',
        '#########',
      ],
      { rules: { tide: false } },
    );
    putBalloon(s, 1, 3, 0, { fuse: 30, range: 4 });
    const later = putBalloon(s, 5, 3, 1, { fuse: 70, range: 4 });
    const d = DangerMap.fromState(s);
    // The castle at (3,3) stops the first splash, so no chain: the second balloon keeps its fuse.
    expect(d.burstTickOf(later.id)).toBe(70);
    expect(d.dangerAt(3, 3)).toBe(30);
    expect(d.dangerAt(4, 3)).toBe(70);
    // By tick 70 the castle is gone, so the second splash runs on to (2,3).
    expect(d.isWetAt(idx(s.w, 2, 3), 35)).toBe(true);
    expect(d.isWetAt(idx(s.w, 2, 3), 50)).toBe(false);
    expect(d.isWetAt(idx(s.w, 2, 3), 70)).toBe(true);
  });

  it('tests a hypothetical extra balloon including the chain it would trigger', () => {
    const s = stateFromAscii(OPEN, { rules: { tide: false } });
    putBalloon(s, 1, 3, 1, { fuse: 25, range: 2 });
    const d = DangerMap.fromState(s);
    expect(d.dangerAt(6, 3)).toBe(Infinity);
    const hypo = d.withBalloon(3, 3, 3, 0);
    // (3,3) sits in the pending splash, so the new balloon bursts with it at tick 25.
    expect(hypo.burstTickOf(hypo.nextBalloonId)).toBe(25);
    expect(hypo.dangerAt(6, 3)).toBe(25);
    expect(d.dangerAt(6, 3)).toBe(Infinity);
  });

  it('floods tide rings from their flood tick for good', () => {
    const s = stateFromAscii(OPEN, { rules: { tide: true, tideStartTick: 100 } });
    const d = DangerMap.fromState(s);
    expect(d.dangerAt(1, 1)).toBe(100);
    expect(d.dangerAt(3, 2)).toBe(100 + CONFIG.TIDE_INTERVAL_TICKS);
    expect(d.wetUntil(1, 1)).toBe(Infinity);
    expect(d.isSafeForever(5, 3)).toBe(false);
  });

  it("lets a careless viewer misjudge other players' splashes but never its own", () => {
    const s = stateFromAscii(OPEN, { rules: { tide: false } });
    putBalloon(s, 3, 3, 1, { fuse: 30 });
    putBalloon(s, 7, 1, 0, { fuse: 50 });
    const view = DangerMap.fromState(s).perceivedBy(0, 12);
    expect(view.dangerAt(3, 3)).toBe(42);
    expect(view.dangerAt(7, 1)).toBe(50);
  });

  it('is shared per tick and recomputed when the state changes', () => {
    const s = stateFromAscii(OPEN, { rules: { tide: false } });
    const a = getDangerMap(s);
    expect(getDangerMap(s)).toBe(a);
    putBalloon(s, 5, 3, 0);
    expect(getDangerMap(s)).not.toBe(a);
  });
});

/** A generated arena with random balloons, some castles already washed and a lingering splash. */
function randomScene(seed: number, kicked = false): RoundState {
  const rng = mulberry32(seed);
  const rules = { ...makeRules({ ranked: false }), sandbox: true, tideStartTick: 40 + Math.floor(rng() * 60) };
  const s = createRoundState(generateMap('ffa', seed), [true, true, true, true], rules);
  for (let i = 0; i < s.tiles.length; i++) if (s.tiles[i] === Tile.Castle && rng() < 0.4) s.tiles[i] = Tile.Floor;
  const floor = [...s.tiles.keys()].filter((i) => s.tiles[i] === Tile.Floor);
  for (let k = 0; k < 14; k++) {
    const tile = floor[Math.floor(rng() * floor.length)];
    const tx = tile % s.w;
    const ty = (tile - tx) / s.w;
    if (s.balloons.some((b) => b.tx === tx && b.ty === ty)) continue;
    spawnBalloon(s, { owner: k % 4, tx, ty, burstTick: 1 + Math.floor(rng() * 110), range: 1 + Math.floor(rng() * 6), fromDuck: false });
  }
  const splash = floor[Math.floor(rng() * floor.length)];
  if (!s.balloons.some((b) => idx(s.w, b.tx, b.ty) === splash)) s.splashUntil[splash] = 1 + Math.floor(rng() * CONFIG.SPLASH_TICKS);
  if (kicked) {
    for (const b of s.balloons) {
      if (rng() >= 0.4) continue;
      b.slideDir = ALL_DIRS[Math.floor(rng() * ALL_DIRS.length)];
      b.passMask = 0;
    }
  }
  return s;
}

/** Runs the scene with idle players and calls `check(tile, predictedWet, simulatedWet)` every tick. */
function compareWithSim(s: RoundState, ticks: number, check: (tile: number, predicted: boolean, actual: boolean) => void): void {
  const d = DangerMap.fromState(s);
  for (let step = 0; step < ticks; step++) {
    simulateTick(s, []);
    for (let tile = 0; tile < s.tiles.length; tile++) {
      const tx = tile % s.w;
      if (s.tiles[tile] === Tile.Boulder) continue;
      const actual = s.splashUntil[tile] > s.tick || isFlooded(s, tx, (tile - tx) / s.w);
      check(tile, d.isWetAt(tile, s.tick), actual);
    }
  }
}

describe('DangerMap predictions match the simulation', () => {
  it('predicts exactly when every tile is wet (chains, castle washing, fizzles, tide)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = randomScene(hashSeed(seed, 77));
      compareWithSim(s, 220, (tile, predicted, actual) => {
        if (predicted !== actual) throw new Error(`seed ${seed}: tile ${tile} at tick ${s.tick}: predicted ${predicted}, simulated ${actual}`);
      });
    }
  });

  it('never misses a wet tick when balloons are sliding after kicks', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = randomScene(hashSeed(seed, 91), true);
      compareWithSim(s, 220, (tile, predicted, actual) => {
        if (actual && !predicted) throw new Error(`seed ${seed}: tile ${tile} wet at tick ${s.tick} but predicted dry`);
      });
    }
  });
});
