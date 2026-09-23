import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { borderLoopLength, duckTile, duckXY, nearestDuckPos, stepDuck } from '../src/ducks';
import { idx, tileCenter } from '../src/grid';
import { simulateTick } from '../src/sim';
import { Dir, Tile, type DirCode, type GameEvent, type PlayerInput } from '../src/types';
import { inp, ofType, putBalloon, runTicks, runUntil, stateFromAscii } from './fixtures';

const SUB = CONFIG.SUB;

describe('border loop geometry', () => {
  const W = 13;
  const H = 11;

  it('runs clockwise from (0,0) with one tile per SUB', () => {
    expect(borderLoopLength(W, H)).toBe((2 * 12 + 2 * 10) * SUB);
    expect(duckTile(W, H, 0)).toEqual({ tx: 0, ty: 0, side: -1 });
    expect(duckTile(W, H, SUB)).toEqual({ tx: 1, ty: 0, side: 0 });
    expect(duckTile(W, H, 12 * SUB)).toEqual({ tx: 12, ty: 0, side: -1 });
    expect(duckTile(W, H, 13 * SUB)).toEqual({ tx: 12, ty: 1, side: 1 });
    expect(duckTile(W, H, 22 * SUB)).toEqual({ tx: 12, ty: 10, side: -1 });
    expect(duckTile(W, H, 23 * SUB)).toEqual({ tx: 11, ty: 10, side: 2 });
    expect(duckTile(W, H, 34 * SUB)).toEqual({ tx: 0, ty: 10, side: -1 });
    expect(duckTile(W, H, 43 * SUB)).toEqual({ tx: 0, ty: 1, side: 3 });
    expect(duckTile(W, H, -SUB)).toEqual({ tx: 0, ty: 1, side: 3 });
  });

  it('rounds to the nearest border tile', () => {
    expect(duckTile(W, H, SUB / 2 - 1).tx).toBe(0);
    expect(duckTile(W, H, SUB / 2).tx).toBe(1);
  });

  it('visits every border tile exactly once, and duckXY sits on its center', () => {
    const seen = new Set<string>();
    for (let k = 0; k < 44; k++) {
      const t = duckTile(W, H, k * SUB);
      expect(t.tx === 0 || t.ty === 0 || t.tx === W - 1 || t.ty === H - 1).toBe(true);
      seen.add(`${t.tx},${t.ty}`);
      expect(duckXY(W, H, k * SUB)).toEqual({ x: tileCenter(t.tx), y: tileCenter(t.ty) });
    }
    expect(seen.size).toBe(44);
  });

  it('interpolates between tile centers', () => {
    expect(duckXY(W, H, 1500)).toEqual({ x: 3000, y: 1500 });
    expect(duckXY(W, H, 12 * SUB + 1000)).toEqual({ x: tileCenter(12), y: 2500 });
    expect(duckXY(W, H, 22 * SUB + 500)).toEqual({ x: tileCenter(12) - 500, y: tileCenter(10) });
  });

  it('nearestDuckPos snaps to the closest border tile (ties: top, right, bottom, left)', () => {
    const at = (tx: number, ty: number) => nearestDuckPos(W, H, tileCenter(tx), tileCenter(ty));
    expect(at(3, 1)).toBe(3 * SUB);
    expect(duckTile(W, H, at(11, 5))).toMatchObject({ tx: 12, ty: 5 });
    expect(duckTile(W, H, at(5, 9))).toMatchObject({ tx: 5, ty: 10 });
    expect(duckTile(W, H, at(1, 6))).toMatchObject({ tx: 0, ty: 6 });
    expect(at(1, 1)).toBe(1 * SUB);
  });
});

// 9x7; slot 2 is the soaked duck rider in these tests.
const LAKE = ['#########', '#.......#', '#.#.#.#.#', '#..0....#', '#.#.#.#.#', '#1.....2#', '#########'];

function duckState(pos: number) {
  const s = stateFromAscii(LAKE);
  const rider = s.players[2];
  rider.alive = false;
  rider.soakedTick = 0;
  rider.duckPos = pos;
  return { s, rider };
}

