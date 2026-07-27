import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  Dir,
  Tile,
  advancePlayer,
  cloneState,
  simulateTick,
  tileAt,
  type ChainBurstEvent,
  type PlayerSoakedEvent,
} from '../src/index.js';
import { armBalloon, hashState, input, makeArena, noInputs, placeAt } from './helpers.js';

describe('splash propagation', () => {
  it('washes away the first sandcastle in a direction and stops there', () => {
    const state = makeArena();
    placeAt(state, 0, 5, 5);
    placeAt(state, 1, 7, 5);
    // Two castles stacked below the balloon; only the nearer one may be washed.
    state.cells[3 * state.width + 1] = Tile.CASTLE;
    state.cells[4 * state.width + 1] = Tile.CASTLE;

    const balloon = armBalloon(state, 0, 1, 1, 5, 1);
    expect(balloon.range).toBe(5);
    simulateTick(state, noInputs());

    expect(tileAt(state, 1, 3)).toBe(Tile.EMPTY);
    expect(tileAt(state, 1, 4)).toBe(Tile.CASTLE);
    expect(state.splashes).toHaveLength(1);
    expect(state.splashes[0].arms[Dir.DOWN]).toBe(2);
    expect(state.splashes[0].capped[Dir.DOWN]).toBe(true);
  });

  it('stops at boulders without washing them', () => {
    const state = makeArena();
    placeAt(state, 0, 5, 5);
    placeAt(state, 1, 7, 5);
    // (2,2) is a pillar, so a balloon at (2,1) cannot splash downward at all.
    armBalloon(state, 0, 2, 1, 4, 1);
    simulateTick(state, noInputs());

    expect(tileAt(state, 2, 2)).toBe(Tile.BOULDER);
    expect(state.splashes[0].arms[Dir.DOWN]).toBe(0);
    expect(state.splashes[0].arms[Dir.UP]).toBe(0);
    expect(state.splashes[0].arms[Dir.RIGHT]).toBe(4);
  });

  it('reveals the pre-rolled power-up hidden in a washed castle', () => {
    const state = makeArena();
    placeAt(state, 0, 5, 5);
    placeAt(state, 1, 7, 5);
    state.cells[3 * state.width + 1] = Tile.CASTLE;
    state.castleContents[3 * state.width + 1] = 1; // extra_balloon

    armBalloon(state, 0, 1, 1, 3, 1);
    simulateTick(state, noInputs());

    expect(state.powerups).toHaveLength(1);
    expect(state.powerups[0]).toMatchObject({ type: 'extra_balloon', x: 1, y: 3 });
  });
});

describe('chain bursts', () => {
  it('bursts a three-balloon chain in a single tick', () => {
    const state = makeArena();
    placeAt(state, 0, 9, 9);
    placeAt(state, 1, 7, 7);

    armBalloon(state, 0, 1, 1, 2, 1); // fuse expires now
    armBalloon(state, 0, 1, 3, 2, 999); // reached by the first
    armBalloon(state, 0, 1, 5, 2, 999); // reached by the second

    const events = simulateTick(state, noInputs());

    expect(state.balloons).toHaveLength(0);
    expect(events.filter((e) => e.kind === 'balloon_burst')).toHaveLength(3);
    const chains = events.filter((e): e is ChainBurstEvent => e.kind === 'chain_burst');
    expect(chains).toHaveLength(1);
    expect(chains[0].count).toBe(3);
    expect(state.splashes).toHaveLength(3);
  });

  it('gives every chained balloon its own splash range', () => {
    const state = makeArena();
    placeAt(state, 0, 9, 9);
    placeAt(state, 1, 7, 7);

    armBalloon(state, 0, 1, 1, 2, 1);
    armBalloon(state, 0, 1, 3, 5, 999);
    simulateTick(state, noInputs());

    const far = state.splashes.find((s) => s.y === 3);
    expect(far?.arms[Dir.DOWN]).toBe(5);
  });

  it('returns each balloon slot to its owner after a cascade', () => {
    const state = makeArena();
    placeAt(state, 0, 9, 9);
    placeAt(state, 1, 7, 7);
    const owner = state.players[0];
    owner.balloonCount = 4;

    armBalloon(state, 0, 1, 1, 2, 1);
    armBalloon(state, 0, 1, 3, 2, 999);
    expect(owner.activeBalloons).toBe(2);

    simulateTick(state, noInputs());
    expect(owner.activeBalloons).toBe(0);
  });

  it('splash stops at a balloon rather than passing through it', () => {
    const state = makeArena();
    placeAt(state, 0, 9, 9);
    placeAt(state, 1, 7, 7);

    armBalloon(state, 0, 1, 1, 6, 1);
    armBalloon(state, 0, 1, 3, 1, 999);
    simulateTick(state, noInputs());

    const first = state.splashes.find((s) => s.y === 1);
    expect(first?.arms[Dir.DOWN]).toBe(2);
    expect(first?.capped[Dir.DOWN]).toBe(true);
  });
});

