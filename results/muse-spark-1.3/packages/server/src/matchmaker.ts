import { CONFIG } from '@splash/shared';
import type { GameMode } from '@splash/shared';
import { getRatings } from './db/db.js';

interface QueueEntry {
  playerId: string;
  nickname: string;
  animal: string;
  hat: string;
  rating: number;
  joinedAt: number;
}

export class Matchmaker {
  queues: Record<GameMode, QueueEntry[]> = { duel: [], ffa: [] };
  onMatch: (mode: GameMode, players: QueueEntry[]) => void = () => {};

  join(mode: GameMode, e: QueueEntry): void {
    this.leave(e.playerId);
    this.queues[mode].push(e);
  }

  leave(playerId: string): void {
    for (const m of ['duel', 'ffa'] as GameMode[]) {
      this.queues[m] = this.queues[m].filter((x) => x.playerId !== playerId);
    }
  }

  status(playerId: string): { mode: GameMode; elapsedS: number; searchRange: number } | null {
    for (const m of ['duel', 'ffa'] as GameMode[]) {
      const e = this.queues[m].find((x) => x.playerId === playerId);
      if (e) {
        const elapsedS = (Date.now() - e.joinedAt) / 1000;
        const searchRange = Math.min(CONFIG.MM_MAX_RANGE, CONFIG.MM_BASE_RANGE + Math.floor(elapsedS / 10) * CONFIG.MM_WIDEN_PER_10S);
        return { mode: m, elapsedS, searchRange };
      }
    }
    return null;
  }

  tick(): void {
    for (const mode of ['duel', 'ffa'] as GameMode[]) {
      const need = mode === 'duel' ? 2 : 4;
      const q = this.queues[mode];
      if (q.length < need) continue;
      // refresh ratings
      for (const e of q) {
        try {
          e.rating = getRatings(e.playerId)[mode].rating;
        } catch { /* keep */ }
      }
      q.sort((a, b) => a.rating - b.rating);
      // greedy: for each player, find need-1 others within range
      const used = new Set<string>();
      const groups: QueueEntry[][] = [];
      for (const e of q) {
        if (used.has(e.playerId)) continue;
        const elapsedS = (Date.now() - e.joinedAt) / 1000;
        const range = Math.min(CONFIG.MM_MAX_RANGE, CONFIG.MM_BASE_RANGE + Math.floor(elapsedS / 10) * CONFIG.MM_WIDEN_PER_10S);
        const mates = q.filter((o) => !used.has(o.playerId) && o.playerId !== e.playerId && Math.abs(o.rating - e.rating) <= range);
        if (mates.length >= need - 1) {
          const group = [e, ...mates.slice(0, need - 1)];
          group.forEach((g) => used.add(g.playerId));
          groups.push(group);
        }
      }
      for (const g of groups) {
        this.queues[mode] = this.queues[mode].filter((x) => !used.has(x.playerId));
        // remove matched from other queue too (already via used? ensure)
        this.onMatch(mode, g);
      }
    }
  }
}
