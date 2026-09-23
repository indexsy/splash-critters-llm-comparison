import { describe, expect, it } from 'vitest';
import { computeArms, splashTiles } from '../src/burst';
import { CONFIG } from '../src/config';
import { idx } from '../src/grid';
import { simulateTick } from '../src/sim';
import { Dir, PowerUp, Tile } from '../src/types';
import { inp, ofType, placePlayer, putBalloon, runTicks, stateFromAscii, tileAt, walkPath } from './fixtures';

// Row 1 is an open corridor; players wait on row 3, which pillars shield from row-1 splashes.
const CORRIDOR = ['###########', '#.........#', '#.#.#.#.#.#', '#0.......1#', '###########'];

describe('chain bursts (acceptance)', () => {
  it('a 3-balloon chain bursts in ONE tick with one chain_burst of count 3', () => {
    const s = stateFromAscii(CORRIDOR);
    const a = putBalloon(s, 2, 1, 0, { fuse: 1 });
    const b = putBalloon(s, 4, 1, 1, { fuse: 60 });
    const c = putBalloon(s, 6, 1, 0, { fuse: 80 });
    const events = simulateTick(s, []);
    const bursts = ofType(events, 'balloon_burst');
    expect(bursts.map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(new Set(bursts.map((e) => e.chainId))).toEqual(new Set([a.id]));
    expect(ofType(events, 'chain_burst')).toEqual([
      { type: 'chain_burst', count: 3, x: 2, y: 1, owner: 0, chainId: a.id },
    ]);
    expect(s.balloons).toEqual([]);
    expect(s.splashes.map((sp) => sp.chainId)).toEqual([a.id, a.id, a.id]);
    expect(s.players[0].stats.biggestChain).toBe(3);
    expect(s.players[1].stats.biggestChain).toBe(0);
  });

  it('chained balloons use their own range and arms pass through burst balloons', () => {
    const s = stateFromAscii(CORRIDOR);
    const a = putBalloon(s, 2, 1, 0, { fuse: 1, range: 2 });
    const b = putBalloon(s, 4, 1, 0, { range: 4 });
    const events = simulateTick(s, []);
    const [ea, eb] = ofType(events, 'balloon_burst');
    expect(ea.id).toBe(a.id);
    expect(ea.arms).toEqual([0, 0, 1, 2]); // left stops at the border, right stops on b
    expect(eb.id).toBe(b.id);
    expect(eb.arms).toEqual([0, 0, 3, 4]); // left passes a's (already burst) tile to the border
    expect(ofType(events, 'chain_burst')[0].count).toBe(2);
  });

  it('a single burst emits no chain_burst', () => {
    const s = stateFromAscii(CORRIDOR);
    putBalloon(s, 5, 1, 0, { fuse: 1 });
    const events = simulateTick(s, []);
    expect(ofType(events, 'balloon_burst')).toHaveLength(1);
    expect(ofType(events, 'chain_burst')).toEqual([]);
  });

  it('separate seeds due on the same tick form separate cascades', () => {
    const s = stateFromAscii(['###########', '#....C....#', '#.#.#.#.#.#', '#0.......1#', '###########']);
    const a = putBalloon(s, 3, 1, 0, { fuse: 1 });
    const b = putBalloon(s, 7, 1, 1, { fuse: 1 });
    const events = simulateTick(s, []);
    expect(ofType(events, 'balloon_burst').map((e) => [e.id, e.chainId])).toEqual([
      [a.id, a.id],
      [b.id, b.id],
    ]);
    expect(ofType(events, 'chain_burst')).toEqual([]);
    // Both arms reached the castle, which was a castle at the start of the phase: washed once.
    expect(ofType(events, 'castle_washed')).toEqual([{ type: 'castle_washed', x: 5, y: 1, by: 0 }]);
    expect(s.players[0].stats.castles).toBe(1);
    expect(s.players[1].stats.castles).toBe(0);
  });
});

describe('splash vs sandcastles (acceptance)', () => {
  it('a splash stops at the first sandcastle; the next castle and tiles beyond stay untouched', () => {
    const s = stateFromAscii(['###########', '#...CC....#', '#.#.#.#.#.#', '#0.......1#', '###########']);
    putBalloon(s, 2, 1, 0, { fuse: 1, range: 6 });
    const events = simulateTick(s, []);
    expect(ofType(events, 'balloon_burst')[0].arms).toEqual([0, 0, 1, 2]);
    expect(ofType(events, 'castle_washed')).toEqual([{ type: 'castle_washed', x: 4, y: 1, by: 0 }]);
    expect(tileAt(s, 4, 1)).toBe(Tile.Floor);
    expect(tileAt(s, 5, 1)).toBe(Tile.Castle);
    for (let x = 5; x <= 9; x++) expect(s.splashUntil[idx(s.w, x, 1)]).toBe(0);
    for (let x = 1; x <= 4; x++) expect(s.splashUntil[idx(s.w, x, 1)]).toBe(s.tick + CONFIG.SPLASH_TICKS);
  });

  it('arms stop before boulders and include the first castle', () => {
    const s = stateFromAscii(['#######', '#..C..#', '#.#.#.#', '#0...1#', '#######']);
    expect(computeArms(s, 1, 1, 5)).toEqual([0, 2, 0, 2]);
    expect(computeArms(s, 3, 3, 5)).toEqual([2, 0, 2, 2]);
    expect(splashTiles(3, 3, [1, 0, 2, 0])).toEqual([
      { x: 3, y: 3 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 1, y: 3 },
    ]);
  });

  it('computeArms treats any balloon as an arm stop and does not mutate state', () => {
    const s = stateFromAscii(CORRIDOR);
    putBalloon(s, 4, 1, 1);
    const before = JSON.stringify(s.balloons);
    expect(computeArms(s, 2, 1, 5)).toEqual([0, 0, 1, 2]);
    expect(JSON.stringify(s.balloons)).toBe(before);
  });
});

describe('power-up reveal and destruction', () => {
  it('reveals the hidden item; a same-tick splash does not destroy it, a later burst does', () => {
    const s = stateFromAscii(['###########', '#....B....#', '#.#.#.#.#.#', '#0.......1#', '###########']);
    putBalloon(s, 3, 1, 0, { fuse: 1 });
    putBalloon(s, 7, 1, 1, { fuse: 1 });
    const first = simulateTick(s, []);
    expect(ofType(first, 'powerup_revealed')).toEqual([{ type: 'powerup_revealed', x: 5, y: 1, kind: PowerUp.Balloon }]);
    expect(ofType(first, 'powerup_destroyed')).toEqual([]);
    expect(s.items[idx(s.w, 5, 1)]).toBe(PowerUp.Balloon);
    expect(s.hidden[idx(s.w, 5, 1)]).toBe(PowerUp.None);

    // Lingering splash alone never destroys an item.
    expect(ofType(runTicks(s, CONFIG.SPLASH_TICKS + 2), 'powerup_destroyed')).toEqual([]);
    expect(s.items[idx(s.w, 5, 1)]).toBe(PowerUp.Balloon);

    putBalloon(s, 4, 1, 0, { fuse: 1 });
    const later = simulateTick(s, []);
    expect(ofType(later, 'powerup_destroyed')).toEqual([{ type: 'powerup_destroyed', x: 5, y: 1, kind: PowerUp.Balloon }]);
    expect(s.items[idx(s.w, 5, 1)]).toBe(PowerUp.None);
  });

  it('destroys exposed items the splash covers', () => {
    const s = stateFromAscii(['###########', '#..r......#', '#.#.#.#.#.#', '#0.......1#', '###########']);
    putBalloon(s, 5, 1, 0, { fuse: 1 });
    const events = simulateTick(s, []);
    expect(ofType(events, 'powerup_destroyed')).toEqual([{ type: 'powerup_destroyed', x: 3, y: 1, kind: PowerUp.Range }]);
  });
});

describe('lingering splash', () => {
  it('soaks a player who walks into it while it lingers', () => {
    const s = stateFromAscii(['#########', '#0.....1#', '#.#.#.#.#', '#.......#', '#########']);
    walkPath(s, 0, [[1, 3]]);
    walkPath(s, 1, [[4, 1]]);
    putBalloon(s, 2, 1, 0, { fuse: 1, range: 1 });
    const burstTick = s.tick + 1;
    const burst = simulateTick(s, []);
    expect(ofType(burst, 'player_soaked')).toEqual([]);
    const events = runTicks(s, 6, [null, inp(Dir.Left)]);
    const soaked = ofType(events, 'player_soaked');
    expect(soaked).toEqual([{ type: 'player_soaked', slot: 1, by: 0, cause: 'splash', x: 3, y: 1 }]);
    expect(s.players[1].soakedTick).toBeLessThan(burstTick + CONFIG.SPLASH_TICKS);
    expect(s.players[0].stats.soaks).toBe(1);
  });

  it('bursts a balloon that ends up on a lingering splash tile', () => {
    const s = stateFromAscii(CORRIDOR);
    putBalloon(s, 2, 1, 0, { fuse: 1, range: 3 });
    simulateTick(s, []);
    const late = putBalloon(s, 4, 1, 1, { fuse: 80 });
    const events = simulateTick(s, []);
    expect(ofType(events, 'balloon_burst').map((e) => e.id)).toEqual([late.id]);
  });

  it('expires splash entities at their end tick', () => {
    const s = stateFromAscii(CORRIDOR);
    putBalloon(s, 5, 1, 0, { fuse: 1 });
    simulateTick(s, []);
    expect(s.splashes).toHaveLength(1);
    const end = s.splashes[0].endTick;
    runTicks(s, end - s.tick - 1);
    expect(s.splashes).toHaveLength(1);
    runTicks(s, 1);
    expect(s.tick).toBe(end);
    expect(s.splashes).toHaveLength(0);
  });
});

describe('chain soak credit', () => {
  it("credits a soak to the player whose balloon set off the victim's own balloon", () => {
    const s = stateFromAscii(CORRIDOR);
    placePlayer(s, 1, 6, 1);
    putBalloon(s, 2, 1, 0, { fuse: 1, range: 2 }); // A's balloon reaches B's at (4,1)
    putBalloon(s, 4, 1, 1, { fuse: 80, range: 2 }); // B's balloon reaches B at (6,1)
    const events = simulateTick(s, []);
    expect(ofType(events, 'player_soaked')).toEqual([
      { type: 'player_soaked', slot: 1, by: 0, cause: 'splash', x: 6, y: 1 },
    ]);
    expect(s.players[0].stats.soaks).toBe(1);
    expect(s.players[1].stats.selfSoaked).toBe(false);
  });

  it('keeps it a self-soak when the victim started the cascade', () => {
    const s = stateFromAscii(CORRIDOR);
    placePlayer(s, 1, 1, 1);
    putBalloon(s, 2, 1, 0, { fuse: 80, range: 2 }); // A's balloon reaches B at (1,1)
    putBalloon(s, 4, 1, 1, { fuse: 1, range: 2 }); // B's balloon goes off first and chains A's
    const events = simulateTick(s, []);
    expect(ofType(events, 'player_soaked')).toEqual([
      { type: 'player_soaked', slot: 1, by: 1, cause: 'splash', x: 1, y: 1 },
    ]);
    expect(s.players[1].stats.selfSoaked).toBe(true);
    expect(s.players[0].stats.soaks).toBe(0);
  });

  it('credits a balloon set off by lingering splash to the owner of that splash', () => {
    const s = stateFromAscii(CORRIDOR);
    placePlayer(s, 1, 5, 1);
    putBalloon(s, 2, 1, 0, { fuse: 1, range: 1 }); // A's splash lingers on (1..3, 1)
    simulateTick(s, []);
    putBalloon(s, 3, 1, 1, { fuse: 80, range: 2 }); // B's balloon lands in A's lingering water
    const events = simulateTick(s, []);
    expect(ofType(events, 'player_soaked')).toEqual([
      { type: 'player_soaked', slot: 1, by: 0, cause: 'splash', x: 5, y: 1 },
    ]);
  });
});
