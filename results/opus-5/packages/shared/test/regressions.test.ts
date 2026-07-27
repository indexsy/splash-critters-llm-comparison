/**
 * Fixed bugs, kept fixed.
 *
 * Each test here failed against a real defect in the simulation and would fail
 * again if that defect came back, so the comments say what the bug was rather
 * than only what the rule is.
 */

import { describe, expect, it } from 'vitest';
import { CONFIG, Dir, Tile, setTile, simulateTick, stepEntity, updateSlides } from '../src/index.js';
import { armBalloon, input, makeArena, placeAt } from './helpers.js';

/** Snapshots go out with positions rounded to three decimals. */
function r3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const R = CONFIG.PLAYER_RADIUS;

describe('kicked balloons stop', () => {
  it('halts at the tile before an obstacle instead of sliding through it', () => {
    const state = makeArena();
    placeAt(state, 0, 1, 1);
    placeAt(state, 1, 9, 9);
    state.players[0].hasKick = true;
    // Row 1 has no pillars, so nothing but this castle is in the lane.
    setTile(state, 6, 1, Tile.CASTLE);

    const balloon = armBalloon(state, 1, 3, 1, 2, 100000);
    for (let i = 0; i < 90; i++) {
      simulateTick(state, new Map([[0, input(Dir.RIGHT)]]));
      // The bug: the slide never tested anything, so the balloon left the map.
      expect(balloon.x).toBeGreaterThan(0);
      expect(balloon.x).toBeLessThan(state.width);
    }

    expect(balloon.slideDir).toBe(Dir.NONE);
    expect(balloon.x).toBe(5.5);
    expect(balloon.y).toBe(1.5);
    expect(state.balloons).toContain(balloon);
  });

  it('stops against the border boulder rather than leaving the arena', () => {
    const state = makeArena();
    placeAt(state, 0, 9, 9);
    placeAt(state, 1, 5, 5);

    const balloon = armBalloon(state, 0, 3, 1, 2, 100000);
    balloon.slideDir = Dir.RIGHT;
    for (let i = 0; i < 200; i++) updateSlides(state);

    // 13 tiles wide, so x = 12 is the border boulder and 11.5 is flush with it.
    expect(balloon.x).toBe(state.width - 2 + 0.5);
    expect(balloon.slideDir).toBe(Dir.NONE);
  });

  it('stops against another balloon in the lane', () => {
    const state = makeArena();
    placeAt(state, 0, 9, 9);
    placeAt(state, 1, 5, 5);

    const sliding = armBalloon(state, 0, 3, 1, 2, 100000);
    armBalloon(state, 0, 7, 1, 2, 100000);
    sliding.slideDir = Dir.RIGHT;
    for (let i = 0; i < 60; i++) updateSlides(state);

    expect(sliding.x).toBe(6.5);
    expect(sliding.slideDir).toBe(Dir.NONE);
  });
});

describe('prediction survives the wire', () => {
  /** The critter the server parked flush against `wallTx`, as the client reads it. */
  function blockedThenRounded(dir: typeof Dir.RIGHT | typeof Dir.DOWN, wallTx: number): number {
    const solid = (tx: number, ty: number): boolean =>
      dir === Dir.RIGHT ? tx === wallTx : ty === wallTx;
    const p = { x: wallTx - 2.5, y: wallTx - 2.5 };
    for (let i = 0; i < 40; i++) stepEntity(solid, p, dir, 0.2);
    return r3(dir === Dir.RIGHT ? p.x : p.y);
  }

  it('does not walk a rounded-off position through the wall it is flush against', () => {
    for (const dir of [Dir.RIGHT, Dir.DOWN] as const) {
      for (let wall = 4; wall <= 12; wall++) {
        const onWire = blockedThenRounded(dir, wall);
        // The bug: three-decimal rounding swallowed the guard band, so the
        // leading edge landed exactly on the wall and the scan skipped it.
        expect(Math.floor(onWire + R)).toBeLessThan(wall);

        const solid = (tx: number, ty: number): boolean =>
          dir === Dir.RIGHT ? tx === wall : ty === wall;
        const p = dir === Dir.RIGHT ? { x: onWire, y: 1.5 } : { x: 1.5, y: onWire };
        for (let i = 0; i < 20; i++) stepEntity(solid, p, dir, 0.2);
        const along = dir === Dir.RIGHT ? p.x : p.y;
        expect(along + R).toBeLessThanOrEqual(wall);
      }
    }
  });

  it('keeps a critter that is already flush exactly where it is', () => {
    const solid = (tx: number, _ty: number): boolean => tx === 5;
    const p = { x: r3(5 - R - CONFIG.COLLISION_EPSILON), y: 1.5 };
    const before = p.x;
    const result = stepEntity(solid, p, Dir.RIGHT, 0.2);

    expect(p.x).toBe(before);
    expect(result.blocked).toBe(true);
    expect(result.blockedX).toBe(5);
  });
});