describe('soaking', () => {
  it('soaks a critter standing in the splash and credits the owner', () => {
    const state = makeArena();
    placeAt(state, 0, 5, 5);
    placeAt(state, 1, 1, 3);

    armBalloon(state, 0, 1, 1, 3, 1);
    const events = simulateTick(state, noInputs());

    const soaked = events.find((e): e is PlayerSoakedEvent => e.kind === 'player_soaked');
    expect(soaked?.playerId).toBe(1);
    expect(soaked?.byPlayerId).toBe(0);
    expect(state.players[0].soaks).toBe(1);
    expect(state.players[1].alive).toBe(false);
  });

  it('does not credit a soak to a player who splashed themselves', () => {
    const state = makeArena();
    placeAt(state, 0, 1, 1);
    placeAt(state, 1, 9, 9);

    armBalloon(state, 0, 1, 1, 3, 1);
    simulateTick(state, noInputs());

    expect(state.players[0].alive).toBe(false);
    expect(state.players[0].soaks).toBe(0);
  });

  it('calls a draw when the last two critters are soaked on the same tick', () => {
    const state = makeArena();
    placeAt(state, 0, 1, 2);
    placeAt(state, 1, 1, 4);

    armBalloon(state, 0, 1, 3, 2, 1);
    simulateTick(state, noInputs());

    expect(state.players.every((p) => !p.alive)).toBe(true);
    expect(state.phase).toBe('ended');
    expect(state.winners).toEqual([]);
  });

  it('ends the round with the last critter standing as the winner', () => {
    const state = makeArena();
    placeAt(state, 0, 5, 5);
    placeAt(state, 1, 1, 3);

    armBalloon(state, 0, 1, 1, 3, 1);
    simulateTick(state, noInputs());

    expect(state.phase).toBe('ended');
    expect(state.winners).toEqual([0]);
  });
});

describe('movement', () => {
  it('cannot walk through a boulder', () => {
    const state = makeArena();
    placeAt(state, 0, 1, 1);
    placeAt(state, 1, 9, 9);
    const player = state.players[0];

    for (let i = 0; i < 30; i++) {
      simulateTick(state, new Map([[0, input(Dir.UP)]]));
    }
    expect(player.y).toBeGreaterThan(1);
    expect(player.y).toBeLessThan(1.5);
  });

  it('auto-centres onto the lane so corridors are enterable', () => {
    const state = makeArena();
    placeAt(state, 0, 1, 1);
    placeAt(state, 1, 9, 9);
    const player = state.players[0];
    player.y = 1.9;

    simulateTick(state, new Map([[0, input(Dir.RIGHT)]]));
    expect(player.y).toBeLessThan(1.9);
    expect(player.y).toBeGreaterThanOrEqual(1.5);
  });

  it('lets the owner step off a balloon they just dropped, then blocks re-entry', () => {
    const state = makeArena();
    placeAt(state, 0, 1, 1);
    placeAt(state, 1, 9, 9);
    const player = state.players[0];

    simulateTick(state, new Map([[0, input(Dir.RIGHT, true)]]));
    expect(state.balloons).toHaveLength(1);

    for (let i = 0; i < 20; i++) simulateTick(state, new Map([[0, input(Dir.RIGHT)]]));
    expect(player.x).toBeGreaterThan(2.5);

    for (let i = 0; i < 40; i++) simulateTick(state, new Map([[0, input(Dir.LEFT)]]));
    // Blocked by the balloon it can no longer pass through.
    expect(player.x).toBeGreaterThan(2);
  });
});

describe('balloon kick', () => {
  it('slides a balloon away when a critter with Rubber Boots walks into it', () => {
    const state = makeArena();
    placeAt(state, 0, 1, 1);
    placeAt(state, 1, 9, 9);
    const player = state.players[0];
    player.hasKick = true;

    const balloon = armBalloon(state, 1, 3, 1, 2, 999);
    for (let i = 0; i < 40; i++) simulateTick(state, new Map([[0, input(Dir.RIGHT)]]));

    expect(Math.floor(balloon.x)).toBeGreaterThan(3);
    expect(balloon.burstTick).toBe(999 + 0);
  });

  it('does nothing without Rubber Boots', () => {
    const state = makeArena();
    placeAt(state, 0, 1, 1);
    placeAt(state, 1, 9, 9);

    const balloon = armBalloon(state, 1, 3, 1, 2, 999);
    for (let i = 0; i < 40; i++) simulateTick(state, new Map([[0, input(Dir.RIGHT)]]));

    expect(Math.floor(balloon.x)).toBe(3);
    expect(state.players[0].x).toBeLessThan(3);
  });
});

describe('power-ups', () => {
  it('applies stats on pickup and caps them', () => {
    const state = makeArena();
    placeAt(state, 0, 1, 1);
    placeAt(state, 1, 9, 9);
    const player = state.players[0];
    state.powerups.push({ id: 900, type: 'big_splash', x: 1, y: 1 });

    simulateTick(state, noInputs());
    expect(player.splashRange).toBe(CONFIG.RANGE_BASE + 1);
    expect(state.powerups).toHaveLength(0);

    player.splashRange = CONFIG.RANGE_CAP;
    state.powerups.push({ id: 901, type: 'big_splash', x: 1, y: 1 });
    simulateTick(state, noInputs());
    expect(player.splashRange).toBe(CONFIG.RANGE_CAP);
  });

  it('destroys an exposed power-up caught in a splash', () => {
    const state = makeArena();
    placeAt(state, 0, 5, 5);
    placeAt(state, 1, 7, 5);
    state.powerups.push({ id: 902, type: 'flippers', x: 1, y: 3 });

    armBalloon(state, 0, 1, 1, 3, 1);
    simulateTick(state, noInputs());
    expect(state.powerups).toHaveLength(0);
  });
});

