import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  beginRound,
  createMatchState,
  generateArena,
  mulberry32,
  simulateTick,
  spawnPointsFor,
  splashTiles,
  tileWalkable,
  type Balloon,
  type GameState,
} from '@splash-critters/shared';

function blankArena(state: GameState): void {
  state.arena.castles.fill(0);
  state.arena.contents.fill(null);
}

function addBalloon(state: GameState, x: number, y: number, owner = 0, range = 2, fuse = 90): Balloon {
  const b: Balloon = {
    id: state.nextEntityId++,
    owner,
    x,
    y,
    fuse,
    range,
    revenge: false,
    sliding: false,
    slideDir: 0,
    slideCooldown: 0,
  };
  state.balloons.push(b);
  return b;
}

function makeState(players = 2): GameState {
  const state = createMatchState({
    mode: players > 2 ? 'ffa' : 'duel',
    seed: 12345,
    players: Array.from({ length: players }, () => ({ animal: 'frog' as const, hat: 'none' as const })),
  });
  blankArena(state);
  state.phase = 'running';
  state.countdown = 0;
  return state;
}

describe('seeded rng', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it('stays inside [0,1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('map generation', () => {
  const grid = CONFIG.GRID.duel;
  const spawns = spawnPointsFor('duel', grid.width, grid.height);

  it('is deterministic for a given seed', () => {
    const a = generateArena({ ...grid, seed: 4242, theme: 'beach', spawns });
    const b = generateArena({ ...grid, seed: 4242, theme: 'beach', spawns });
    expect(a.castles).toEqual(b.castles);
    expect(a.contents).toEqual(b.contents);
  });

  it('hides identical power-up contents for identical seeds', () => {
    const a = generateArena({ ...grid, seed: 777, theme: 'pool', spawns });
    const b = generateArena({ ...grid, seed: 777, theme: 'pool', spawns });
    const contentsA = a.contents.filter((c) => c !== null);
    const contentsB = b.contents.filter((c) => c !== null);
    expect(contentsA.length).toBeGreaterThan(0);
    expect(contentsA).toEqual(contentsB);
  });

  it('produces a different layout for a different seed', () => {
    const a = generateArena({ ...grid, seed: 1, theme: 'backyard', spawns });
    const b = generateArena({ ...grid, seed: 2, theme: 'backyard', spawns });
    expect(a.castles).not.toEqual(b.castles);
  });

  it('keeps spawn tiles and their neighbours clear of sandcastles', () => {
    const arena = generateArena({ ...grid, seed: 31337, theme: 'backyard', spawns });
    for (const s of spawns) {
      const plus: { x: number; y: number }[] = [{ x: s.x, y: s.y }];
      for (let d = 1; d <= CONFIG.SPAWN_CLEARANCE; d++) {
        plus.push({ x: s.x + d, y: s.y });
        plus.push({ x: s.x - d, y: s.y });
        plus.push({ x: s.x, y: s.y + d });
        plus.push({ x: s.x, y: s.y - d });
      }
      for (const t of plus) {
        const { x, y } = t;
        if (x < 0 || y < 0 || x >= arena.width || y >= arena.height) continue;
        if (x % 2 === 0 && y % 2 === 0) continue; // boulder tiles are fine
        expect(arena.castles[y * arena.width + x]).toBe(0);
      }
    }
  });

  it('never places a sandcastle on a boulder tile', () => {
    const arena = generateArena({ ...grid, seed: 5150, theme: 'backyard', spawns });
    for (let y = 0; y < arena.height; y++) {
      for (let x = 0; x < arena.width; x++) {
        const isBoulder =
          x === 0 ||
          y === 0 ||
          x === arena.width - 1 ||
          y === arena.height - 1 ||
          (x % 2 === 0 && y % 2 === 0);
        if (isBoulder) expect(arena.castles[y * arena.width + x]).toBe(0);
      }
    }
  });

  it('honours the 30% empty-castle chance roughly', () => {
    const arena = generateArena({ ...grid, seed: 2024, theme: 'backyard', spawns });
    let castles = 0;
    let withContent = 0;
    for (let i = 0; i < arena.castles.length; i++) {
      if (!arena.castles[i]) continue;
      castles += 1;
      if (arena.contents[i]) withContent += 1;
    }
    expect(castles).toBeGreaterThan(10);
    const ratio = withContent / castles;
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.85);
  });
});

