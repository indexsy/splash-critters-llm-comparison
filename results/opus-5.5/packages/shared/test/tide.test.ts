import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { idx } from '../src/grid';
import { simulateTick } from '../src/sim';
import { isFlooded, maxTideLevel } from '../src/tide';
import { Dir, PowerUp, Tile } from '../src/types';
import { inp, ofType, placePlayer, putBalloon, runTicks, stateFromAscii } from './fixtures';

// 9x7: ring 1 is the outer walkable ring, players start on ring 3 (the innermost).
const POOL = ['#########', '#B.b....#', '#.#.#.#.#', '#..0.1..#', '#.#.#.#.#', '#.......#', '#########'];

describe('tide geometry', () => {
  it('floods rings 1..level, never the border ring', () => {
    const s = stateFromAscii(POOL);
    expect(isFlooded(s, 1, 1)).toBe(false);
    s.tideLevel = 1;
    expect(isFlooded(s, 0, 0)).toBe(false);
    expect(isFlooded(s, 1, 1)).toBe(true);
    expect(isFlooded(s, 7, 5)).toBe(true);
    expect(isFlooded(s, 2, 3)).toBe(false);
    s.tideLevel = 2;
    expect(isFlooded(s, 2, 3)).toBe(true);
    expect(isFlooded(s, 3, 3)).toBe(false);
  });

  it('maxTideLevel covers the innermost ring', () => {
    expect(maxTideLevel(9, 7)).toBe(3);
    expect(maxTideLevel(13, 11)).toBe(5);
    expect(maxTideLevel(15, 13)).toBe(6);
  });
});

describe('advancing tide', () => {
  it('starts at tideStartTick: dissolves castles (hidden lost), removes items, fizzles balloons', () => {
    const s = stateFromAscii(POOL, { rules: { tideStartTick: 5 } });
    const fizzler = putBalloon(s, 6, 1, 1, { fuse: 200 });
    expect(runTicks(s, 4)).toEqual([]);
    const events = simulateTick(s, []);
    expect(s.tick).toBe(5);
    expect(ofType(events, 'tide_advance')).toEqual([{ type: 'tide_advance', level: 1 }]);
    expect(ofType(events, 'castle_washed')).toEqual([{ type: 'castle_washed', x: 1, y: 1, by: -1 }]);
    expect(s.tiles[idx(s.w, 1, 1)]).toBe(Tile.Floor);
    expect(s.hidden[idx(s.w, 1, 1)]).toBe(PowerUp.None);
    expect(s.items[idx(s.w, 1, 1)]).toBe(PowerUp.None);
    expect(ofType(events, 'powerup_destroyed')).toEqual([{ type: 'powerup_destroyed', x: 3, y: 1, kind: PowerUp.Balloon }]);
    expect(ofType(events, 'balloon_fizzled')).toEqual([{ type: 'balloon_fizzled', id: fizzler.id, x: 6, y: 1 }]);
    expect(s.balloons).toEqual([]);
    expect(s.nextTideTick).toBe(5 + CONFIG.TIDE_INTERVAL_TICKS);
    expect(s.players.every((p) => p.alive)).toBe(true);
  });

  it('rises one ring per interval and stops once fully flooded', () => {
    const s = stateFromAscii(POOL, { rules: { tideStartTick: 5, sandbox: true } });
    const levels: [number, number][] = [];
    for (let t = 0; t < 300; t++) {
      for (const e of ofType(simulateTick(s, []), 'tide_advance')) levels.push([s.tick, e.level]);
    }
    const step = CONFIG.TIDE_INTERVAL_TICKS;
    expect(levels).toEqual([
      [5, 1],
      [5 + step, 2],
      [5 + 2 * step, 3],
    ]);
    expect(s.tideLevel).toBe(maxTideLevel(s.w, s.h));
  });

  it('soaks players standing on flooded tiles (by -1, cause tide)', () => {
    const s = stateFromAscii(POOL, { rules: { tideStartTick: 3 } });
    placePlayer(s, 0, 1, 5);
    const events = runTicks(s, 3);
    expect(ofType(events, 'player_soaked')).toEqual([{ type: 'player_soaked', slot: 0, by: -1, cause: 'tide', x: 1, y: 5 }]);
    expect(s.players[0].soakedBy).toBe(-1);
    expect(s.players[1].stats.soaks).toBe(0);
    expect(ofType(events, 'round_over')).toEqual([{ type: 'round_over', winner: 1, draw: false }]);
  });

  it('prefers splash credit over tide when both cover the tile', () => {
    const s = stateFromAscii(POOL, { rules: { tideStartTick: 1 } });
    placePlayer(s, 0, 3, 5);
    putBalloon(s, 4, 5, 1, { fuse: 1 });
    const events = simulateTick(s, []);
    expect(ofType(events, 'player_soaked')).toEqual([{ type: 'player_soaked', slot: 0, by: 1, cause: 'splash', x: 3, y: 5 }]);
  });

  it('is disabled when rules.tide is false', () => {
    const s = stateFromAscii(POOL, { rules: { tide: false, tideStartTick: 1 } });
    expect(ofType(runTicks(s, 100), 'tide_advance')).toEqual([]);
    expect(s.tideLevel).toBe(0);
  });

  it('fizzles a balloon kicked into flood water', () => {
    const s = stateFromAscii(POOL, { rules: { tideStartTick: 1_000_000 } });
    s.tideLevel = 1;
    s.players[0].canKick = true;
    const b = putBalloon(s, 2, 3, 1);
    const events = runTicks(s, 1, [inp(Dir.Left)]);
    expect(ofType(events, 'balloon_kicked')).toHaveLength(1);
    const later = runTicks(s, 3);
    expect(ofType(later, 'balloon_fizzled')).toEqual([{ type: 'balloon_fizzled', id: b.id, x: 1, y: 3 }]);
    expect(s.balloons).toEqual([]);
  });
});
