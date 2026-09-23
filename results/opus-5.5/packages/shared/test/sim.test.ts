import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { nearestDuckPos } from '../src/ducks';
import { idx, tileCenter } from '../src/grid';
import { simulateTick, survivedTicks } from '../src/sim';
import { activeBalloonCount, balloonAt, createRoundState, makeRules } from '../src/state';
import { buildTutorialMap } from '../src/map';
import { Dir, PowerUp } from '../src/types';
import { dropBalloon, inp, mapFromAscii, ofType, placePlayer, putBalloon, runTicks, stateFromAscii, walkPath } from './fixtures';

const ARENA = ['#########', '#0......#', '#.#.#.#.#', '#......1#', '#########'];

describe('rules and round setup', () => {
  it('makeRules: casual has ducks, ranked does not, the tutorial is a tide-free sandbox', () => {
    expect(makeRules({ ranked: false })).toEqual({
      kick: CONFIG.ENABLE_KICK,
      revengeDucks: true,
      tide: true,
      tideStartTick: CONFIG.TIDE_START_TICKS,
      sandbox: false,
    });
    expect(makeRules({ ranked: true }).revengeDucks).toBe(CONFIG.REVENGE_DUCKS_IN_RANKED);
    expect(makeRules({ ranked: false, tutorial: true })).toMatchObject({ sandbox: true, tide: false, revengeDucks: false });
  });

  it('createRoundState spawns present players at their tile centers and copies the map', () => {
    const s = stateFromAscii(['#######', '#0...2#', '#.#.#.#', '#.....#', '#######'], { present: [true, false, true] });
    expect(s.players.map((p) => [p.slot, p.present, p.alive])).toEqual([
      [0, true, true],
      [1, false, false],
      [2, true, true],
    ]);
    expect([s.players[2].x, s.players[2].y]).toEqual([tileCenter(5), tileCenter(1)]);
    expect(s.players[0]).toMatchObject({ maxBalloons: 1, range: 2, speedUps: 0, canKick: false, duckPos: -1 });
    expect(s.nextTideTick).toBe(CONFIG.TIDE_START_TICKS);
    expect(Array.from(s.splashOwner).every((v) => v === -1)).toBe(true);
  });

  it('refuses a present slot without a spawn', () => {
    const { map } = mapFromAscii(['#####', '#0..#', '#####']);
    expect(() => createRoundState(map, [true, true], makeRules({ ranked: false }))).toThrow(/no spawn/);
  });
});

describe('balloon placement', () => {
  it('places at the player tile with the full fuse and the player range', () => {
    const s = stateFromAscii(ARENA);
    s.players[0].range = 4;
    const events = dropBalloon(s, 0);
    expect(ofType(events, 'balloon_placed')).toHaveLength(1);
    expect(balloonAt(s, 1, 1)).toMatchObject({ owner: 0, placedTick: 1, burstTick: 1 + CONFIG.FUSE_TICKS, range: 4 });
    expect(activeBalloonCount(s, 0)).toBe(1);
  });

  it('respects maxBalloons and one balloon per tile', () => {
    const s = stateFromAscii(ARENA);
    dropBalloon(s, 0);
    walkPath(s, 0, [[3, 1]]);
    expect(ofType(dropBalloon(s, 0), 'balloon_placed')).toEqual([]);
    s.players[0].maxBalloons = 3;
    expect(ofType(dropBalloon(s, 0), 'balloon_placed')).toHaveLength(1);
    expect(ofType(dropBalloon(s, 0), 'balloon_placed')).toEqual([]);
    expect(activeBalloonCount(s, 0)).toBe(2);
  });

  it('never places on flooded tiles', () => {
    const s = stateFromAscii(ARENA);
    s.tideLevel = 1;
    expect(ofType(dropBalloon(s, 0), 'balloon_placed')).toEqual([]);
  });
});

