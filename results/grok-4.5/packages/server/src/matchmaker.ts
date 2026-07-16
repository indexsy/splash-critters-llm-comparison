import { CONFIG, type GameMode, type Profile } from '@splash/shared';

export type QueueEntry = {
  playerId: string;
  profile: Profile;
  mode: GameMode;
  rating: number;
  joinedAt: number;
};

export class Matchmaker {
  queues: Record<GameMode, QueueEntry[]> = { duel: [], ffa: [] };

  join(entry: QueueEntry): void {
    this.leave(entry.playerId);
    this.queues[entry.mode].push(entry);
  }

  leave(playerId: string): void {
    for (const mode of ['duel', 'ffa'] as GameMode[]) {
      this.queues[mode] = this.queues[mode].filter((e) => e.playerId !== playerId);
    }
  }

  inQueue(playerId: string): QueueEntry | undefined {
    for (const mode of ['duel', 'ffa'] as GameMode[]) {
      const e = this.queues[mode].find((x) => x.playerId === playerId);
      if (e) return e;
    }
    return undefined;
  }

  status(playerId: string): { mode: GameMode; elapsed: number; searchRange: number; eta: number } | null {
    const e = this.inQueue(playerId);
    if (!e) return null;
    const elapsed = Date.now() - e.joinedAt;
    const widenSteps = Math.floor(elapsed / CONFIG.MM_WIDEN_EVERY_MS);
    const searchRange = Math.min(CONFIG.MM_MAX_RANGE, CONFIG.MM_BASE_RANGE + widenSteps * CONFIG.MM_WIDEN_AMOUNT);
    const need = e.mode === 'duel' ? 2 : 4;
    const waiting = this.queues[e.mode].length;
    const eta = waiting >= need ? 2 : Math.max(5, 30 - waiting * 8);
    return { mode: e.mode, elapsed: Math.floor(elapsed / 1000), searchRange, eta };
  }

  /** Returns matched groups of playerIds */
  tick(): Array<{ mode: GameMode; entries: QueueEntry[] }> {
    const matches: Array<{ mode: GameMode; entries: QueueEntry[] }> = [];

    for (const mode of ['duel', 'ffa'] as GameMode[]) {
      const need = mode === 'duel' ? 2 : 4;
      const q = this.queues[mode];
      if (q.length < need) continue;

      // Sort by wait time (longest first)
      const sorted = [...q].sort((a, b) => a.joinedAt - b.joinedAt);
      const used = new Set<string>();

      for (const seed of sorted) {
        if (used.has(seed.playerId)) continue;
        const elapsed = Date.now() - seed.joinedAt;
        const widenSteps = Math.floor(elapsed / CONFIG.MM_WIDEN_EVERY_MS);
        const range = Math.min(CONFIG.MM_MAX_RANGE, CONFIG.MM_BASE_RANGE + widenSteps * CONFIG.MM_WIDEN_AMOUNT);

        const group = [seed];
        used.add(seed.playerId);

        for (const cand of sorted) {
          if (used.has(cand.playerId)) continue;
          if (Math.abs(cand.rating - seed.rating) <= range) {
            group.push(cand);
            used.add(cand.playerId);
            if (group.length >= need) break;
          }
        }

        if (group.length >= need) {
          const take = group.slice(0, need);
          matches.push({ mode, entries: take });
          // Remove from queue
          const ids = new Set(take.map((t) => t.playerId));
          this.queues[mode] = this.queues[mode].filter((e) => !ids.has(e.playerId));
        } else {
          // Release used for incomplete
          for (const g of group) used.delete(g.playerId);
        }
      }
    }
    return matches;
  }
}
