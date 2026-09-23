import { describe, expect, it } from 'vitest';
import { speedUnitsPerTick } from '../src/config';
import { ALL_DIRS, idx, tileCenter, tileOf } from '../src/grid';
import { generateMap } from '../src/map';
import { isSolidFor, movePlayer, playerTile } from '../src/movement';
import { hashSeed, mulberry32, randInt } from '../src/rng';
import { balloonAt, createRoundState, makeRules } from '../src/state';
import { Dir, Tile, type DirCode } from '../src/types';
import { dropBalloon, inp, ofType, placePlayer, runTicks, stateFromAscii, walkPath } from './fixtures';

const OPEN = ['#######', '#0....#', '#.#.#.#', '#.....#', '#######'];

describe('lane snapping', () => {
  it('corner assist slides onto the open neighbour lane around a pillar, leftover speed continues', () => {
    const s = stateFromAscii(OPEN);
    const p = s.players[0];
    p.x = tileCenter(2) - 1200; // column 2 has a pillar below; offset toward open column 1
    p.y = tileCenter(1);
    const xs: number[] = [];
    for (let t = 0; t < 5; t++) {
      movePlayer(s, p, Dir.Down, false);
      xs.push(p.x);
    }
    expect(speedUnitsPerTick(0)).toBe(400);
    expect(xs).toEqual([5900, 5500, 5100, 4700, 4500]);
    expect(p.y).toBe(tileCenter(1) + 200);
    expect(p.moving).toBe(true);
  });

  it('re-centers instead of deadlocking when the corner lane is blocked', () => {
    const s = stateFromAscii(['#######', '#0....#', '#C#.#.#', '#.....#', '#######']);
    const p = s.players[0];
    p.x = tileCenter(2) - 1200;
    p.y = tileCenter(1);
    for (let t = 0; t < 3; t++) movePlayer(s, p, Dir.Down, false);
    expect(p.x).toBe(tileCenter(2));
    expect(p.y).toBe(tileCenter(1));
    movePlayer(s, p, Dir.Down, false);
    expect(p.moving).toBe(false);
    movePlayer(s, p, Dir.Right, false);
    expect(p.x).toBe(tileCenter(2) + 400);
    expect(p.facing).toBe(Dir.Right);
  });

  it('keeps the current lane when its tile ahead is open', () => {
    const s = stateFromAscii(OPEN);
    const p = s.players[0];
    p.x = tileCenter(1) + 300;
    p.y = tileCenter(1);
    movePlayer(s, p, Dir.Down, false);
    expect(p.x).toBe(tileCenter(1));
    expect(p.y).toBe(tileCenter(1) + 100);
  });
});

describe('solid tiles', () => {
  it('cannot enter boulders or the border', () => {
    const s = stateFromAscii(OPEN);
    const p = s.players[0];
    for (const dir of [Dir.Up, Dir.Left]) {
      movePlayer(s, p, dir, false);
      expect([p.x, p.y]).toEqual([tileCenter(1), tileCenter(1)]);
      expect(p.moving).toBe(false);
    }
    for (let t = 0; t < 40; t++) movePlayer(s, p, Dir.Right, false);
    expect(playerTile(p)).toEqual({ tx: 5, ty: 1 });
    expect(p.x).toBe(tileCenter(5));
  });

  it('clamps at the tile center before a castle and never pushes back', () => {
    const s = stateFromAscii(['#######', '#0.C..#', '#.#.#.#', '#.....#', '#######']);
    const p = s.players[0];
    for (let t = 0; t < 20; t++) movePlayer(s, p, Dir.Right, false);
    expect(p.x).toBe(tileCenter(2));
    expect(isSolidFor(s, 0, 3, 1)).toBe(true);
    p.x = tileCenter(2) + 200;
    movePlayer(s, p, Dir.Right, false);
    expect(p.x).toBe(tileCenter(2) + 200);
  });

  it('treats out-of-bounds as solid and flooded floor as walkable', () => {
    const s = stateFromAscii(OPEN);
    expect(isSolidFor(s, 0, -1, 1)).toBe(true);
    expect(isSolidFor(s, 0, 7, 1)).toBe(true);
    s.tideLevel = 1;
    expect(isSolidFor(s, 0, 1, 1)).toBe(false);
  });
});

