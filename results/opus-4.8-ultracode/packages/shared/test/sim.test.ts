import { describe, expect, it } from 'vitest';
import { simulateTick } from '../src/sim';
import { idx, Tile } from '../src/types';
import { addBalloon, addPlayer, blankState, input } from './helpers';

describe('chain bursts', () => {
  it('a 3-balloon chain all bursts in a single tick', () => {
    const s = blankState();
    // three balloons in a row; the first is fused to blow this tick
    addBalloon(s, 1, 1, { range: 2, fuseTick: 1 });
    addBalloon(s, 2, 1, { range: 2, fuseTick: 999 });
    addBalloon(s, 3, 1, { range: 2, fuseTick: 999 });

    const events = simulateTick(s, new Map());

    expect(s.balloons.length).toBe(0); // all three consumed in one tick
    const chain = events.find((e) => e.t === 'chain_burst');
    expect(chain).toBeDefined();
    expect(chain && chain.t === 'chain_burst' ? chain.count : 0).toBe(3);
  });

  it('two separated balloons do not chain (no chain_burst)', () => {
    const s = blankState();
    addBalloon(s, 1, 1, { range: 1, fuseTick: 1 });
    addBalloon(s, 5, 1, { range: 1, fuseTick: 1 }); // far apart, both fuse same tick but independent
    const events = simulateTick(s, new Map());
    expect(events.some((e) => e.t === 'chain_burst')).toBe(false);
    expect(s.balloons.length).toBe(0);
  });
});

describe('splash propagation', () => {
  it('splash stops at the first sandcastle and washes only it', () => {
    const s = blankState();
    s.grid[idx(3, 1, s.width)] = Tile.Sandcastle;
    s.grid[idx(4, 1, s.width)] = Tile.Sandcastle; // second castle should survive
    addBalloon(s, 1, 1, { range: 5, fuseTick: 1 });

    simulateTick(s, new Map());

    // first castle washed, second untouched
    expect(s.grid[idx(3, 1, s.width)]).toBe(Tile.Empty);
    expect(s.grid[idx(4, 1, s.width)]).toBe(Tile.Sandcastle);

    const hasSplash = (x: number, y: number) => s.splashes.some((c) => c.x === x && c.y === y);
    expect(hasSplash(2, 1)).toBe(true);
    expect(hasSplash(3, 1)).toBe(true); // the washed castle tile is soaked
    expect(hasSplash(4, 1)).toBe(false); // splash stopped
    expect(hasSplash(5, 1)).toBe(false);
  });

  it('boulders block splash entirely (no wash beyond)', () => {
    const s = blankState();
    s.grid[idx(3, 1, s.width)] = Tile.Boulder;
    s.grid[idx(4, 1, s.width)] = Tile.Sandcastle;
    addBalloon(s, 1, 1, { range: 5, fuseTick: 1 });
    simulateTick(s, new Map());
    expect(s.grid[idx(4, 1, s.width)]).toBe(Tile.Sandcastle); // boulder shielded it
    expect(s.splashes.some((c) => c.x === 3 && c.y === 1)).toBe(false);
  });
});

describe('soaking + round end', () => {
  it('soaks a player standing in the splash and ends the round', () => {
    const s = blankState(11, 11);
    addPlayer(s, 5, 5, { id: 'a', slot: 0 });
    addPlayer(s, 1, 1, { id: 'b', slot: 1 });
    // balloon by player a (slot 0) that catches player b at (1,1)
    addBalloon(s, 1, 1, { owner: 'a', range: 2, fuseTick: 1 });
    const events = simulateTick(s, new Map());
    const b = s.players.find((p) => p.id === 'b')!;
    expect(b.alive).toBe(false);
    expect(events.some((e) => e.t === 'player_soaked' && e.playerId === 'b')).toBe(true);
    expect(s.roundOver).toBe(true);
    expect(s.winnerSlot).toBe(0); // player a is the last one dry
  });

  it('two players soaked on the same tick is a draw', () => {
    const s = blankState(11, 11);
    addPlayer(s, 1, 1, { id: 'a', slot: 0 });
    addPlayer(s, 3, 1, { id: 'b', slot: 1 });
    // one balloon range 2 at (2,1) soaks both neighbours simultaneously
    addBalloon(s, 2, 1, { owner: 'x', range: 2, fuseTick: 1 });
    simulateTick(s, new Map());
    expect(s.players.every((p) => !p.alive)).toBe(true);
    expect(s.roundOver).toBe(true);
    expect(s.winnerSlot).toBe(null);
  });
});

describe('balloon placement + fuse', () => {
  it('places a balloon on the player tile and bursts after the fuse', () => {
    const s = blankState(11, 11);
    addPlayer(s, 5, 5, { id: 'a', slot: 0 });
    addPlayer(s, 9, 9, { id: 'b', slot: 1 }); // second player so the round does not end
    const inputs = new Map([['a', input(null, true)]]);
    simulateTick(s, inputs);
    expect(s.balloons.length).toBe(1);
    expect(s.balloons[0].x).toBe(5);
    const fuse = s.balloons[0].fuseTick;
    // advance until it bursts
    let bursts = 0;
    for (let t = s.tick; t < fuse + 2; t++) {
      const ev = simulateTick(s, new Map());
      if (ev.some((e) => e.t === 'balloon_burst')) bursts++;
    }
    expect(bursts).toBe(1);
    expect(s.balloons.length).toBe(0);
  });

  it('respects maxBalloons (cannot exceed the cap)', () => {
    const s = blankState(11, 11);
    const a = addPlayer(s, 5, 5, { id: 'a', slot: 0, maxBalloons: 1 });
    addPlayer(s, 9, 9, { id: 'b', slot: 1 });
    simulateTick(s, new Map([['a', input(null, true)]]));
    // move one tile then try to place again — still at cap of 1
    a.x = 6;
    simulateTick(s, new Map([['a', input(null, true)]]));
    expect(s.balloons.length).toBe(1);
  });
});
