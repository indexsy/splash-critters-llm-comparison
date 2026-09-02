import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import { generateMap } from '../src/map.js';
import { createInitialState, simulateTick } from '../src/sim.js';
import { TILE_CASTLE, TILE_EMPTY, type PlayerInput } from '../src/types.js';

function idleInputs(ids: string[]): Record<string, PlayerInput> {
  const o: Record<string, PlayerInput> = {};
  for (const id of ids) o[id] = { seq: 0, tick: 0, dx: 0, dy: 0, balloon: false };
  return o;
}

describe('splash propagation', () => {
  it('stops at first sandcastle', () => {
    const st = createInitialState(
      { mode: 'duel', mapSeed: 1, theme: 'backyard', roundsToWin: 3, revengeDucks: false },
      [
        { id: 'p1', nickname: 'A', animal: 'frog', hat: 'none' },
        { id: 'p2', nickname: 'B', animal: 'duck', hat: 'none' },
      ],
    );
    // clear map, place single castle at (3,1) east of balloon at (1,1)
    for (let y = 0; y < st.height; y++) for (let x = 0; x < st.width; x++) if (st.tiles[y][x] === TILE_CASTLE) { st.tiles[y][x] = TILE_EMPTY; st.contents[y][x] = null; }
    st.tiles[1][3] = TILE_CASTLE;
    st.contents[1][3] = null;
    // teleport p1 next to balloon spot
    st.players[0].x = 1.5; st.players[0].y = 1.5;
    st.players[0].splashRange = 5;
    st.balloons.push({ id: 1, tx: 1, ty: 1, ownerId: 'p1', fuse: 1, range: 5, slideX: 0, slideY: 0, slideT: 0, passThrough: new Set() });
    st.nextBalloonId = 2;
    const evs = simulateTick(st, idleInputs(['p1', 'p2']));
    expect(evs.some((e) => e.t === 'balloon_burst')).toBe(true);
    // splash should include (2,1) and (3,1) but NOT (4,1)
    const tiles = new Set(st.splashes.map((s) => `${s.tx},${s.ty}`));
    expect(tiles.has('2,1')).toBe(true);
    expect(tiles.has('3,1')).toBe(true);
    expect(tiles.has('4,1')).toBe(false);
    expect(st.tiles[1][3]).toBe(TILE_EMPTY);
  });

  it('3-balloon chain bursts in one tick', () => {
    const st = createInitialState(
      { mode: 'duel', mapSeed: 2, theme: 'beach', roundsToWin: 3, revengeDucks: false },
      [
        { id: 'p1', nickname: 'A', animal: 'frog', hat: 'none' },
        { id: 'p2', nickname: 'B', animal: 'duck', hat: 'none' },
      ],
    );
    for (let y = 0; y < st.height; y++) for (let x = 0; x < st.width; x++) if (st.tiles[y][x] === TILE_CASTLE) { st.tiles[y][x] = TILE_EMPTY; st.contents[y][x] = null; }
    st.players[0].x = 5.5; st.players[0].y = 5.5;
    st.players[1].x = 10.5; st.players[1].y = 8.5;
    st.balloons.push(
      { id: 1, tx: 2, ty: 1, ownerId: 'p1', fuse: 1, range: 3, slideX: 0, slideY: 0, slideT: 0, passThrough: new Set() },
      { id: 2, tx: 4, ty: 1, ownerId: 'p1', fuse: 90, range: 3, slideX: 0, slideY: 0, slideT: 0, passThrough: new Set() },
      { id: 3, tx: 6, ty: 1, ownerId: 'p1', fuse: 90, range: 3, slideX: 0, slideY: 0, slideT: 0, passThrough: new Set() },
    );
    st.nextBalloonId = 4;
    const evs = simulateTick(st, idleInputs(['p1', 'p2']));
    expect(st.balloons.length).toBe(0);
    expect(evs.some((e) => e.t === 'chain_burst' && e.count === 3)).toBe(true);
  });

  it('identical seed -> identical map + hidden contents', () => {
    const a = generateMap('ffa', 12345);
    const b = generateMap('ffa', 12345);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.contents).toEqual(b.contents);
    const c = generateMap('ffa', 99999);
    expect(c.tiles).not.toEqual(a.tiles);
  });

  it('RNG determinism: powerup contents stable', () => {
    const a = generateMap('duel', 777);
    const b = generateMap('duel', 777);
    expect(JSON.stringify(a.contents)).toBe(JSON.stringify(b.contents));
  });

  it('fuse 90 ticks then bursts', () => {
    const st = createInitialState(
      { mode: 'duel', mapSeed: 3, theme: 'pool', roundsToWin: 3, revengeDucks: false },
      [
        { id: 'p1', nickname: 'A', animal: 'frog', hat: 'none' },
        { id: 'p2', nickname: 'B', animal: 'duck', hat: 'none' },
      ],
    );
    for (let y = 0; y < st.height; y++) for (let x = 0; x < st.width; x++) if (st.tiles[y][x] === TILE_CASTLE) { st.tiles[y][x] = TILE_EMPTY; st.contents[y][x] = null; }
    st.players[0].x = 1.5; st.players[0].y = 1.5;
    st.players[1].x = 11.5; st.players[1].y = 9.5;
    st.balloons.push({ id: 1, tx: 5, ty: 5, ownerId: 'p1', fuse: CONFIG.FUSE_TICKS, range: 2, slideX: 0, slideY: 0, slideT: 0, passThrough: new Set() });
    for (let i = 0; i < CONFIG.FUSE_TICKS - 1; i++) simulateTick(st, idleInputs(['p1', 'p2']));
    expect(st.balloons.length).toBe(1);
    simulateTick(st, idleInputs(['p1', 'p2']));
    expect(st.balloons.length).toBe(0);
  });
});
