import { CONFIG } from '@splash-critters/shared';
import type { Room } from './rooms.js';

/**
 * Drives every room at a fixed 30 Hz. Snapshots are sent at 15 Hz, the
 * simulation always runs at the same rate no matter how many rooms exist.
 */
export class GameLoop {
  private rooms = new Set<Room>();
  private timer: NodeJS.Timeout | null = null;
  private lastTick = 0;
  private tickCount = 0;

  start(): void {
    if (this.timer) return;
    this.lastTick = Date.now();
    const interval = Math.round(1000 / CONFIG.TICK_RATE);
    this.timer = setInterval(() => this.step(), interval);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  add(room: Room): void {
    this.rooms.add(room);
  }

  remove(room: Room): void {
    this.rooms.delete(room);
  }

  get size(): number {
    return this.rooms.size;
  }

  private step(): void {
    const now = Date.now();
    const elapsed = now - this.lastTick;
    this.lastTick = now;
    // Never try to catch up more than a few ticks, that would only add latency.
    const steps = Math.max(1, Math.min(3, Math.round(elapsed / (1000 / CONFIG.TICK_RATE))));
    for (let i = 0; i < steps; i++) {
      this.tickAll(now);
    }
  }

  private tickAll(now: number): void {
    this.tickCount += 1;
    const sendSnapshot = this.tickCount % 2 === 0;
    for (const room of [...this.rooms]) {
      try {
        room.tick(now);
        if (sendSnapshot && room.phase === 'playing') {
          room.broadcastSnapshot(room.buildSnapshot());
        }
      } catch (err) {
        console.error('[gameLoop] room failed', room.code, err);
      }
    }
    this.collectGarbage(now);
  }

  private collectGarbage(now: number): void {
    for (const room of [...this.rooms]) {
      const idleFor = now - room.lastActivity;
      const hasHumans = room.slots.some((s) => s.kind === 'human');
      if (idleFor > CONFIG.ROOM_IDLE_TTL_MS && !hasHumans) {
        this.rooms.delete(room);
      }
    }
  }
}
