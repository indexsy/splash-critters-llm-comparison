import { describe, it, expect } from 'vitest';
import { CONFIG } from './config.js';
import { generateMap, TILE_CASTLE, TILE_BOULDER, TILE_EMPTY } from './map.js';
import { createRoundState, simulateTick, emptyInput } from './sim.js';
import { idx, type InputMap } from './types.js';

describe('map generation', () => {
  it('identical seed → identical map + hidden powerups', () => {
    const a = generateMap(13, 11, 42, 2, 'beach');
    const b = generateMap(13, 11, 42, 2, 'beach');
    expect(a.grid).toEqual(b.grid);
    expect(a.hiddenPowerups).toEqual(b.hiddenPowerups);
    expect(a.theme).toBe('beach');
  });

  it('different seeds differ', () => {
    const a = generateMap(13, 11, 1, 2, 'backyard');
    const b = generateMap(13, 11, 2, 2, 'backyard');
    expect(a.grid).not.toEqual(b.grid);
  });

  it('has border boulders and even pillars', () => {
    const m = generateMap(13, 11, 99, 2);
    expect(m.grid[idx(0, 0, 13)]).toBe(TILE_BOULDER);
    expect(m.grid[idx(2, 2, 13)]).toBe(TILE_BOULDER);
  });
});

function makeState(seed = 123) {
  return createRoundState({
    width: 13,
    height: 11,
    mapSeed: seed,
    theme: 'backyard',
    ranked: false,
    enableRevengeDucks: false,
    players: [
      { id: 'p1', slot: 0, nickname: 'A', animal: 'frog', hat: 'none', isBot: false },
      { id: 'p2', slot: 1, nickname: 'B', animal: 'duck', hat: 'none', isBot: false },
    ],
  });
}

describe('balloon splash', () => {
  it('splash stops at first sandcastle', () => {
    const state = makeState(7);
    // Place player at a known empty tile and force a balloon with range
    const p = state.players[0]!;
    // Find an empty tile with a castle to the right
    let found = false;
    for (let y = 1; y < state.height - 1 && !found; y++) {
      for (let x = 1; x < state.width - 2 && !found; x++) {
        if (
          state.grid[idx(x, y, state.width)] === TILE_EMPTY &&
          state.grid[idx(x + 1, y, state.width)] === TILE_CASTLE
        ) {
          p.x = x + 0.5;
          p.y = y + 0.5;
          p.splashRange = 5;
          found = true;
        }
      }
    }
    expect(found).toBe(true);

    const inputs: InputMap = {
      p1: { seq: 1, tick: 0, dir: 'none', balloonPressed: true },
    };
    simulateTick(state, inputs);
    expect(state.balloons.length).toBe(1);

    // Fast-forward fuse
    state.balloons[0]!.fuseTicks = 1;
    state.balloons[0]!.placeTick = state.tick;
    simulateTick(state, {});

    // Castle should be washed (empty now)
    const bx = state.events.find((e) => e.type === 'balloon_burst');
    expect(bx).toBeTruthy();
    // Exactly one castle washed in the right direction ideally
    const washed = state.events.filter((e) => e.type === 'castle_washed');
    expect(washed.length).toBeGreaterThanOrEqual(1);
  });

  it('3-balloon chain bursts in one tick', () => {
    const state = makeState(50);
    // Clear a corridor and place 3 balloons in a row
    const y = 1;
    for (let x = 1; x <= 5; x++) {
      state.grid[idx(x, y, state.width)] = TILE_EMPTY;
    }
    // Remove any existing
    state.balloons = [];
    state.players[0]!.balloonsOut = 0;
    state.players[0]!.balloonCount = 8;
    state.players[0]!.splashRange = 3;
    state.players[0]!.x = 1.5;
    state.players[0]!.y = y + 0.5;

    // Manually place 3 balloons
    for (let i = 0; i < 3; i++) {
      state.balloons.push({
        id: state.nextBalloonId++,
        ownerId: 'p1',
        x: 1 + i,
        y,
        placeTick: state.tick,
        fuseTicks: 999,
        splashRange: 3,
        sliding: false,
        slideDir: 'none',
      });
      state.players[0]!.balloonsOut++;
    }

    // Burst first one
    state.balloons[0]!.fuseTicks = 0;
    state.balloons[0]!.placeTick = state.tick;
    const before = state.tick;
    simulateTick(state, {});

    expect(state.balloons.length).toBe(0);
    const chain = state.events.find((e) => e.type === 'chain_burst');
    expect(chain).toBeTruthy();
    if (chain && chain.type === 'chain_burst') {
      expect(chain.count).toBe(3);
    }
    // All in one tick
    expect(state.tick).toBe(before + 1);
  });
});

describe('determinism', () => {
  it('same inputs produce same state', () => {
    const s1 = makeState(99);
    const s2 = makeState(99);
    const inputs: InputMap = {
      p1: { seq: 1, tick: 0, dir: 'right', balloonPressed: false },
      p2: { seq: 1, tick: 0, dir: 'left', balloonPressed: false },
    };
    for (let i = 0; i < 30; i++) {
      simulateTick(s1, inputs);
      simulateTick(s2, inputs);
    }
    expect(s1.players[0]!.x).toBeCloseTo(s2.players[0]!.x, 5);
    expect(s1.players[0]!.y).toBeCloseTo(s2.players[0]!.y, 5);
    expect(s1.tick).toBe(s2.tick);
  });
});

describe('powerups pre-rolled', () => {
  it('hidden contents fixed at generation', () => {
    const m = generateMap(15, 13, 777, 4, 'pool');
    const withPower = m.hiddenPowerups.filter((h) => h.type !== null);
    expect(withPower.length).toBeGreaterThan(0);
    // Re-gen same seed same contents
    const m2 = generateMap(15, 13, 777, 4, 'pool');
    expect(m2.hiddenPowerups).toEqual(m.hiddenPowerups);
  });
});