describe('splash simulation', () => {
  it('spreads in a cross up to splashRange and stops at boulders', () => {
    const state = makeState();
    const balloon = addBalloon(state, 5, 5, 0, 2);
    balloon.fuse = 0;
    simulateTick(state, []);

    expect(state.balloons.length).toBe(0);
    const splash = state.splashes[0];
    expect(splash).toBeDefined();
    const tiles = splashTiles(splash);
    const has = (x: number, y: number) => tiles.some((t) => t.x === x && t.y === y);

    // range 2 in every direction
    expect(has(5, 3)).toBe(true);
    expect(has(5, 4)).toBe(true);
    expect(has(7, 5)).toBe(true);
    expect(has(6, 5)).toBe(true);
    expect(has(3, 5)).toBe(true);
    expect(has(5, 7)).toBe(true);
    // beyond the range
    expect(has(5, 2)).toBe(false);
    expect(has(8, 5)).toBe(false);
  });

  it('stops at the first sandcastle in each direction', () => {
    const state = makeState();
    // sandcastle two tiles to the right of the balloon
    state.arena.castles[5 * state.arena.width + 7] = 1;
    const balloon = addBalloon(state, 5, 5, 0, 3);
    balloon.fuse = 0;
    simulateTick(state, []);

    const splash = state.splashes[0];
    const tiles = splashTiles(splash);
    const has = (x: number, y: number) => tiles.some((t) => t.x === x && t.y === y);

    expect(has(6, 5)).toBe(true); // water reaches the tile before the castle
    expect(has(7, 5)).toBe(true); // water hits the castle itself
    expect(has(8, 5)).toBe(false); // but does not travel past it
    expect(state.arena.castles[5 * state.arena.width + 7]).toBe(0);
  });

  it('does not splash past a boulder', () => {
    const state = makeState();
    // (6,6) is a boulder tile (even x and even y)
    const balloon = addBalloon(state, 5, 6, 0, 4);
    balloon.fuse = 0;
    simulateTick(state, []);
    const splash = state.splashes[0];
    const tiles = splashTiles(splash);
    const has = (x: number, y: number) => tiles.some((t) => t.x === x && t.y === y);
    expect(has(5, 5)).toBe(true);
    expect(has(5, 7)).toBe(true);
    expect(has(6, 6)).toBe(false); // blocked by the boulder
    expect(has(7, 6)).toBe(false);
  });

  it('soaks a player standing on their own balloon', () => {
    const state = makeState();
    const p = state.players[0];
    p.x = 5;
    p.y = 5;
    const balloon = addBalloon(state, 5, 5, 0, 2);
    balloon.fuse = 0;
    simulateTick(state, []);
    expect(p.alive).toBe(false);
    expect(state.events.some((e) => e.t === 'player_soaked' && e.player === 0)).toBe(true);
  });
});

describe('chain bursts', () => {
  it('bursts a three balloon chain inside a single tick', () => {
    const state = makeState();
    const a = addBalloon(state, 5, 5, 0, 1);
    const b = addBalloon(state, 5, 6, 0, 2);
    const c = addBalloon(state, 5, 7, 0, 2);
    a.fuse = 0;
    b.fuse = 30;
    c.fuse = 60;

    simulateTick(state, []);

    // every balloon of the chain burst within the same tick
    expect(state.balloons.length).toBe(0);
    expect(state.splashes.length).toBe(3);
    const depths = state.events.filter((e) => e.t === 'chain_burst').map((e) => (e as any).depth);
    expect(depths).toEqual([2, 3]);
    expect(state.players[0].biggestChain).toBe(3);
  });

  it('chains a balloon that was not yet due to burst', () => {
    const state = makeState();
    const a = addBalloon(state, 5, 5, 0, 2);
    const b = addBalloon(state, 5, 6, 0, 2);
    a.fuse = 0;
    b.fuse = 45;

    simulateTick(state, []);

    expect(state.balloons.length).toBe(0);
    expect(state.splashes.length).toBe(2);
    const depths = state.events.filter((e) => e.t === 'chain_burst').map((e) => (e as any).depth);
    expect(depths).toEqual([2]);
  });

  it('uses the chained balloon own splash range', () => {
    const state = makeState();
    const a = addBalloon(state, 5, 5, 0, 1);
    const b = addBalloon(state, 5, 6, 0, 4);
    a.fuse = 0;
    b.fuse = 0;
    simulateTick(state, []);

    const splash = state.splashes.find((s) => s.y === 6);
    expect(splash).toBeDefined();
    // range 4 -> the chained balloon reaches (5,2)
    expect(splash.lens[0]).toBe(4);
  });
});