describe('power-ups', () => {
  it('collects on contact: balloon, range, speed, boots', () => {
    const s = stateFromAscii(['#########', '#0brsk..#', '#.#.#.#.#', '#......1#', '#########']);
    const events = walkPath(s, 0, [[6, 1]]);
    expect(ofType(events, 'powerup_collected').map((e) => [e.kind, e.x, e.slot])).toEqual([
      [PowerUp.Balloon, 2, 0],
      [PowerUp.Range, 3, 0],
      [PowerUp.Speed, 4, 0],
      [PowerUp.Boots, 5, 0],
    ]);
    expect(s.players[0]).toMatchObject({ maxBalloons: 2, range: 3, speedUps: 1, canKick: true });
    expect(s.players[0].stats.powerups).toBe(4);
    expect(Array.from(s.items).every((k) => k === PowerUp.None)).toBe(true);
  });

  it('stops at the caps, applies Boots once, and always consumes the item', () => {
    const s = stateFromAscii(['#########', '#0brskk.#', '#.#.#.#.#', '#......1#', '#########']);
    Object.assign(s.players[0], { maxBalloons: CONFIG.BALLOONS_CAP, range: CONFIG.RANGE_CAP, speedUps: 8 });
    const events = walkPath(s, 0, [[7, 1]]);
    expect(ofType(events, 'powerup_collected')).toHaveLength(5);
    expect(s.players[0]).toMatchObject({ maxBalloons: 8, range: 10, speedUps: 8, canKick: true });
    expect(Array.from(s.items).every((k) => k === PowerUp.None)).toBe(true);
  });

  it('keeps adding Flippers only while below the speed cap', () => {
    const s = stateFromAscii(['#########', '#0ssssss#', '#.#.#.#.#', '#......1#', '#########']);
    s.players[0].speedUps = 5;
    walkPath(s, 0, [[7, 1]]);
    expect(s.players[0].speedUps).toBe(8); // 4.0 + 0.4 * 8 = 7.2 -> capped at 7.0; the 9th never applies
  });
});

describe('soaks and round over', () => {
  it('credits the soaker and ends the round with a winner', () => {
    const s = stateFromAscii(['#########', '#0..1...#', '#.#.#.#.#', '#.......#', '#########']);
    putBalloon(s, 3, 1, 0, { fuse: 1 });
    placePlayer(s, 0, 1, 3);
    const events = simulateTick(s, []);
    expect(ofType(events, 'player_soaked')).toEqual([{ type: 'player_soaked', slot: 1, by: 0, cause: 'splash', x: 4, y: 1 }]);
    expect(ofType(events, 'round_over')).toEqual([{ type: 'round_over', winner: 0, draw: false }]);
    expect([s.over, s.winner]).toEqual([true, 0]);
    expect(s.players[0].stats.soaks).toBe(1);
    expect(s.players[1]).toMatchObject({ alive: false, soakedTick: 1, soakedBy: 0 });
  });

  it('is a draw when the last players are soaked on the same tick', () => {
    const s = stateFromAscii(['#########', '#0.1....#', '#.#.#.#.#', '#.......#', '#########']);
    putBalloon(s, 2, 1, 0, { fuse: 1 });
    const events = simulateTick(s, []);
    expect(ofType(events, 'player_soaked').map((e) => e.slot)).toEqual([0, 1]);
    expect(ofType(events, 'round_over')).toEqual([{ type: 'round_over', winner: -1, draw: true }]);
    expect([s.over, s.winner]).toEqual([true, -1]);
    expect(s.players[0].stats).toMatchObject({ selfSoaked: true, soaks: 1 });
  });

  it('only advances the tick once the round is over', () => {
    const s = stateFromAscii(['#########', '#0.1....#', '#.#.#.#.#', '#.......#', '#########']);
    putBalloon(s, 2, 1, 0, { fuse: 1 });
    simulateTick(s, []);
    const late = putBalloon(s, 6, 1, 1, { fuse: 1 });
    expect(simulateTick(s, [inp(Dir.Right, true)])).toEqual([]);
    expect(s.tick).toBe(2);
    expect(s.balloons).toEqual([late]);
  });

  it('stops counting the survivor once the round is over (the server keeps stepping it while it settles)', () => {
    const s = stateFromAscii(['#########', '#0..1...#', '#.#.#.#.#', '#.......#', '#########']);
    runTicks(s, 10);
    putBalloon(s, 4, 1, 0, { fuse: 1 });
    simulateTick(s, []);
    expect([s.over, s.overTick, s.players[1].soakedTick]).toEqual([true, 11, 11]);
    runTicks(s, Math.round(CONFIG.ROUND_OVER_DELAY_MS / CONFIG.TICK_MS));
    expect(s.tick).toBeGreaterThan(11);
    expect(survivedTicks(s, s.players[0])).toBe(11);
    expect(survivedTicks(s, s.players[1])).toBe(11);
  });

  it('never ends a sandbox round', () => {
    const s = stateFromAscii(['#########', '#0..1...#', '#.#.#.#.#', '#.......#', '#########'], {
      rules: makeRules({ ranked: false, tutorial: true }),
    });
    putBalloon(s, 3, 1, 0, { fuse: 1 });
    placePlayer(s, 0, 1, 3);
    const events = simulateTick(s, []);
    expect(ofType(events, 'player_soaked')).toHaveLength(1);
    expect(ofType(events, 'round_over')).toEqual([]);
    expect(s.over).toBe(false);
  });

  it('gives a revenge duck in casual rules but not in ranked', () => {
    for (const ranked of [false, true]) {
      const s = stateFromAscii(ARENA, { rules: makeRules({ ranked }) });
      placePlayer(s, 1, 4, 3);
      putBalloon(s, 4, 3, 0, { fuse: 1 });
      simulateTick(s, []);
      const p = s.players[1];
      if (ranked) expect(p.duckPos).toBe(-1);
      else {
        expect(p.duckPos).toBe(nearestDuckPos(s.w, s.h, p.x, p.y));
        expect(p.duckCooldownUntil).toBe(s.tick + CONFIG.DUCK_LOB_COOLDOWN_TICKS);
      }
    }
  });

  it('reports survived ticks', () => {
    const s = stateFromAscii(['#########', '#0..1...#', '#.#.#.#.#', '#.......#', '#########'], {
      present: [true, true, false],
      rules: makeRules({ ranked: false, tutorial: true }),
    });
    runTicks(s, 10);
    putBalloon(s, 3, 1, 0, { fuse: 5 });
    walkPath(s, 0, [[1, 3]]);
    runTicks(s, 10);
    expect(survivedTicks(s, s.players[0])).toBe(s.tick);
    expect(survivedTicks(s, s.players[1])).toBe(15);
    expect(survivedTicks(s, s.players[2])).toBe(0);
  });
});

