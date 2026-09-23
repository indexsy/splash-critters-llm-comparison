// Remote interpolation: bracket selection, clamping, starvation hold, teleports, duck wrap,
// and the render clock that measures snapshot lateness.
import { CONFIG, Dir, borderLoopLength, duckXY, type PlayerSnap } from '@splash/shared';
import { describe, expect, it } from 'vitest';
import { InterpClock, SnapshotBuffer, blendPlayer, interpolatePlayers, type TimedSnapshot } from '../src/game/interpolation';

function player(slot: number, x: number, y: number, extra: Partial<PlayerSnap> = {}): PlayerSnap {
  return {
    slot,
    x,
    y,
    facing: Dir.Right,
    moving: true,
    alive: true,
    speedUps: 0,
    maxBalloons: 1,
    range: 2,
    canKick: false,
    soakedTick: -1,
    duckPos: -1,
    duckCooldownUntil: 0,
    activeBalloons: 0,
    ...extra,
  };
}

function snap(serverTime: number, tick: number, x: number): TimedSnapshot {
  return { serverTime, tick, players: [player(1, x, 1500)] };
}

describe('SnapshotBuffer.bracket', () => {
  const buf = new SnapshotBuffer();
  buf.push(snap(1000, 30, 1500));
  buf.push(snap(1066, 32, 2300));
  buf.push(snap(1133, 34, 3100));

  it('picks the two snapshots around the render time', () => {
    const b = buf.bracket(1100)!;
    expect(b.from.tick).toBe(32);
    expect(b.to.tick).toBe(34);
    expect(b.alpha).toBeCloseTo((1100 - 1066) / (1133 - 1066));
  });

  it('uses the exact snapshot on a boundary', () => {
    const b = buf.bracket(1066)!;
    expect(b.from.tick).toBe(32);
    expect(b.alpha).toBe(0);
  });

  it('clamps before the oldest snapshot', () => {
    const b = buf.bracket(500)!;
    expect(b.from.tick).toBe(30);
    expect(b.to.tick).toBe(30);
    expect(b.alpha).toBe(0);
  });

  it('holds the newest snapshot when starved (never extrapolates)', () => {
    const b = buf.bracket(5000)!;
    expect(b.from.tick).toBe(34);
    expect(b.to.tick).toBe(34);
    const p = interpolatePlayers(b, 13, 11).get(1)!;
    expect(p.x).toBe(3100);
  });

  it('returns null when empty', () => {
    expect(new SnapshotBuffer().bracket(0)).toBeNull();
  });
});

describe('SnapshotBuffer.push', () => {
  it('orders late snapshots by server time and replaces duplicates', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(1000, 30, 0));
    buf.push(snap(1133, 34, 0));
    buf.push(snap(1066, 32, 0));
    buf.push(snap(1133, 34, 99));
    expect(buf.size).toBe(3);
    const b = buf.bracket(1100)!;
    expect([b.from.tick, b.to.tick]).toEqual([32, 34]);
    expect(b.to.players[0].x).toBe(99);
  });

  it('trims history older than a second but always keeps two snapshots', () => {
    const buf = new SnapshotBuffer();
    for (let i = 0; i < 40; i++) buf.push(snap(i * 66, i * 2, 0));
    expect(buf.size).toBeLessThanOrEqual(18);
    const lonely = new SnapshotBuffer();
    lonely.push(snap(0, 0, 0));
    lonely.push(snap(10_000, 300, 0));
    expect(lonely.size).toBe(2);
  });
});

describe('blendPlayer', () => {
  it('lerps position between snapshots', () => {
    const p = blendPlayer(player(1, 1500, 1500), player(1, 2500, 1500), 0.25, 13, 11);
    expect(p.x).toBe(1750);
    expect(p.y).toBe(1500);
  });

  it('snaps instead of sliding across a teleport (respawn, new round)', () => {
    const far = CONFIG.SUB * 5;
    expect(blendPlayer(player(1, 1500, 1500), player(1, 1500 + far, 1500), 0.3, 13, 11).x).toBe(1500);
    expect(blendPlayer(player(1, 1500, 1500), player(1, 1500 + far, 1500), 0.7, 13, 11).x).toBe(1500 + far);
  });

  it('holds when the next snapshot lacks the player', () => {
    expect(blendPlayer(player(1, 4200, 1500), undefined, 0.8, 13, 11).x).toBe(4200);
  });

  it('blends a revenge duck the short way around the border loop', () => {
    const w = 13;
    const h = 11;
    const len = borderLoopLength(w, h);
    const a = player(1, 0, 0, { alive: false, duckPos: len - 1500 });
    const b = player(1, 0, 0, { alive: false, duckPos: 1500 });
    const mid = blendPlayer(a, b, 0.5, w, h);
    expect(mid.duck).toEqual(duckXY(w, h, 0));
    expect(mid.alive).toBe(false);
  });
});

describe('InterpClock', () => {
  it('renders INTERP_DELAY_MS behind the newest observed server time', () => {
    const clock = new InterpClock();
    clock.observe(1000, 1150); // snapshots arrive 150 ms after they were stamped
    expect(clock.renderTime(1150)).toBe(1000 - CONFIG.INTERP_DELAY_MS);
    expect(clock.renderTime(1200)).toBe(1050 - CONFIG.INTERP_DELAY_MS);
  });

  it('rises quickly on a late burst and relaxes slowly', () => {
    const clock = new InterpClock();
    clock.observe(0, 20);
    clock.observe(100, 220);
    const afterSpike = 220 - clock.renderTime(220) - CONFIG.INTERP_DELAY_MS;
    expect(afterSpike).toBeGreaterThan(60);
    clock.observe(200, 220);
    const relaxed = 220 - clock.renderTime(220) - CONFIG.INTERP_DELAY_MS;
    expect(relaxed).toBeLessThan(afterSpike);
    expect(relaxed).toBeGreaterThan(afterSpike * 0.9);
  });
});
