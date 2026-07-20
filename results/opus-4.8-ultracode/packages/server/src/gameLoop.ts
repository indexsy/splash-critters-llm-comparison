/**
 * Central fixed-step game loop. One timer advances every active match at 30Hz
 * with a small catch-up accumulator, and runs the matchmaker / GC / ping at
 * their own slower cadences.
 */

import { CONFIG } from '@splash/shared';
import type { ServerContext } from './context';

export interface LoopHandle {
  stop(): void;
}

export function startGameLoop(ctx: ServerContext): LoopHandle {
  const stepMs = 1000 / CONFIG.TICK_RATE;
  let last = Date.now();
  let acc = 0;

  const tickTimer = setInterval(() => {
    const now = Date.now();
    acc += now - last;
    last = now;
    let steps = 0;
    while (acc >= stepMs && steps < 5) {
      acc -= stepMs;
      ctx.tick++;
      ctx.rooms.tickAll(ctx.tick, now);
      steps++;
    }
    if (steps === 5) acc = 0; // fell behind; drop the backlog
  }, stepMs);

  const mmTimer = setInterval(() => ctx.mm.tick(Date.now()), CONFIG.MM_TICK_MS);
  const gcTimer = setInterval(() => ctx.rooms.gc(Date.now()), 30_000);
  const pingTimer = setInterval(() => {
    const now = Date.now();
    for (const c of ctx.clients) {
      c.send({ type: 'ping', t: now });
      if (now - c.lastPongMs > 30_000) c.ws.terminate();
    }
  }, CONFIG.PING_INTERVAL_MS);

  return {
    stop() {
      clearInterval(tickTimer);
      clearInterval(mmTimer);
      clearInterval(gcTimer);
      clearInterval(pingTimer);
    },
  };
}