describe('rising tide', () => {
  /** Runs until the round ends or the tide has had time to take the first ring. */
  const floodUntilDecided = (state: ReturnType<typeof makeArena>): void => {
    for (let i = 0; i < CONFIG.TIDE_RING_TICKS + 8; i++) {
      simulateTick(state, noInputs());
      if (state.phase === 'ended') return;
    }
  };

  it('lets the strongest round survive when the water would take everyone at once', () => {
    const state = makeArena();
    // Critters walk through each other, so sharing a tile is legal and is exactly
    // what the shrinking arena produces.
    placeAt(state, 0, 1, 1);
    placeAt(state, 1, 1, 1);
    state.players[0].soaks = 2;
    state.tick = CONFIG.TIDE_START_TICKS - 1;

    floodUntilDecided(state);

    expect(state.phase).toBe('ended');
    expect(state.winners).toEqual([0]);
    expect(state.players[1].alive).toBe(false);
  });

  it('still drowns everyone it catches while somebody else is left alive', () => {
    const state = makeArena('ffa', 321, [0, 1, 2, 3]);
    placeAt(state, 0, 1, 1);
    placeAt(state, 1, 1, 1);
    placeAt(state, 2, 7, 7);
    placeAt(state, 3, 7, 5);
    state.tick = CONFIG.TIDE_START_TICKS - 1;

    floodUntilDecided(state);

    // Two critters shared the first tile to flood and both went under, because
    // sparing one is only ever a tiebreak for the very last of them.
    expect(state.players[0].alive).toBe(false);
    expect(state.players[1].alive).toBe(false);
    expect(state.players[2].alive).toBe(true);
  });

  it('floods the outer ring and soaks whoever is standing in it', () => {
    const state = makeArena();
    placeAt(state, 0, 1, 1);
    placeAt(state, 1, 5, 5);
    state.tick = CONFIG.TIDE_START_TICKS - 1;

    for (let i = 0; i < CONFIG.TIDE_RING_TICKS + 2; i++) {
      simulateTick(state, noInputs());
      if (!state.players[0].alive) break;
    }

    expect(tileAt(state, 1, 1)).toBe(Tile.WATER);
    expect(state.players[0].alive).toBe(false);
  });
});

describe('rollback safety', () => {
  const script = [Dir.RIGHT, Dir.DOWN, Dir.NONE, Dir.LEFT, Dir.UP, Dir.RIGHT];

  const drive = (state: ReturnType<typeof makeArena>, ticks: number, from = 0): void => {
    for (let i = 0; i < ticks; i++) {
      const tick = from + i;
      const inputs = new Map(
        state.players.map((p) => [
          p.id,
          input(script[(tick + p.id * 3) % script.length], tick % 17 === p.id),
        ]),
      );
      simulateTick(state, inputs);
    }
  };

  it('deep copies everything, so replaying a clone cannot corrupt the original', () => {
    const authoritative = makeArena('ffa', 4242, [0, 1, 2, 3]);
    drive(authoritative, 90);

    const before = hashState(authoritative);
    const replayA = cloneState(authoritative);
    drive(replayA, 60, 90);

    // Rewinding and replaying must leave the authoritative state untouched.
    expect(hashState(authoritative)).toBe(before);

    // And a second replay from the same point must land in exactly the same world.
    const replayB = cloneState(authoritative);
    drive(replayB, 60, 90);
    expect(hashState(replayB)).toBe(hashState(replayA));
  });

  it('can replay a single player without the sim placing balloons for them', () => {
    const state = makeArena();
    placeAt(state, 0, 1, 1);
    placeAt(state, 1, 9, 9);
    const player = state.players[0];

    advancePlayer(state, player, input(Dir.RIGHT, true), { placeBalloons: false });
    expect(state.balloons).toHaveLength(0);
    expect(player.x).toBeGreaterThan(1.5);
  });
});

describe('determinism', () => {
  it('produces an identical world from identical seeds and inputs', () => {
    const script = [Dir.RIGHT, Dir.RIGHT, Dir.DOWN, Dir.NONE, Dir.LEFT, Dir.UP];

    const run = (): string => {
      const state = makeArena('ffa', 987654, [0, 1, 2, 3]);
      for (let tick = 0; tick < 240; tick++) {
        const inputs = new Map(
          state.players.map((p) => [
            p.id,
            input(script[(tick + p.id * 7) % script.length], tick % 23 === p.id),
          ]),
        );
        simulateTick(state, inputs);
      }
      return hashState(state);
    };

    expect(run()).toBe(run());
  });
});
