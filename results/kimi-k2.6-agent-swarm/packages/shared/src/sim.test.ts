import { describe, it, expect } from 'vitest';
import { CONFIG } from './config.js';
import { generateMap, revealPowerUp, getTile, setTile } from './map.js';
import type { GeneratedMap } from './map.js';
import type { PlayerId, PlayerState, InputFrame, GameConfig, Direction, Tile } from './types.js';
import {
  simulateTick,
  createRoundState,
  getInitialPlayerState,
  canPlaceBalloon,
  isPlayerInSplash,
  resolveRoundEnd,
  type RoundState,
  type SimInput,
} from './sim.js';

// ------------------------------------------------------------------
// Test helpers
// ------------------------------------------------------------------

function createTestMap(width: number, height: number): GeneratedMap {
  const grid: Tile[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'empty')
  );

  for (let x = 0; x < width; x++) {
    grid[0][x] = 'boulder';
    grid[height - 1][x] = 'boulder';
  }
  for (let y = 0; y < height; y++) {
    grid[y][0] = 'boulder';
    grid[y][width - 1] = 'boulder';
  }

  for (let y = 2; y < height - 1; y += 2) {
    for (let x = 2; x < width - 1; x += 2) {
      grid[y][x] = 'boulder';
    }
  }

  return {
    width,
    height,
    grid,
    theme: 'backyard',
    spawnPoints: [
      { x: 1, y: 1 },
      { x: width - 2, y: height - 2 },
    ],
    hiddenPowerUps: new Map(),
  };
}

function createTestState(
  map: GeneratedMap,
  players: PlayerState[],
  opts?: Partial<RoundState>
): RoundState {
  return {
    tick: 0,
    map,
    players: players.map((p) => ({ ...p })),
    balloons: [],
    splashes: [],
    exposedPowerUps: new Map(),
    tideRing: 0,
    events: [],
    matchConfig: {
      mode: 'duel',
      roundsToWin: 3,
      enableKick: true,
      enableRevengeDucks: false,
      botFill: false,
    },
    roundNo: 1,
    winner: null,
    ended: false,
    ...opts,
  };
}

function makeInput(dir: Direction | null, balloonPressed = false): InputFrame {
  return { dir, balloonPressed };
}

function makeSimInput(
  tick: number,
  inputs: Map<PlayerId, InputFrame>
): SimInput {
  return { tick, playerInputs: inputs };
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('determinism', () => {
  it('same seed + same inputs → identical state after 100 ticks', () => {
    const seed = 42;
    const map = generateMap(seed, 'duel');
    const players = [
      getInitialPlayerState('p1', 'Player1', 'frog', map.spawnPoints[0]),
      getInitialPlayerState('p2', 'Player2', 'duck', map.spawnPoints[1]),
    ];
    const cfg: GameConfig = {
      mode: 'duel',
      roundsToWin: 3,
      enableKick: true,
      enableRevengeDucks: false,
      botFill: false,
    };

    let s1 = createRoundState(cfg, seed, 1, players.map((p) => ({ ...p })));
    let s2 = createRoundState(cfg, seed, 1, players.map((p) => ({ ...p })));

    const inputs = new Map<PlayerId, InputFrame>();
    inputs.set('p1', makeInput('right', true));
    inputs.set('p2', makeInput('left', false));

    for (let i = 0; i < 100; i++) {
      const sim = makeSimInput(i, inputs);
      s1 = simulateTick(s1, sim, CONFIG);
      s2 = simulateTick(s2, sim, CONFIG);
    }

    expect(s1.tick).toBe(s2.tick);
    expect(s1.players.map((p) => ({ x: p.x, y: p.y, alive: p.alive }))).toEqual(
      s2.players.map((p) => ({ x: p.x, y: p.y, alive: p.alive }))
    );
    expect(
      s1.balloons.map((b) => ({ x: b.x, y: b.y, fuseTicks: b.fuseTicks }))
    ).toEqual(
      s2.balloons.map((b) => ({ x: b.x, y: b.y, fuseTicks: b.fuseTicks }))
    );
  });
});

describe('chain burst', () => {
  it('3-balloon chain bursts in one tick', () => {
    const map = createTestMap(13, 11);
    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 1, y: 1 }),
    ];
    players[0].splashRange = 5;

    let state = createTestState(map, players);
    state.balloons = [
      {
        id: 'b1',
        x: 3,
        y: 3,
        fuseTicks: 1,
        ownerId: 'p1',
        solid: true,
        isKicked: false,
        kickDir: null,
        splashRange: 5,
      },
      {
        id: 'b2',
        x: 5,
        y: 3,
        fuseTicks: 100,
        ownerId: 'p1',
        solid: true,
        isKicked: false,
        kickDir: null,
        splashRange: 5,
      },
      {
        id: 'b3',
        x: 7,
        y: 3,
        fuseTicks: 100,
        ownerId: 'p1',
        solid: true,
        isKicked: false,
        kickDir: null,
        splashRange: 5,
      },
    ];
    state.players[0].balloonsAlive = 3;

    const sim = makeSimInput(0, new Map());
    state = simulateTick(state, sim, CONFIG);

    expect(state.balloons).toHaveLength(0);
    const chainEvent = state.events.find((e) => e.type === 'chain_burst');
    expect(chainEvent).toBeDefined();
    expect(
      chainEvent!.type === 'chain_burst' && chainEvent!.chainCount
    ).toBe(3);
  });
});

