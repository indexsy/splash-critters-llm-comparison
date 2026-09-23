// The 30 Hz input clock's responsiveness helpers: pulling the next step forward on a key press
// (without changing the long-run step count the server expects), the step phase used to draw
// the local critter between ticks, and stepLead, the side-effect-free lookahead it draws with.
import { CONFIG, Dir, Tile, cloneState, createRoundState, makeRules, speedUnitsPerTick, stateHash, type GeneratedMap } from '@splash/shared';
import { describe, expect, it } from 'vitest';
import { FixedStep } from '../src/game/clock';
import { stepLead } from '../src/prediction';

const STEP = CONFIG.TICK_MS;

function openRound() {
  const w = 9;
  const h = 7;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      tiles[y * w + x] = border || (x % 2 === 0 && y % 2 === 0) ? Tile.Boulder : Tile.Floor;
    }
  }
  const map: GeneratedMap = { w, h, tiles, hidden: new Uint8Array(w * h), spawns: [{ slot: 0, tx: 1, ty: 1 }, { slot: 1, tx: 7, ty: 5 }] };
  return createRoundState(map, [true, true], makeRules({ ranked: false }));
}

describe('FixedStep.pullForward', () => {
  it('runs a step now and skips the one it replaces, keeping the step count', () => {
    const plain = new FixedStep(STEP, 4);
    const pulled = new FixedStep(STEP, 4);
    let a = 0;
    let b = 0;
    for (let frame = 0; frame < 120; frame++) {
      a += plain.advance(1000 / 120);
      b += pulled.advance(1000 / 120);
      if (frame === 7 || frame === 50) b += pulled.pullForward() ? 1 : 0;
    }
    expect(b).toBe(a);
  });

  it('pulls at most one step ahead of the schedule', () => {
    const step = new FixedStep(STEP, 4);
    step.advance(5);
    expect(step.pullForward()).toBe(true);
    expect(step.pullForward()).toBe(false);
    // The pull replaced the step due at acc = STEP; the following one is due one step later.
    expect(step.advance(STEP - 6)).toBe(0);
    expect(step.advance(STEP)).toBe(0);
    expect(step.advance(2)).toBe(1);
    expect(step.pullForward()).toBe(true);
  });

  it('ramps the phase from 0 to 1 across every step interval, also right after a pull', () => {
    const step = new FixedStep(STEP, 4);
    step.advance(STEP / 2);
    expect(step.phase()).toBeCloseTo(0.5);
    step.pullForward();
    expect(step.phase()).toBe(0);
    step.advance(STEP);
    const mid = step.phase();
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(step.advance(STEP / 2 + 1)).toBe(1);
    expect(step.phase()).toBeLessThan(0.1);
    step.reset();
    expect(step.phase()).toBe(0);
  });
});

describe('stepLead', () => {
  it('points a fraction of the way toward the next tick and leaves the world untouched', () => {
    const s = openRound();
    const before = stateHash(cloneState(s));
    const half = stepLead(s, 0, Dir.Right, 0.5);
    const full = stepLead(s, 0, Dir.Right, 1);
    expect(full.dx).toBe(speedUnitsPerTick(0));
    expect(half.dx).toBe(full.dx / 2);
    expect(full.dy).toBe(0);
    expect(full.moving).toBe(true);
    expect(stateHash(s)).toBe(before);
  });

  it('is zero into a wall, without a direction, for soaked critters and after the round', () => {
    const s = openRound();
    expect(stepLead(s, 0, Dir.Up, 1)).toEqual({ dx: 0, dy: 0, moving: false });
    expect(stepLead(s, 0, Dir.None, 1).moving).toBe(false);
    s.players[0].alive = false;
    expect(stepLead(s, 0, Dir.Right, 1).moving).toBe(false);
    s.players[0].alive = true;
    s.over = true;
    expect(stepLead(s, 0, Dir.Right, 1).moving).toBe(false);
  });
});
