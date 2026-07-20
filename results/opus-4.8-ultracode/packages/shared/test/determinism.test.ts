import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/map';
import { simulateTick } from '../src/sim';
import { createRoundState, type RoundPlayerInit } from '../src/state';
import { idx, Tile, type PlayerInput } from '../src/types';
import { addBalloon, addPlayer, blankState } from './helpers';

const players: RoundPlayerInit[] = [
  { id: 'a', slot: 0, name: 'A', animal: 'frog', hat: 'none', isBot: false, roundWins: 0, connected: true },
  { id: 'b', slot: 1, name: 'B', animal: 'duck', hat: 'none', isBot: false, roundWins: 0, connected: true },
];

describe('map determinism', () => {
  it('identical seed + mode => identical grid and identical hidden power-ups', () => {
    const m1 = generateMap(123456, 'ffa');
    const m2 = generateMap(123456, 'ffa');
    expect(m1.grid).toEqual(m2.grid);
    expect(m1.castleContents).toEqual(m2.castleContents);
  });

  it('different seeds produce different maps', () => {
    const m1 = generateMap(1, 'duel');
    const m2 = generateMap(2, 'duel');
    expect(m1.grid).not.toEqual(m2.grid);
  });

  it('spawn corners and their corridors are kept clear', () => {
    const m = generateMap(999, 'ffa');
    for (const s of m.spawns) {
      expect(m.grid[idx(s.x, s.y, m.width)]).toBe(Tile.Empty);
    }
  });
});

describe('sim determinism', () => {
  it('two states from the same seed run identically under identical inputs', () => {
    const s1 = createRoundState({ mode: 'duel', mapSeed: 42, roundNo: 1, players, revengeEnabled: false });
    const s2 = createRoundState({ mode: 'duel', mapSeed: 42, roundNo: 1, players, revengeEnabled: false });

    const script: Array<Map<string, PlayerInput>> = [];
    const dirs = ['right', 'right', 'down', null, 'left', 'up'] as const;
    for (let t = 0; t < 120; t++) {
      const m = new Map<string, PlayerInput>();
      m.set('a', { seq: t, tick: t, dir: dirs[t % dirs.length], balloon: t % 20 === 0 });
      m.set('b', { seq: t, tick: t, dir: dirs[(t + 2) % dirs.length], balloon: t % 25 === 0 });
      script.push(m);
    }

    for (let t = 0; t < script.length; t++) {
      simulateTick(s1, script[t]);
      simulateTick(s2, script[t]);
      expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
    }
  });
});

describe('balloon kick', () => {
  it('a player with boots kicks a balloon which slides until blocked', () => {
    const s = blankState(11, 11);
    const p = addPlayer(s, 2, 5, { id: 'a', slot: 0, hasKick: true });
    addPlayer(s, 9, 1, { id: 'b', slot: 1 });
    // balloon directly to the player's right, long fuse
    const bal = addBalloon(s, 3, 5, { owner: 'b', range: 1, fuseTick: 9999 });
    s.grid[idx(8, 5, s.width)] = Tile.Boulder; // a wall to stop the slide

    let kicked = false;
    for (let t = 0; t < 60; t++) {
      const ev = simulateTick(s, new Map([['a', { seq: t, tick: t, dir: 'right', balloon: false }]]));
      if (ev.some((e) => e.t === 'balloon_kicked')) kicked = true;
      void p;
    }
    expect(kicked).toBe(true);
    // balloon should have slid right and be resting against the boulder at x=7
    expect(bal.sliding).toBe(null);
    expect(Math.round(bal.x)).toBe(7);
    expect(Math.round(bal.y)).toBe(5);
  });
});