function step(dir: DirCode, balloon = false, pos = 3 * SUB) {
  const { s, rider } = duckState(pos);
  const events: GameEvent[] = [];
  stepDuck(s, rider, inp(dir, balloon), events);
  return { s, rider, events };
}

describe('duck movement', () => {
  it('moves along an edge with the edge axis only', () => {
    const speed = (CONFIG.DUCK_SPEED * SUB) / CONFIG.TICK_RATE;
    expect(step(Dir.Right).rider.duckPos).toBe(3 * SUB + speed);
    expect(step(Dir.Left).rider.duckPos).toBe(3 * SUB - speed);
    const blocked = step(Dir.Down);
    expect(blocked.rider.duckPos).toBe(3 * SUB);
    expect(blocked.rider.moving).toBe(false);
  });

  it('stops on a corner until the other axis is pressed; either axis works there', () => {
    const { s, rider } = duckState(8 * SUB - 1000);
    const right: PlayerInput = inp(Dir.Right);
    stepDuck(s, rider, right, []);
    expect(rider.duckPos).toBe(8 * SUB - 400);
    stepDuck(s, rider, right, []);
    expect(rider.duckPos).toBe(8 * SUB);
    stepDuck(s, rider, right, []);
    expect(rider.duckPos).toBe(8 * SUB);
    stepDuck(s, rider, inp(Dir.Down), []);
    expect(rider.duckPos).toBe(8 * SUB + 600);
    expect(duckTile(s.w, s.h, rider.duckPos).side).toBe(-1);
    stepDuck(s, rider, inp(Dir.Up), []);
    stepDuck(s, rider, inp(Dir.Left), []);
    expect(rider.duckPos).toBe(8 * SUB - 600);
  });

  it('wraps around the top-left corner', () => {
    const { s, rider } = duckState(0);
    stepDuck(s, rider, inp(Dir.Down), []);
    expect(rider.duckPos).toBe(borderLoopLength(s.w, s.h) - 600);
    expect(duckTile(s.w, s.h, rider.duckPos)).toMatchObject({ tx: 0 });
  });

  it('ignores a null input', () => {
    const { s, rider } = duckState(3 * SUB);
    stepDuck(s, rider, null, []);
    expect(rider.duckPos).toBe(3 * SUB);
  });
});

