// Net-stats collector: input->ack delay from the sent-input log, reconciliation corrections in
// pixels, snapshot interval jitter, the per-frame trace of drawn positions and key edges, and
// the opt-in gate (?netstats=1). DOM-free: ui and net are mocked, window is an EventTarget.
import { CONFIG, Dir } from '@splash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorView } from '../src/game/scene';

vi.mock('../src/ui', () => ({ h: vi.fn(), layer: vi.fn() }));
vi.mock('../src/net', () => ({ net: { lagMs: 150, rtt: 312 } }));

type Module = typeof import('../src/game/netStats');

async function load(search: string): Promise<{ mod: Module; win: EventTarget }> {
  vi.resetModules();
  const win = Object.assign(new EventTarget(), { location: { search } });
  vi.stubGlobal('window', win);
  return { mod: await import('../src/game/netStats'), win };
}

function actor(slot: number, local: boolean, tx: number, ty: number): ActorView {
  const c = (t: number) => t * CONFIG.SUB + CONFIG.SUB / 2;
  return { slot, local, x: c(tx), y: c(ty), facing: Dir.Down, moving: false, alive: true, duck: null, duckCooldown: 0 };
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe('NetStats', () => {
  it('stays off (and collects nothing) without ?netstats=1', async () => {
    const { mod } = await load('');
    const stats = new mod.NetStats();
    stats.inputSent(1, 0);
    stats.snapshot(1, 300, 0, false, 0, { depth: 2, leadMs: 100 });
    expect(stats.enabled).toBe(false);
    expect(stats.report().ackDelayMs.last).toBe(0);
  });

  it('measures ack delay, corrections in pixels, pending inputs and snapshot jitter', async () => {
    const { mod } = await load('?lag=150&netstats=1');
    const stats = new mod.NetStats();
    stats.inputSent(10, 1000);
    stats.inputSent(11, 1033);
    stats.snapshot(10, 1330, 0, false, 1, { depth: 2, leadMs: 95 });
    stats.snapshot(11, 1400, CONFIG.SUB / 8, false, 0, { depth: 3, leadMs: 110 });
    stats.snapshot(11, 1463, CONFIG.SUB * 2, true, 0, { depth: 2, leadMs: 100 });
    const r = stats.report();
    expect(r.ackDelayMs.last).toBe(367);
    expect(r.ackDelayMs.max).toBe(367);
    expect(r.correctionPx.max).toBe(32);
    expect(r.correctionPx.samples).toBe(3);
    expect(r.correctionPx.snaps).toBe(1);
    expect(r.pendingInputs).toBe(0);
    expect(r.interp).toEqual({ depth: 2, leadMs: 100 });
    expect(r.snapshotIntervalMs.mean).toBeCloseTo(66.5, 1);
    expect(r.snapshotIntervalMs.jitter).toBeCloseTo(3.5, 1);
    expect(r.lagMs).toBe(150);
    expect(r.rttMs).toBe(312);
  });

  it('traces where each critter was drawn and the key edges, exposed on window', async () => {
    const { mod, win } = await load('?netstats=1');
    const stats = new mod.NetStats();
    stats.frame(16, [actor(0, true, 1, 1), actor(1, false, 3, 2)], 900);
    const key = (type: string, repeat: boolean, timeStamp: number) => {
      const e = Object.assign(new Event(type), { code: 'ArrowUp', repeat });
      Object.defineProperty(e, 'timeStamp', { value: timeStamp });
      win.dispatchEvent(e);
    };
    key('keydown', false, 20);
    key('keydown', true, 25);
    key('keyup', false, 30);
    const handle = (win as unknown as { splashNetStats: { frames(): unknown[]; keys(): unknown[] } }).splashNetStats;
    expect(handle.frames()).toEqual([{ t: 16, local: { slot: 0, x: 24, y: 24 }, remote: [{ slot: 1, x: 56, y: 40 }], remoteTime: 900 }]);
    expect(handle.keys()).toEqual([
      { t: 20, code: 'ArrowUp', type: 'down' },
      { t: 30, code: 'ArrowUp', type: 'up' },
    ]);
  });
});
