import { CONFIG } from '@splash-critters/shared';
import type { Mode } from '@splash-critters/shared';

export interface QueuedPlayer {
  playerId: string;
  rating: number;
  joinedAt: number;
  mode: Mode;
  notify: (status: { eta: number; searchRange: number; queued: number; elapsedMs: number }) => void;
  onMatched: (group: QueuedPlayer[], mode: Mode) => void;
}

/**
 * Ranked matchmaking. Two independent queues (duel and free-for-all) with
 * their own rating pools. The search window starts at +/- 100 rating and
 * widens by 50 every 10 seconds up to +/- 400.
 */
export class Matchmaker {
  private queues = new Map<Mode, QueuedPlayer[]>();
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.queues.set('duel', []);
    this.queues.set('ffa', []);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), CONFIG.MATCHMAKING.tickMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  enqueue(player: QueuedPlayer): void {
    const queue = this.queues.get(player.mode);
    if (!queue) return;
    if (queue.some((p) => p.playerId === player.playerId)) return;
    queue.push(player);
    this.sendStatus(player.mode);
  }

  dequeue(playerId: string): void {
    for (const queue of this.queues.values()) {
      const i = queue.findIndex((p) => p.playerId === playerId);
      if (i >= 0) {
        queue.splice(i, 1);
        return;
      }
    }
  }

  isQueued(playerId: string): boolean {
    for (const queue of this.queues.values()) {
      if (queue.some((p) => p.playerId === playerId)) return true;
    }
    return false;
  }

  queueSize(mode: Mode): number {
    return this.queues.get(mode)?.length ?? 0;
  }

  /** The rating window currently used for a queue. */
  searchRange(mode: Mode, now: number): number {
    const queue = this.queues.get(mode) ?? [];
    if (queue.length === 0) return CONFIG.MATCHMAKING.baseRange;
    const oldest = Math.min(...queue.map((p) => p.joinedAt));
    const waited = now - oldest;
    const steps = Math.floor(waited / CONFIG.MATCHMAKING.widenEveryMs);
    return Math.min(
      CONFIG.MATCHMAKING.maxRange,
      CONFIG.MATCHMAKING.baseRange + steps * CONFIG.MATCHMAKING.widenStep,
    );
  }

  private sendStatus(mode: Mode): void {
    const queue = this.queues.get(mode) ?? [];
    const now = Date.now();
    const range = this.searchRange(mode, now);
    for (const player of queue) {
      const elapsed = now - player.joinedAt;
      const eta = Math.max(0, Math.round((CONFIG.MATCHMAKING.widenEveryMs * 2 - elapsed) / 1000));
      player.notify({
        eta,
        searchRange: range,
        queued: queue.length,
        elapsedMs: elapsed,
      });
    }
  }

  tick(): void {
    const now = Date.now();
    for (const mode of ['duel', 'ffa'] as Mode[]) {
      this.tickMode(mode, now);
      this.sendStatus(mode);
    }
  }

  private tickMode(mode: Mode, now: number): void {
    const queue = this.queues.get(mode);
    if (!queue || queue.length === 0) return;
    const range = this.searchRange(mode, now);
    const needed = mode === 'duel' ? 2 : 2;

    // Take the oldest waiting player and look for an opponent in range.
    while (queue.length >= needed) {
      const anchor = queue[0];
      const candidates = queue
        .slice(1)
        .filter((p) => Math.abs(p.rating - anchor.rating) <= range)
        .sort((a, b) => Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating));
      if (candidates.length === 0) break;
      const opponent = candidates[0];
      const group = [anchor, opponent];

      // A free-for-all fills up with everybody that fits into the window.
      if (mode === 'ffa') {
        const extra = queue
          .filter(
            (p) =>
              !group.includes(p) &&
              Math.abs(p.rating - anchor.rating) <= range &&
              now - p.joinedAt > 8000,
          )
          .slice(0, 2);
        group.push(...extra);
      }

      for (const p of group) {
        const i = queue.indexOf(p);
        if (i >= 0) queue.splice(i, 1);
      }
      for (const p of group) p.onMatched(group, mode);
      if (queue.length < needed) break;
    }
  }
}