describe('splash stops at first sandcastle', () => {
  it('only first castle is destroyed per direction', () => {
    const map = createTestMap(13, 11);
    // Place a vertical line of sandcastles at (3,4), (3,5), (3,6)
    setTile(map, { x: 3, y: 4 }, 'sandcastle');
    setTile(map, { x: 3, y: 5 }, 'sandcastle');
    setTile(map, { x: 3, y: 6 }, 'sandcastle');

    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 1, y: 1 }),
    ];
    players[0].splashRange = 5;

    let state = createTestState(map, players);
    state.balloons = [
      {
        id: 'b1',
        x: 3,
        y: 3,
        fuseTicks: 1,
        ownerId: 'p1',
        solid: true,
        isKicked: false,
        kickDir: null,
        splashRange: 5,
      },
    ];
    state.players[0].balloonsAlive = 1;

    const sim = makeSimInput(0, new Map());
    state = simulateTick(state, sim, CONFIG);

    // Only the first sandcastle should be washed away
    expect(getTile(state.map, { x: 3, y: 4 })).toBe('empty');
    expect(getTile(state.map, { x: 3, y: 5 })).toBe('sandcastle');
    expect(getTile(state.map, { x: 3, y: 6 })).toBe('sandcastle');
  });
});

describe('power-up hidden', () => {
  it('same seed produces same hiddenPowerUps', () => {
    const m1 = generateMap(12345, 'duel');
    const m2 = generateMap(12345, 'duel');
    expect([...m1.hiddenPowerUps.entries()]).toEqual([
      ...m2.hiddenPowerUps.entries(),
    ]);
    expect(m1.theme).toBe(m2.theme);
  });

  it('revealPowerUp returns correct type and removes it', () => {
    const map = generateMap(12345, 'duel');
    const firstEntry = [...map.hiddenPowerUps.entries()][0];
    expect(firstEntry).toBeDefined();
    const [key, expectedType] = firstEntry;
    const [x, y] = key.split(',').map(Number);

    const revealed = revealPowerUp(map, { x, y });
    expect(revealed).toBe(expectedType);
    expect(map.hiddenPowerUps.has(key)).toBe(false);
  });
});

