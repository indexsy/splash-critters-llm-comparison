import { CONFIG, searchRange, type Mode, type ServerMsg } from '@splash/shared';
import type { Rooms } from './rooms.js';

interface Queued {
  playerId: string;
  mode: Mode;
  rating: number;
  joinedAt: number;
}

export class Matchmaker {
  private queues = new Map<string, Queued>();

  constructor(
    private rooms: Rooms,
    private send: (playerId: string, msg: ServerMsg) => void,
  ) {}

  join(playerId: string, mode: Mode, rating: number): void {
    this.queues.set(playerId, { playerId, mode, rating, joinedAt: Date.now() });
    this.pushStatus(playerId);
  }

  leave(playerId: string): void {
    this.queues.delete(playerId);
  }

  has(playerId: string): boolean {
    return this.queues.has(playerId);
  }

  tick(): void {
    const now = Date.now();
    for (const mode of ['duel', 'ffa'] as const) {
      const entries = [...this.queues.values()].filter((q) => q.mode === mode).sort((a, b) => a.joinedAt - b.joinedAt);
      if (mode === 'duel') this.pairDuel(entries, now);
      else this.pairFfa(entries, now);
    }
    for (const q of this.queues.values()) this.pushStatus(q.playerId);
  }

  private pairDuel(entries: Queued[], now: number): void {
    const used = new Set<string>();
    for (const a of entries) {
      if (used.has(a.playerId)) continue;
      const range = searchRange(now - a.joinedAt);
      const b = entries.find(
        (o) =>
          o.playerId !== a.playerId &&
          !used.has(o.playerId) &&
          Math.abs(o.rating - a.rating) <= Math.max(range, searchRange(now - o.joinedAt)),
      );
      if (!b) continue;
      used.add(a.playerId);
      used.add(b.playerId);
      this.queues.delete(a.playerId);
      this.queues.delete(b.playerId);
      this.rooms.createSpecial({
        hostId: a.playerId,
        mode: 'duel',
        kind: 'ranked',
        ranked: true,
        hidden: true,
        name: 'Ranked Duel',
        theme: 'backyard',
        roundsToWin: 3,
        players: [
          { id: a.playerId, bot: false },
          { id: b.playerId, bot: false },
        ],
      });
      this.send(a.playerId, { t: 'match_found', mode: 'duel', ranked: true });
      this.send(b.playerId, { t: 'match_found', mode: 'duel', ranked: true });
    }
  }

  private pairFfa(entries: Queued[], now: number): void {
    if (entries.length < 4) return;
    const anchor = entries[0]!;
    const range = searchRange(now - anchor.joinedAt);
    const group = entries.filter((e) => Math.abs(e.rating - anchor.rating) <= range).slice(0, 4);
    if (group.length < 4) return;
    for (const g of group) this.queues.delete(g.playerId);
    this.rooms.createSpecial({
      hostId: anchor.playerId,
      mode: 'ffa',
      kind: 'ranked',
      ranked: true,
      hidden: true,
      name: 'Ranked Free-for-All',
      theme: 'beach',
      roundsToWin: 3,
      players: group.map((g) => ({ id: g.playerId, bot: false })),
    });
    for (const g of group) this.send(g.playerId, { t: 'match_found', mode: 'ffa', ranked: true });
  }

  private pushStatus(playerId: string): void {
    const q = this.queues.get(playerId);
    if (!q) return;
    const elapsed = Date.now() - q.joinedAt;
    const others = [...this.queues.values()].filter((o) => o.mode === q.mode && o.playerId !== playerId).length;
    const need = q.mode === 'duel' ? 1 : 3;
    const eta = others >= need ? 5 : 30 + Math.max(0, need - others) * 15;
    this.send(playerId, {
      t: 'queue_status',
      eta,
      searchRange: searchRange(elapsed),
      elapsed: Math.floor(elapsed / 1000),
      mode: q.mode,
    });
  }
}
