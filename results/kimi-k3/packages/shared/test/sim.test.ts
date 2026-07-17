import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import { generateMap } from '../src/map.js';
import { mulberry32 } from '../src/rng.js';
import {
  BalloonState,
  DIR_NONE,
  GameState,
  TILE_BOULDER,
  TILE_CASTLE,
  TILE_FLOOR,
  tileIndex,
} from '../src/types.js';
import { createGame, simulateTick } from '../src/sim.js';

function makeState(playerCount = 2): GameState {
  const s = createGame({
    mode: 'duel',
    mapSeed: 1234,
    playerCount,
    roundsToWin: 3,
    enableRevengeDucks: false,
  });
  s.phase = 'playing';
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const idx = tileIndex(s.w, x, y);
      if (s.tiles[idx] !== TILE_BOULDER) s.tiles[idx] = TILE_FLOOR;
    }
  }
  s.castleContents.clear();
  return s;
}

function addBalloon(state: GameState, ownerSlot: number, tx: number, ty: number, burstIn: number): BalloonState {
  const owner = state.players[ownerSlot]!;
  const b: BalloonState = {
    id: state.nextBalloonId++,
    ownerSlot,
    tx,
    ty,
    fx: tx + 0.5,
    fy: ty + 0.5,
    slideDir: DIR_NONE,
    placedTick: state.tick,
    burstTick: state.tick + burstIn,
    range: owner.splashRange,
    flying: false,
    flyDir: DIR_NONE,
    flyTilesLeft: 0,
  };
  state.balloons.push(b);
  owner.activeBalloons++;
  return b;
}

const noInputs = () => new Map();

describe('sim: chains', () => {
  it('bursts a 3-balloon chain in a single tick', () => {
    const s = makeState();
    const p0 = s.players[0]!;
    p0.splashRange = 4;
    p0.x = 1.5;
    p0.y = 9.5;
    s.players[1]!.x = 11.5;
    s.players[1]!.y = 9.5;
    addBalloon(s, 0, 3, 1, 0);
    addBalloon(s, 0, 4, 1, 500);
    addBalloon(s, 0, 5, 1, 900);

    let bursts = 0;
    let chainEvents = 0;
    let ticksToAllBurst = -1;
    for (let i = 0; i < 3; i++) {
      simulateTick(s, noInputs());
      for (const e of s.events) {
        if (e.type === 'balloon_burst') bursts++;
        if (e.type === 'chain_burst') chainEvents++;
      }
      if (s.balloons.length === 0 && ticksToAllBurst < 0) ticksToAllBurst = i;
    }
    expect(bursts).toBe(3);
    expect(chainEvents).toBe(2);
    expect(ticksToAllBurst).toBe(0);
    expect(s.splashes.length).toBeGreaterThan(0);
  });
});

describe('sim: splash blocking', () => {
  it('stops at the first sandcastle per direction', () => {
    const s = makeState();
    const p0 = s.players[0]!;
    p0.splashRange = 6;
    p0.x = 1.5;
    p0.y = 9.5;
    s.players[1]!.x = 11.5;
    s.players[1]!.y = 9.5;
    s.tiles[tileIndex(s.w, 4, 1)] = TILE_CASTLE;
    s.tiles[tileIndex(s.w, 6, 1)] = TILE_CASTLE;
    addBalloon(s, 0, 2, 1, 0);
    simulateTick(s, noInputs());
    const splash = s.splashes[0]!;
    expect(s.tiles[tileIndex(s.w, 4, 1)]).toBe(TILE_FLOOR);
    expect(s.tiles[tileIndex(s.w, 6, 1)]).toBe(TILE_CASTLE);
    expect(splash.tiles).toContain(tileIndex(s.w, 3, 1));
    expect(splash.tiles).toContain(tileIndex(s.w, 4, 1));
    expect(splash.tiles).not.toContain(tileIndex(s.w, 5, 1));
  });

  it('is blocked by boulders', () => {
    const s = makeState();
    const p0 = s.players[0]!;
    p0.splashRange = 6;
    p0.x = 1.5;
    p0.y = 9.5;
    s.players[1]!.x = 11.5;
    s.players[1]!.y = 9.5;
    addBalloon(s, 0, 1, 1, 0);
    simulateTick(s, noInputs());
    const splash = s.splashes[0]!;
    expect(splash.tiles).not.toContain(tileIndex(s.w, 0, 1));
    expect(splash.tiles).toContain(tileIndex(s.w, 2, 1));
    expect(splash.tiles).toContain(tileIndex(s.w, 3, 1));
  });
});