describe('player soak', () => {
  it('player in splash tile is eliminated', () => {
    const map = createTestMap(13, 11);
    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 3, y: 3 }),
    ];

    let state = createTestState(map, players);
    state.balloons = [
      {
        id: 'b1',
        x: 3,
        y: 3,
        fuseTicks: 1,
        ownerId: 'p1',
        solid: true,
        isKicked: false,
        kickDir: null,
        splashRange: 2,
      },
    ];
    state.players[0].balloonsAlive = 1;

    const sim = makeSimInput(0, new Map());
    state = simulateTick(state, sim, CONFIG);

    expect(state.players[0].alive).toBe(false);
    expect(
      state.events.some((e) => e.type === 'player_soaked')
    ).toBe(true);
  });
});

describe('tide', () => {
  it('water ring advances at correct ticks and soaks players on flooded tiles', () => {
    const map = createTestMap(13, 11);
    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 1, y: 1 }),
    ];

    let state = createTestState(map, players);
    // Ring 1 floods at TIDE_START_TICKS (border, already boulders).
    // Ring 2 floods at TIDE_START_TICKS + TIDE_INTERVAL_TICKS.
    // Set tick so that after simulateTick we land exactly on the ring-2 tick.
    state.tick = CONFIG.TIDE_START_TICKS + CONFIG.TIDE_INTERVAL_TICKS - 1;
    state.tideRing = 1; // simulate that ring 1 already happened

    const sim = makeSimInput(state.tick, new Map());
    state = simulateTick(state, sim, CONFIG);

    // Player at (1,1) should be soaked by ring 2
    expect(state.players[0].alive).toBe(false);
    expect(
      state.events.some((e) => e.type === 'tide_advance')
    ).toBe(true);
    expect(getTile(state.map, { x: 1, y: 1 })).toBe('water');
  });
});

describe('kick', () => {
  it('kicked balloon slides in the correct direction', () => {
    const map = createTestMap(13, 11);
    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 2.9, y: 3 }),
      getInitialPlayerState('p2', 'P2', 'duck', { x: 5, y: 3 }),
    ];
    players[0].hasBoots = true;

    let state = createTestState(map, players);
    state.balloons = [
      {
        id: 'b1',
        x: 3,
        y: 3,
        fuseTicks: 90,
        ownerId: 'p2',
        solid: true,
        isKicked: false,
        kickDir: null,
        splashRange: 2,
      },
    ];
    state.players[1].balloonsAlive = 1;

    // p1 moves right onto (3,3) and kicks the balloon
    const inputs = new Map<PlayerId, InputFrame>();
    inputs.set('p1', makeInput('right', false));
    const sim = makeSimInput(0, inputs);

    state = simulateTick(state, sim, CONFIG);

    // p1 should be on tile (3,3)
    expect(Math.floor(state.players[0].x)).toBe(3);
    expect(Math.floor(state.players[0].y)).toBe(3);
    // Balloon should have slid to (4,3)
    const b1 = state.balloons.find((b) => b.id === 'b1');
    expect(b1).toBeDefined();
    expect(b1!.x).toBe(4);
    expect(b1!.y).toBe(3);
    expect(b1!.isKicked).toBe(true);
    expect(b1!.kickDir).toBe('right');
    expect(
      state.events.some((e) => e.type === 'balloon_kicked')
    ).toBe(true);
  });

  it('kicked balloon stops at a boulder', () => {
    const map = createTestMap(13, 11);
    // Place a boulder at (4,3)
    setTile(map, { x: 4, y: 3 }, 'boulder');

    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 2.9, y: 3 }),
    ];
    players[0].hasBoots = true;

    let state = createTestState(map, players);
    state.balloons = [
      {
        id: 'b1',
        x: 3,
        y: 3,
        fuseTicks: 90,
        ownerId: 'p2',
        solid: true,
        isKicked: false,
        kickDir: null,
        splashRange: 2,
      },
    ];

    const inputs = new Map<PlayerId, InputFrame>();
    inputs.set('p1', makeInput('right', false));
    const sim = makeSimInput(0, inputs);

    state = simulateTick(state, sim, CONFIG);

    // Balloon should stay at (3,3) because (4,3) is a boulder
    const b1 = state.balloons.find((b) => b.id === 'b1');
    expect(b1).toBeDefined();
    expect(b1!.x).toBe(3);
    expect(b1!.y).toBe(3);
    expect(b1!.isKicked).toBe(false);
    expect(b1!.kickDir).toBeNull();
  });
});

