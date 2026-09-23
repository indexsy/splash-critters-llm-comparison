import { describe, expect, it, vi } from 'vitest';
import { Ticker } from '../src/ticker';

function fakeTicker(maxCatchUp = 4) {
  let clock = 0;
  const fired: number[] = [];
  const ticker = new Ticker({ periodMs: 10, maxCatchUp, clock: () => clock, onTick: (t) => fired.push(t) });
  return {
    ticker,
    fired,
    set(t: number) {
      clock = t;
    },
  };
}

describe('Ticker', () => {
  it('fires on an absolute grid with logical tick times, never accumulating jitter', () => {
    const { ticker, fired, set } = fakeTicker();
    set(0);
    ticker.start();
    ticker.stop();
    for (const t of [10.4, 21.9, 30.2, 40.0]) ticker.runDue(t);
    expect(fired).toEqual([10, 20, 30, 40]);
  });

  it('catches up a few ticks after a short stall and drops the backlog after a long one', () => {
    const { ticker, fired, set } = fakeTicker(3);
    set(0);
    ticker.start();
    ticker.stop();
    expect(ticker.runDue(35)).toBe(3);
    expect(fired).toEqual([10, 20, 30]);
    fired.length = 0;
    expect(ticker.runDue(1000)).toBe(3);
    expect(ticker.stats.dropped).toBeGreaterThan(90);
    fired.length = 0;
    ticker.runDue(1005);
    expect(fired).toEqual([]);
    ticker.runDue(1010);
    expect(fired).toHaveLength(1);
  });

  it('keeps ticking when a tick throws', () => {
    const errors: unknown[] = [];
    let clock = 0;
    const ticker = new Ticker({
      periodMs: 10,
      clock: () => clock,
      onTick: () => {
        throw new Error('boom');
      },
      onError: (err) => errors.push(err),
    });
    ticker.start();
    ticker.stop();
    clock = 30;
    expect(ticker.runDue(30)).toBe(3);
    expect(errors).toHaveLength(3);
  });

  it('drives itself with timers once started', async () => {
    vi.useFakeTimers();
    try {
      let clock = 0;
      const fired: number[] = [];
      const ticker = new Ticker({ periodMs: 10, clock: () => clock, onTick: (t) => fired.push(t) });
      ticker.start();
      for (let i = 0; i < 5; i++) {
        clock += 10;
        await vi.advanceTimersByTimeAsync(10);
      }
      ticker.stop();
      expect(fired).toEqual([10, 20, 30, 40, 50]);
      expect(ticker.running).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