describe('sim: soaks and round flow', () => {
  it('soaks a player standing in a splash and ends the round', () => {
    const s = makeState();
    const p0 = s.players[0]!;
    p0.splashRange = 3;
    p0.x = 1.5;
    p0.y = 9.5;
    const p1 = s.players[1]!;
    p1.x = 4.5;
    p1.y = 1.5;
    addBalloon(s, 0, 2, 1, 0);
    simulateTick(s, noInputs());
    expect(p1.alive).toBe(false);
    expect(p0.soaks).toBe(1);
    expect(p0.roundWins).toBe(1);
    expect(s.phase).toBe('roundEnd');
  });

  it('draws when the last two soak on the same tick', () => {
    const s = makeState();
    s.players[0]!.x = 1.5;
    s.players[0]!.y = 1.5;
    s.players[1]!.x = 4.5;
    s.players[1]!.y = 1.5;
    s.players[0]!.splashRange = 2;
    addBalloon(s, 0, 3, 1, 0);
    simulateTick(s, noInputs());
    expect(s.players[0]!.alive).toBe(false);
    expect(s.players[1]!.alive).toBe(false);
    expect(s.roundWinner).toBe(-1);
    expect(s.players[0]!.roundWins).toBe(0);
  });
});

describe('sim: powerups', () => {
  it('reveals pre-rolled contents on castle wash and applies on collect', () => {
    const s = makeState();
    const idx = tileIndex(s.w, 4, 1);
    s.tiles[idx] = TILE_CASTLE;
    s.castleContents.set(idx, 'range');
    const p0 = s.players[0]!;
    p0.splashRange = 4;
    p0.x = 1.5;
    p0.y = 9.5;
    s.players[1]!.x = 11.5;
    s.players[1]!.y = 9.5;
    addBalloon(s, 0, 2, 1, 0);
    simulateTick(s, noInputs());
    expect(s.exposedPowerUps.length).toBe(1);
    expect(s.exposedPowerUps[0]!.kind).toBe('range');
    const before = p0.splashRange;
    for (let i = 0; i < CONFIG.SPLASH_TICKS + 1; i++) simulateTick(s, noInputs());
    p0.x = 4.5;
    p0.y = 1.5;
    simulateTick(s, noInputs());
    expect(p0.splashRange).toBe(Math.min(CONFIG.STATS.RANGE_CAP, before + 1));
    expect(s.exposedPowerUps.length).toBe(0);
  });
});

describe('sim: kick', () => {
  it('slides a kicked balloon until blocked, keeping its fuse', () => {
    const s = makeState();
    const p0 = s.players[0]!;
    p0.hasBoots = true;
    p0.x = 1.5;
    p0.y = 1.5;
    s.players[1]!.x = 11.5;
    s.players[1]!.y = 9.5;
    const b = addBalloon(s, 0, 2, 1, 900);
    const inputs = new Map([[0, { seq: 1, dir: 2 as const, balloon: false }]]);
    simulateTick(s, inputs);
    expect(b.slideDir).toBe(2);
    const burstAt = b.burstTick;
    for (let i = 0; i < 40; i++) simulateTick(s, noInputs());
    expect(b.slideDir).toBe(DIR_NONE);
    expect(b.ty).toBe(1);
    expect(b.tx).toBeGreaterThan(2);
    expect(b.burstTick).toBe(burstAt);
  });
});

describe('map generation', () => {
  it('is deterministic per seed including hidden powerup contents', () => {
    const a = generateMap(13, 11, 'duel', 2, 42);
    const b = generateMap(13, 11, 'duel', 2, 42);
    expect(a.tiles).toEqual(b.tiles);
    expect([...a.castleContents.entries()]).toEqual([...b.castleContents.entries()]);
    const c = generateMap(13, 11, 'duel', 2, 43);
    expect(a.tiles).not.toEqual(c.tiles);
  });

  it('keeps spawn areas clear and places border boulders', () => {
    for (const seed of [1, 7, 99, 12345]) {
      const m = generateMap(15, 13, 'ffa', 4, seed);
      for (const s of m.spawns) {
        expect(m.tiles[tileIndex(m.w, s.x, s.y)]).toBe(TILE_FLOOR);
      }
      expect(m.tiles[tileIndex(m.w, 0, 0)]).toBe(TILE_BOULDER);
      expect(m.tiles[tileIndex(m.w, 2, 2)]).toBe(TILE_BOULDER);
    }
  });
});

describe('rng', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
});

describe('config sanity', () => {
  it('fuse and splash ticks match spec', () => {
    expect(CONFIG.FUSE_TICKS).toBe(90);
    expect(CONFIG.SPLASH_TICKS).toBe(12);
  });
});
