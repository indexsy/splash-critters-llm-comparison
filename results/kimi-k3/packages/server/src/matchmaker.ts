import { CONFIG, GameMode } from '@splash/shared';
import * as db from './db/index.js';
import { ClientConn, RoomManager } from './rooms.js';

interface QueueEntry {
  client: ClientConn;
  mode: GameMode;
  rating: number;
  joinedAt: number;
}

function searchRange(entry: QueueEntry, now: number): number {
  const steps = Math.floor((now - entry.joinedAt) / CONFIG.MATCHMAKING.WIDEN_EVERY_MS);
  return Math.min(CONFIG.MATCHMAKING.MAX_RANGE, CONFIG.MATCHMAKING.BASE_RANGE + steps * CONFIG.MATCHMAKING.WIDEN_STEP);
}

export class Matchmaker {
  private queues: QueueEntry[] = [];
  private rooms: RoomManager;

  constructor(rooms: RoomManager) {
    this.rooms = rooms;
  }

  join(client: ClientConn, mode: GameMode): { ok: boolean; error?: string } {
    const player = db.getPlayer(client.playerId);
    if (!player) return { ok: false, error: 'Not authenticated' };
    if (player.custom_nickname !== 1) return { ok: false, error: 'Set a nickname before ranked queue' };
    if (this.queues.some((q) => q.client.playerId === client.playerId)) return { ok: false, error: 'Already in queue' };
    if (this.rooms.findRoomForPlayer(client.playerId)) return { ok: false, error: 'Leave your room first' };
    const rating = db.getRating(client.playerId, mode).rating;
    this.queues.push({ client, mode, rating, joinedAt: Date.now() });
    return { ok: true };
  }

  leave(client: ClientConn): void {
    this.queues = this.queues.filter((q) => q.client.playerId !== client.playerId);
  }

  inQueue(playerId: string): boolean {
    return this.queues.some((q) => q.client.playerId === playerId);
  }

  tick(): void {
    const now = Date.now();
    for (const mode of ['duel', 'ffa'] as GameMode[]) {
      const entries = this.queues.filter((q) => q.mode === mode).sort((a, b) => a.rating - b.rating);
      const matched = new Set<string>();

      if (mode === 'duel') {
        for (let i = 0; i + 1 < entries.length; i++) {
          const a = entries[i]!;
          const b = entries[i + 1]!;
          if (matched.has(a.client.playerId) || matched.has(b.client.playerId)) continue;
          const range = Math.min(searchRange(a, now), searchRange(b, now));
          if (Math.abs(a.rating - b.rating) <= range) {
            matched.add(a.client.playerId);
            matched.add(b.client.playerId);
            this.formMatch(mode, [a, b]);
          }
        }
      } else {
        for (let i = 0; i + 3 < entries.length; i++) {
          const window = entries.slice(i, i + 4);
          if (window.some((w) => matched.has(w.client.playerId))) continue;
          const minRating = window[0]!.rating;
          const maxRating = window[3]!.rating;
          const range = Math.min(...window.map((w) => searchRange(w, now)));
          if (maxRating - minRating <= range) {
            for (const w of window) matched.add(w.client.playerId);
            this.formMatch(mode, window);
          }
        }
      }

      for (const q of entries) {
        if (matched.has(q.client.playerId)) continue;
        const inQueue = entries.length;
        const need = mode === 'duel' ? 2 : 4;
        const eta = inQueue >= need ? 10 : (need - inQueue) * 15 + 10;
        q.client.send({
          t: 'queue_status',
          mode,
          eta,
          searchRange: searchRange(q, now),
          inQueue,
        });
      }
    }
  }

  private formMatch(mode: GameMode, entries: QueueEntry[]): void {
    this.queues = this.queues.filter((q) => !entries.includes(q));
    for (const e of entries) {
      e.client.send({ t: 'match_found', mode, ranked: true });
    }
    this.rooms.createRankedRoom(
      mode,
      entries.map((e) => e.client),
    );
  }
}