describe('tutorial arena lesson route', () => {
  it('supports pop-a-castle, pickup, a 2-balloon chain on a castle pair, then soaking the bot', () => {
    const s = createRoundState(buildTutorialMap(), [true, true], makeRules({ ranked: false, tutorial: true }));
    const at = (x: number, y: number) => s.tiles[idx(s.w, x, y)];

    walkPath(s, 0, [[1, 3]]);
    dropBalloon(s, 0);
    walkPath(s, 0, [[1, 7]]);
    const pop = runTicks(s, 80);
    expect(ofType(pop, 'castle_washed').map((e) => [e.x, e.y])).toEqual([[2, 3]]);
    expect(ofType(pop, 'powerup_revealed').map((e) => [e.x, e.y, e.kind])).toEqual([[2, 3, PowerUp.Balloon]]);

    const pickup = walkPath(s, 0, [[1, 3], [2, 3]]);
    expect(ofType(pickup, 'powerup_collected')).toHaveLength(1);
    expect(s.players[0].maxBalloons).toBe(2);

    walkPath(s, 0, [[3, 3]]);
    dropBalloon(s, 0);
    walkPath(s, 0, [[5, 3]]);
    dropBalloon(s, 0);
    walkPath(s, 0, [[8, 3]]);
    const chain = runTicks(s, 90);
    expect(ofType(chain, 'chain_burst').map((e) => e.count)).toEqual([2]);
    expect(ofType(chain, 'castle_washed').map((e) => [e.x, e.y])).toEqual([
      [3, 2],
      [5, 2],
    ]);
    expect(ofType(chain, 'player_soaked')).toEqual([]);
    expect([at(3, 2), at(5, 2), at(5, 1)]).toEqual([0, 0, 2]);

    walkPath(s, 0, [[9, 3]]);
    dropBalloon(s, 0);
    walkPath(s, 0, [[7, 3], [7, 2]]);
    const finale = runTicks(s, 90);
    expect(ofType(finale, 'player_soaked')).toEqual([{ type: 'player_soaked', slot: 1, by: 0, cause: 'splash', x: 9, y: 4 }]);
    expect(s.players[0].alive).toBe(true);
    expect(s.over).toBe(false);
  });
});