describe('movement collision', () => {
  it('player cannot walk through a boulder', () => {
    const map = createTestMap(13, 11);
    setTile(map, { x: 3, y: 3 }, 'boulder');

    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 2.9, y: 3 }),
    ];

    let state = createTestState(map, players);
    const inputs = new Map<PlayerId, InputFrame>();
    inputs.set('p1', makeInput('right', false));
    const sim = makeSimInput(0, inputs);

    state = simulateTick(state, sim, CONFIG);

    // Player should be snapped back to tile 2
    expect(Math.floor(state.players[0].x)).toBe(2);
    expect(Math.floor(state.players[0].y)).toBe(3);
  });

  it('player cannot walk through a sandcastle', () => {
    const map = createTestMap(13, 11);
    setTile(map, { x: 3, y: 3 }, 'sandcastle');

    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 2.9, y: 3 }),
    ];

    let state = createTestState(map, players);
    const inputs = new Map<PlayerId, InputFrame>();
    inputs.set('p1', makeInput('right', false));
    const sim = makeSimInput(0, inputs);

    state = simulateTick(state, sim, CONFIG);

    expect(Math.floor(state.players[0].x)).toBe(2);
    expect(Math.floor(state.players[0].y)).toBe(3);
  });
});

describe('canPlaceBalloon', () => {
  it('returns true when player can place', () => {
    const map = createTestMap(13, 11);
    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 2, y: 3 }),
    ];
    const state = createTestState(map, players);
    expect(canPlaceBalloon(state, 'p1')).toBe(true);
  });

  it('returns false when on a boulder', () => {
    const map = createTestMap(13, 11);
    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 2, y: 3 }),
    ];
    const state = createTestState(map, players);
    setTile(map, { x: 2, y: 3 }, 'boulder');
    expect(canPlaceBalloon(state, 'p1')).toBe(false);
  });
});

describe('isPlayerInSplash', () => {
  it('returns true when player is in a splash tile', () => {
    const map = createTestMap(13, 11);
    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 3, y: 3 }),
    ];
    const state = createTestState(map, players);
    state.splashes = [
      { x: 3, y: 3, ticksRemaining: 10, ownerId: 'p1' },
    ];
    expect(isPlayerInSplash(state, 'p1')).toBe(true);
  });

  it('returns false when splash is elsewhere', () => {
    const map = createTestMap(13, 11);
    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 3, y: 3 }),
    ];
    const state = createTestState(map, players);
    state.splashes = [
      { x: 5, y: 5, ticksRemaining: 10, ownerId: 'p1' },
    ];
    expect(isPlayerInSplash(state, 'p1')).toBe(false);
  });
});

describe('resolveRoundEnd', () => {
  it('returns winner when one player remains', () => {
    const map = createTestMap(13, 11);
    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 1, y: 1 }),
      getInitialPlayerState('p2', 'P2', 'duck', { x: 11, y: 9 }),
    ];
    let state = createTestState(map, players);
    state.players[1].alive = false;
    state.ended = true;
    state.winner = 'p1';

    const result = resolveRoundEnd(state);
    expect(result).not.toBeNull();
    expect(result!.winner).toBe('p1');
    expect(result!.placements[0]).toBe('p1');
  });

  it('returns null when round has not ended', () => {
    const map = createTestMap(13, 11);
    const players = [
      getInitialPlayerState('p1', 'P1', 'frog', { x: 1, y: 1 }),
    ];
    const state = createTestState(map, players);
    expect(resolveRoundEnd(state)).toBeNull();
  });
});