describe('balloon walk-off', () => {
  const MAP = ['#######', '#0...1#', '#.#.#.#', '#.....#', '#######'];

  it('lets the owner walk off their balloon but not back on after leaving', () => {
    const s = stateFromAscii(MAP);
    const events = dropBalloon(s, 0);
    expect(ofType(events, 'balloon_placed')).toEqual([{ type: 'balloon_placed', id: 1, x: 1, y: 1, owner: 0 }]);
    const b = balloonAt(s, 1, 1)!;
    expect(b.passMask).toBe(0b01);
    walkPath(s, 0, [[2, 1]]);
    expect(b.passMask).toBe(0);
    const x = s.players[0].x;
    runTicks(s, 5, [inp(Dir.Left)]);
    expect(s.players[0].x).toBe(x);
    expect(s.players[0].moving).toBe(false);
  });

  it('lets the owner step back while still overlapping the balloon tile', () => {
    const s = stateFromAscii(MAP);
    dropBalloon(s, 0);
    runTicks(s, 3, [inp(Dir.Right)]);
    expect(balloonAt(s, 1, 1)!.passMask).toBe(0b01);
    const x = s.players[0].x;
    runTicks(s, 1, [inp(Dir.Left)]);
    expect(s.players[0].x).toBe(x - 400);
  });

  it('blocks other players', () => {
    const s = stateFromAscii(MAP);
    dropBalloon(s, 0);
    walkPath(s, 0, [[1, 3]]);
    walkPath(s, 1, [[2, 1]]);
    runTicks(s, 10, [null, inp(Dir.Left)]);
    expect(s.players[1].x).toBe(tileCenter(2));
    expect(isSolidFor(s, 1, 1, 1)).toBe(true);
  });

  it('gives a walk-off bit to every player overlapping the tile when it is placed', () => {
    const s = stateFromAscii(MAP);
    const other = placePlayer(s, 1, 2, 1);
    other.x = tileCenter(2) - 1400; // overlaps tile (1,1)
    dropBalloon(s, 0);
    expect(balloonAt(s, 1, 1)!.passMask).toBe(0b11);
  });
});

describe('movement invariants (random walk fuzz)', () => {
  it('never enters solid tiles, stays on a lane in at least one axis, and never gets stuck', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const map = generateMap('ffa', seed);
      for (let i = 0; i < map.tiles.length; i += 3) if (map.tiles[i] === Tile.Castle) map.tiles[i] = Tile.Floor;
      const s = createRoundState(map, [true, false, false, false], makeRules({ ranked: false }));
      const p = s.players[0];
      p.speedUps = seed % 9;
      const rng = mulberry32(hashSeed(seed));
      const violations: string[] = [];
      let dir: DirCode = Dir.Right;
      for (let t = 0; t < 3000; t++) {
        if (randInt(rng, 6) === 0) dir = ALL_DIRS[randInt(rng, 4)];
        movePlayer(s, p, dir, false);
        const tx = tileOf(p.x);
        const ty = tileOf(p.y);
        if (s.tiles[idx(s.w, tx, ty)] !== Tile.Floor) violations.push(`seed ${seed} t ${t}: inside solid (${tx},${ty})`);
        if (p.x !== tileCenter(tx) && p.y !== tileCenter(ty)) violations.push(`seed ${seed} t ${t}: off both lanes`);
      }
      expect(violations).toEqual([]);
      // From wherever the walk ended, some direction always makes progress within a tile's travel.
      const escapes = ALL_DIRS.some((d) => {
        const probe = { ...p };
        for (let t = 0; t < 10; t++) movePlayer(s, probe, d, false);
        return probe.x !== p.x || probe.y !== p.y;
      });
      expect(escapes).toBe(true);
    }
  });
});