describe('duck lobs', () => {
  it('lands on the farthest open floor tile straight inward', () => {
    const { s, rider, events } = step(Dir.None, true);
    const lob = ofType(events, 'revenge_lob');
    expect(lob).toEqual([{ type: 'revenge_lob', slot: 2, id: lob[0].id, fromX: 3, fromY: 0, toX: 3, toY: 3 }]);
    expect(s.balloons).toHaveLength(1);
    expect(s.balloons[0]).toMatchObject({
      owner: 2,
      tx: 3,
      ty: 3,
      fromDuck: true,
      range: CONFIG.DUCK_BALLOON_RANGE,
      burstTick: s.tick + CONFIG.DUCK_FUSE_TICKS,
    });
    expect(rider.duckCooldownUntil).toBe(s.tick + CONFIG.DUCK_LOB_COOLDOWN_TICKS);
  });

  it('flies over pillars and skips castles, balloons and flood water', () => {
    const over = step(Dir.None, true, 2 * SUB);
    expect(ofType(over.events, 'revenge_lob')[0]).toMatchObject({ toX: 2, toY: 3 });

    const { s, rider } = duckState(3 * SUB);
    putBalloon(s, 3, 3, 0);
    s.tiles[idx(s.w, 3, 2)] = Tile.Castle;
    const events: GameEvent[] = [];
    stepDuck(s, rider, inp(Dir.None, true), events);
    expect(ofType(events, 'revenge_lob')[0]).toMatchObject({ toX: 3, toY: 1 });

    const flooded = duckState(3 * SUB);
    flooded.s.tideLevel = 3;
    const none: GameEvent[] = [];
    stepDuck(flooded.s, flooded.rider, inp(Dir.None, true), none);
    expect(none).toEqual([]);
    expect(flooded.rider.duckCooldownUntil).toBe(0);
  });

  it('skips tiles under lingering splash water and lands once it has drained', () => {
    const wet = duckState(3 * SUB);
    wet.s.splashUntil[idx(wet.s.w, 3, 3)] = wet.s.tick + 1;
    const events: GameEvent[] = [];
    stepDuck(wet.s, wet.rider, inp(Dir.None, true), events);
    expect(ofType(events, 'revenge_lob')[0]).toMatchObject({ toX: 3, toY: 2 });

    const drained = duckState(3 * SUB);
    drained.s.splashUntil[idx(drained.s.w, 3, 3)] = drained.s.tick;
    const dry: GameEvent[] = [];
    stepDuck(drained.s, drained.rider, inp(Dir.None, true), dry);
    expect(ofType(dry, 'revenge_lob')[0]).toMatchObject({ toX: 3, toY: 3 });
  });

  it('never throws a zero-fuse lob into lingering water; waits for a fully fused one', () => {
    const s = stateFromAscii(['#########', '#0.....1#', '#.#.#.#.#', '#..C...2#', '#########']);
    const rider = s.players[2];
    rider.alive = false;
    rider.duckPos = nearestDuckPos(s.w, s.h, tileCenter(3), tileCenter(0)); // above column 3
    putBalloon(s, 3, 1, 0, { fuse: 1, range: 1 }); // wets (3,1) and (3,2); (3,3) is a castle
    expect(ofType(runTicks(s, 1), 'balloon_burst')).toHaveLength(1);
    const burstTick = s.tick;
    const press: (PlayerInput | null)[] = [null, null, inp(Dir.None, true)];
    const waiting = runUntil(s, () => s.tick === burstTick + CONFIG.SPLASH_TICKS - 1, press);
    expect(ofType(waiting, 'revenge_lob')).toEqual([]);
    expect(ofType(waiting, 'balloon_burst')).toEqual([]);
    expect(rider.duckCooldownUntil).toBe(0);

    const events = simulateTick(s, press); // first tick with (3,2) dry again
    expect(ofType(events, 'revenge_lob')).toMatchObject([{ slot: 2, toX: 3, toY: 2 }]);
    expect(ofType(events, 'balloon_burst')).toEqual([]);
    expect(s.balloons[0]).toMatchObject({ tx: 3, ty: 2, burstTick: s.tick + CONFIG.DUCK_FUSE_TICKS });
  });

  it('aims inward from the right edge and never lobs from a corner', () => {
    const right = step(Dir.None, true, 11 * SUB); // (8,3)
    expect(ofType(right.events, 'revenge_lob')[0]).toMatchObject({ fromX: 8, fromY: 3, toX: 5, toY: 3 });
    expect(step(Dir.None, true, 8 * SUB).events).toEqual([]);
  });

  it('respects the cooldown', () => {
    const { s, rider } = duckState(3 * SUB);
    const events: GameEvent[] = [];
    stepDuck(s, rider, inp(Dir.None, true), events);
    stepDuck(s, rider, inp(Dir.Right, true), events);
    expect(ofType(events, 'revenge_lob')).toHaveLength(1);
    s.tick = rider.duckCooldownUntil;
    stepDuck(s, rider, inp(Dir.None, true), events);
    expect(ofType(events, 'revenge_lob')).toHaveLength(2);
  });
});

describe('revenge soaks', () => {
  it('are credited separately and never count as soaks', () => {
    const { s, rider } = duckState(3 * SUB);
    const inputs: (PlayerInput | null)[] = [null, null, inp(Dir.None, true)];
    const lobTick = simulateTick(s, inputs);
    expect(ofType(lobTick, 'revenge_lob')).toHaveLength(1);
    expect(s.balloons[0].passMask).toBe(0b001); // player 0 stands on the landing tile
    const events = runTicks(s, CONFIG.DUCK_FUSE_TICKS);
    const soak = ofType(events, 'player_soaked');
    expect(soak).toEqual([{ type: 'player_soaked', slot: 0, by: 2, cause: 'revenge', x: 3, y: 3 }]);
    expect(ofType(events, 'balloon_burst')[0].fromDuck).toBe(true);
    expect(rider.stats).toMatchObject({ revengeSoaks: 1, soaks: 0 });
    expect(ofType(events, 'round_over')).toEqual([{ type: 'round_over', winner: 1, draw: false }]);
  });
});
