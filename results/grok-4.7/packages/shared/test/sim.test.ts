import { describe, expect, it } from 'vitest';
import { TILE_CASTLE, TILE_EMPTY } from '../src/config.js';
import { applyDuel, applyFfa, duelDelta, kFactor } from '../src/elo.js';
import { generateMap } from '../src/map.js';
import {
  addTestBalloon,
  addTestPlayer,
  makeBlankArena,
  simulateTick,
} from '../src/sim.js';

describe('splashes', () => {
  it('bursts a 3-balloon chain in one tick', () => {
    const state = makeBlankArena(15, 11);
    addTestPlayer(state, 'p1', 1, 2);
    addTestBalloon(state, 'p1', 2, 2, 1, 3);
    addTestBalloon(state, 'p1', 5, 2, 80, 3);
    addTestBalloon(state, 'p1', 8, 2, 80, 3);
    simulateTick(state, []);
    expect(state.balloons.length).toBe(0);
    const chain = state.events.find((e) => e.t === 'chain_burst');
    expect(chain).toMatchObject({ t: 'chain_burst', count: 3 });
    expect(state.splashes.some((s) => s.x === 5 && s.y === 2)).toBe(true);
    expect(state.splashes.some((s) => s.x === 8 && s.y === 2)).toBe(true);
  });

  it('stops at the first sandcastle', () => {
    const state = makeBlankArena(15, 11);
    addTestPlayer(state, 'p1', 1, 2);
    state.tiles[2 * 15 + 6] = TILE_CASTLE;
    state.powerups.push({ x: 6, y: 2, kind: 'splash', hidden: true, revealedTick: -1 });
    addTestBalloon(state, 'p1', 2, 2, 1, 8);
    simulateTick(state, []);
    expect(state.tiles[2 * 15 + 6]).toBe(TILE_EMPTY);
    expect(state.splashes.some((s) => s.x === 6 && s.y === 2)).toBe(true);
    expect(state.splashes.some((s) => s.x === 7 && s.y === 2)).toBe(false);
    expect(state.events.some((e) => e.t === 'castle_washed' && e.x === 6)).toBe(true);
    expect(state.events.some((e) => e.t === 'powerup_revealed' && e.kind === 'splash')).toBe(true);
    expect(state.powerups.some((p) => p.x === 6 && !p.hidden)).toBe(true);
  });

  it('does not splash through a boulder', () => {
    const state = makeBlankArena(15, 11);
    state.tiles[2 * 15 + 4] = 1;
    addTestBalloon(state, 'p1', 2, 2, 1, 6);
    simulateTick(state, []);
    expect(state.splashes.some((s) => s.x === 3 && s.y === 2)).toBe(true);
    expect(state.splashes.some((s) => s.x === 4 && s.y === 2)).toBe(false);
    expect(state.splashes.some((s) => s.x === 5 && s.y === 2)).toBe(false);
  });
});

describe('map generation', () => {
  it('is identical for the same seed, including hidden power-ups', () => {
    const a = generateMap({ width: 13, height: 11, seed: 42, players: 2 });
    const b = generateMap({ width: 13, height: 11, seed: 42, players: 2 });
    expect(a.tiles).toEqual(b.tiles);
    expect(a.powerups).toEqual(b.powerups);
    expect(a.spawns).toEqual(b.spawns);
    expect(a.powerups.length).toBeGreaterThan(0);
    const other = generateMap({ width: 13, height: 11, seed: 99, players: 2 });
    expect(other.tiles).not.toEqual(a.tiles);
  });
});

describe('elo', () => {
  it('uses K=64 for the first 10 games and K=32 after', () => {
    expect(kFactor(0)).toBe(64);
    expect(kFactor(9)).toBe(64);
    expect(kFactor(10)).toBe(32);
  });

  it('matches duel fixtures', () => {
    expect(duelDelta(1000, 1000, 1, 10)).toBe(16);
    expect(duelDelta(1000, 1000, 0, 10)).toBe(-16);
    expect(duelDelta(1000, 1000, 1, 3)).toBe(32);
    const rated = applyDuel(
      { id: 'a', rating: 1200, games: 20 },
      { id: 'b', rating: 1000, games: 20 },
      'a',
    );
    expect(rated.find((d) => d.id === 'a')!.delta).toBe(8);
    expect(rated.find((d) => d.id === 'b')!.delta).toBe(-8);
  });

  it('matches 4p pairwise fixtures', () => {
    const deltas = applyFfa([
      { id: 'a', rating: 1000, games: 10, placement: 1 },
      { id: 'b', rating: 1000, games: 10, placement: 2 },
      { id: 'c', rating: 1000, games: 10, placement: 3 },
      { id: 'd', rating: 1000, games: 10, placement: 4 },
    ]);
    const by = Object.fromEntries(deltas.map((d) => [d.id, d.delta]));
    expect(by.a).toBe(16);
    expect(by.b).toBe(5);
    expect(by.c).toBe(-5);
    expect(by.d).toBe(-16);
  });

  it('treats shared FFA placement as a tie', () => {
    const deltas = applyFfa([
      { id: 'a', rating: 1000, games: 10, placement: 1 },
      { id: 'b', rating: 1000, games: 10, placement: 1 },
    ]);
    expect(deltas[0]!.delta).toBe(0);
    expect(deltas[1]!.delta).toBe(0);
  });
});
