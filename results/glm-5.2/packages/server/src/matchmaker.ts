// matchmaker.ts — ranked queues for Duel & FFA (spec §3).
// Ticks every 2s; matches within ±100 widening +50/10s cap ±400.
// Humans only — never bots. Reports live queue_status {eta, searchRange}.

import { MM, type GameMode } from "@splash/shared";

export interface QueuedPlayer {
  playerId: string;
  connectionId: string;
  mode: GameMode;
  rating: number;
  joinedAt: number;
  lastNotifyAt: number;
}

export class Matchmaker {
  queues: Record<GameMode, QueuedPlayer[]> = { duel: [], ffa: [] };
  timer: ReturnType<typeof setInterval> | null = null;
  /** Called when a match is formed. Implementations create a ranked Room. */
  onMatch?: (mode: GameMode, players: QueuedPlayer[]) => void;
  /** Called to push a message to a player's connection. */
  send?: (connectionId: string, msg: unknown) => void;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), MM.tickMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  join(q: QueuedPlayer) {
    this.queues[q.mode].push(q);
    this.notify(q);
  }
  leave(playerId: string) {
    this.queues.duel = this.queues.duel.filter((q) => q.playerId !== playerId);
    this.queues.ffa = this.queues.ffa.filter((q) => q.playerId !== playerId);
  }

  private searchRange(q: QueuedPlayer): number {
    const waited = Date.now() - q.joinedAt;
    const widenSteps = Math.floor(waited / MM.widenEveryMs);
    return Math.min(MM.capRange, MM.initialRange + widenSteps * MM.widenBy);
  }

  private eta(q: QueuedPlayer): number {
    // crude ETA: 2s per widen step until we'd hit cap
    const r = this.searchRange(q);
    if (r >= MM.capRange) return 0;
    const stepsToCap = Math.ceil((MM.capRange - r) / MM.widenBy);
    return stepsToCap * (MM.widenEveryMs / 1000);
  }

  private notify(q: QueuedPlayer) {
    if (Date.now() - q.lastNotifyAt < 1000) return;
    q.lastNotifyAt = Date.now();
    this.send?.(q.connectionId, {
      t: "queue_status",
      eta: Math.round(this.eta(q)),
      searchRange: this.searchRange(q),
    });
  }

  private tick() {
    for (const mode of ["duel", "ffa"] as GameMode[]) {
      const queue = this.queues[mode];
      const need = mode === "duel" ? 2 : 4;
      // try to form a match: pick players whose search ranges overlap
      for (let i = 0; i < queue.length; i++) {
        const a = queue[i];
        const group = [a];
        for (let j = 0; j < queue.length; j++) {
          if (i === j) continue;
          const b = queue[j];
          if (group.length >= need) break;
          const rangeA = this.searchRange(a);
          const rangeB = this.searchRange(b);
          if (Math.abs(a.rating - b.rating) <= Math.max(rangeA, rangeB)) {
            if (!group.includes(b)) group.push(b);
          }
        }
        if (group.length >= need) {
          const chosen = group.slice(0, need);
          for (const c of chosen) this.queues[mode] = this.queues[mode].filter((x) => x.playerId !== c.playerId);
          this.onMatch?.(mode, chosen);
          return; // restart scan next tick
        }
      }
      // notify waiters
      for (const q of queue) this.notify(q);
    }
  }
}
