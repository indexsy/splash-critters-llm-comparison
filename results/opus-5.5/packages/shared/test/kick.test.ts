import { describe, expect, it } from 'vitest';
import { tileCenter, tileOf } from '../src/grid';
import { playerTile } from '../src/movement';
import { simulateTick } from '../src/sim';
import { Dir } from '../src/types';
import { inp, ofType, placePlayer, putBalloon, runTicks, runUntil, stateFromAscii } from './fixtures';

describe('kick', () => {
  const MAP = ['#########', '#0.....C#', '#.#.#.#.#', '#......1#', '#########'];

  it('slides the balloon until the obstacle and keeps its fuse', () => {
    const s = stateFromAscii(MAP);
    s.players[0].canKick = true;
    const b = putBalloon(s, 2, 1, 1);
    const fuse = b.burstTick;
    const kickEvents = runTicks(s, 1, [inp(Dir.Right)]);
    expect(ofType(kickEvents, 'balloon_kicked')).toEqual([{ type: 'balloon_kicked', id: b.id, slot: 0, dir: Dir.Right }]);
    expect(b.passMask).toBe(0);
    const events = runTicks(s, 20);
    expect(ofType(events, 'balloon_stopped')).toEqual([{ type: 'balloon_stopped', id: b.id, x: 6, y: 1 }]);
    expect([b.tx, b.ty, b.x, b.slideDir]).toEqual([6, 1, tileCenter(6), Dir.None]);
    expect(b.burstTick).toBe(fuse);
    const burst = ofType(runTicks(s, fuse - s.tick), 'balloon_burst');
    expect(burst.map((e) => [e.id, e.x, e.y])).toEqual([[b.id, 6, 1]]);
  });

  it('stops in front of a player and does not kick into a blocked tile', () => {
    const s = stateFromAscii(MAP);
    s.players[0].canKick = true;
    placePlayer(s, 1, 5, 1);
    const b = putBalloon(s, 2, 1, 1);
    runTicks(s, 1, [inp(Dir.Right)]);
    runTicks(s, 20);
    expect([b.tx, b.ty]).toEqual([4, 1]);

    const s2 = stateFromAscii(['#########', '#0.C...C#', '#.#.#.#.#', '#......1#', '#########']);
    s2.players[0].canKick = true;
    const b2 = putBalloon(s2, 2, 1, 1);
    const events = runTicks(s2, 3, [inp(Dir.Right)]);
    expect(ofType(events, 'balloon_kicked')).toEqual([]);
    expect(b2.slideDir).toBe(Dir.None);
  });

  it('requires Boots and the kick rule', () => {
    const s = stateFromAscii(MAP);
    const b = putBalloon(s, 2, 1, 1);
    runTicks(s, 3, [inp(Dir.Right)]);
    expect(b.slideDir).toBe(Dir.None);
    expect(s.players[0].x).toBe(tileCenter(1));

    const s2 = stateFromAscii(MAP, { rules: { kick: false } });
    s2.players[0].canKick = true;
    const b2 = putBalloon(s2, 2, 1, 1);
    runTicks(s2, 3, [inp(Dir.Right)]);
    expect(b2.slideDir).toBe(Dir.None);
  });

  it('stops a sliding balloon at another balloon', () => {
    const s = stateFromAscii(MAP);
    s.players[0].canKick = true;
    const b = putBalloon(s, 2, 1, 1);
    putBalloon(s, 5, 1, 1);
    runTicks(s, 1, [inp(Dir.Right)]);
    runTicks(s, 12);
    expect([b.tx, b.ty, b.slideDir]).toEqual([4, 1, Dir.None]);
  });

  it('kicks from just past the tile center when a balloon appears ahead mid-stride', () => {
    const s = stateFromAscii(MAP);
    const p0 = s.players[0];
    p0.canKick = true;
    runTicks(s, 8, [inp(Dir.Right)]); // 8 steps of 400 from (1,1): 200 past the center of (2,1)
    expect(p0.x).toBe(tileCenter(2) + 200);
    const b = putBalloon(s, 3, 1, 1); // the opponent's balloon lands ahead; p0's box does not overlap it
    expect(b.passMask).toBe(0);
    const events = runTicks(s, 1, [inp(Dir.Right)]);
    expect(ofType(events, 'balloon_kicked')).toEqual([{ type: 'balloon_kicked', id: b.id, slot: 0, dir: Dir.Right }]);
    expect(p0.x).toBe(tileCenter(2) + 200); // the clamp never pushed the player back
    runTicks(s, 20);
    expect([b.tx, b.ty, b.slideDir]).toEqual([6, 1, Dir.None]);
  });
});

describe('kicked balloons vs players', () => {
  const CORRIDOR = ['###########', '#0........#', '#.#.#.#.#.#', '#........1#', '###########'];

  it('stops at its current center when a player steps into the next tile mid-slide', () => {
    const s = stateFromAscii(CORRIDOR);
    s.players[0].canKick = true;
    const b = putBalloon(s, 2, 1, 1, { fuse: 200 });
    const p1 = placePlayer(s, 1, 5, 2);
    p1.y = tileCenter(2) - 1200; // one Up step (400) puts its center tile in row 1
    runTicks(s, 1, [inp(Dir.Right)]);
    expect(b.slideDir).toBe(Dir.Right);
    // Past the (4,1) center check, heading into (5,1).
    const approach = runUntil(s, () => b.x > tileCenter(4));
    expect(ofType(approach, 'balloon_stopped')).toEqual([]);
    const events = runTicks(s, 1, [null, inp(Dir.Up)]);
    expect(playerTile(p1)).toEqual({ tx: 5, ty: 1 });
    expect(ofType(events, 'balloon_stopped')).toEqual([{ type: 'balloon_stopped', id: b.id, x: 4, y: 1 }]);
    expect([b.tx, b.ty, b.x, b.slideDir]).toEqual([4, 1, tileCenter(4), Dir.None]);
    runTicks(s, 20);
    expect([b.tx, b.ty]).toEqual([4, 1]);
  });

  it('never passes through a player walking head-on into it', () => {
    const failures: string[] = [];
    for (let x = tileCenter(5) - 1500; x < tileCenter(9) + 1500; x += 100) {
      const s = stateFromAscii(['############', '#0.........#', '#.#.#.#.#.##', '#.........1#', '############']);
      s.players[0].canKick = true;
      const b = putBalloon(s, 2, 1, 1, { fuse: 300 });
      const p1 = s.players[1];
      p1.x = x;
      p1.y = tileCenter(1);
      runTicks(s, 1, [inp(Dir.Right), inp(Dir.Left)]);
      if (b.slideDir !== Dir.Right) failures.push(`x=${x}: not kicked`);
      for (let t = 0; t < 40; t++) {
        simulateTick(s, [null, inp(Dir.Left)]);
        if (tileOf(p1.x) === b.tx) failures.push(`x=${x} tick ${s.tick}: balloon shares tile ${b.tx} with the player`);
      }
      if (b.slideDir !== Dir.None || b.x >= p1.x) failures.push(`x=${x}: balloon at ${b.x}, player at ${p1.x}`);
    }
    expect(failures).toEqual([]);
  });
});