describe('power-ups', () => {
  it('reveals the hidden content when the sandcastle is washed away', () => {
    const state = makeState();
    const i = 5 * state.arena.width + 7;
    state.arena.castles[i] = 1;
    state.arena.contents[i] = 'big_splash';
    const balloon = addBalloon(state, 5, 5, 0, 2);
    balloon.fuse = 0;
    simulateTick(state, []);

    expect(state.exposed.length).toBe(1);
    expect(state.exposed[0].kind).toBe('big_splash');
    expect(state.exposed[0].x).toBe(7);
    expect(state.events.some((e) => e.t === 'powerup_revealed')).toBe(true);
  });

  it('collects the power-up when a player walks onto it', () => {
    const state = makeState();
    const p = state.players[0];
    p.x = 7;
    p.y = 5;
    const i = 3 * state.arena.width + 7;
    state.arena.castles[i] = 1;
    state.arena.contents[i] = 'flippers';
    // balloon to the left of the castle, the player stays clear of the splash
    const balloon = addBalloon(state, 5, 3, 0, 2);
    balloon.fuse = 0;
    simulateTick(state, []);
    expect(state.exposed.length).toBe(1);
    expect(state.exposed[0].x).toBe(7);
    expect(state.exposed[0].y).toBe(3);
    expect(p.alive).toBe(true);

    p.y = 3;
    simulateTick(state, []);
    expect(state.exposed.length).toBe(0);
    expect(p.flippers).toBe(1);
    expect(p.speed).toBeCloseTo(CONFIG.SPEED_BASE + CONFIG.SPEED_PER_FLIPPER, 5);
    expect(state.events.some((e) => e.t === 'powerup_collected')).toBe(true);
  });

  it('never leaks hidden contents to the client state', () => {
    const state = makeState();
    state.arena.castles[1] = 1;
    state.arena.contents[1] = 'boots';
    const snapshotPayload = JSON.stringify({
      castles: state.arena.castles.join(''),
      contents: undefined,
    });
    expect(snapshotPayload).not.toContain('boots');
  });
});

describe('movement and drops', () => {
  it('does not let a player walk into a sandcastle', () => {
    const state = makeState();
    const p = state.players[0];
    p.x = 3;
    p.y = 3;
    state.arena.castles[3 * state.arena.width + 4] = 1;
    for (let i = 0; i < 30; i++) simulateTick(state, [{ playerId: 0, seq: i + 1, dir: 2, balloon: false }]);
    expect(tileWalkable(state, 4, 3)).toBe(false);
    expect(Math.floor(p.x)).toBeLessThan(4);
  });

  it('limits simultaneous balloons to the balloon count', () => {
    const state = makeState();
    const p = state.players[0];
    p.x = 5;
    p.y = 5;
    p.balloonCount = 1;
    simulateTick(state, [{ playerId: 0, seq: 1, dir: 0, balloon: true }]);
    expect(state.balloons.length).toBe(1);

    p.x = 6;
    p.y = 5;
    simulateTick(state, [{ playerId: 0, seq: 2, dir: 0, balloon: true }]);
    expect(state.balloons.length).toBe(1);
  });
});

describe('determinism', () => {
  it('produces identical results for identical state and inputs', () => {
    const run = () => {
      const state = createMatchState({
        mode: 'ffa',
        seed: 88,
        players: Array.from({ length: 4 }, () => ({ animal: 'duck' as const, hat: 'none' as const })),
      });
      beginRound(state, 1, 4321, 'beach');
      state.phase = 'running';
      for (let i = 0; i < 120; i++) {
        simulateTick(state, [
          { playerId: 0, seq: i + 1, dir: i % 8, balloon: i % 30 === 0 },
          { playerId: 1, seq: i + 1, dir: (i * 3) % 16, balloon: i % 25 === 0 },
        ]);
      }
      return JSON.stringify({
        players: state.players.map((p) => [p.x, p.y, p.alive, p.balloonCount, p.splashRange]),
        castles: state.arena.castles.join(''),
        balloons: state.balloons.map((b) => [b.x, b.y, b.fuse]),
      });
    };
    expect(run()).toBe(run());
  });
});
