import { CONFIG, type Mode } from '@splash/shared';
import { startRanked } from './rooms.js';
import { q, sendTo, session } from './wire.js';

interface Entry {
  playerId: string;
  mode: Mode;
  rating: number;
  joinedAt: number;
}

const queue: Entry[] = [];

export function inQueue(playerId: string): boolean {
  return queue.some((e) => e.playerId === playerId);
}

export function joinQueue(playerId: string, mode: Mode): string | null {
  const prof = q.profile(playerId);
  if (!prof) return 'No profile.';
  if (!prof.nickSet) return 'Set a nickname before ranked.';
  const s = session(playerId);
  if (s?.roomCode) return 'Leave your room first.';
  if (inQueue(playerId)) return 'Already in queue.';
  queue.push({
    playerId,
    mode,
    rating: prof.ratings[mode].rating,
    joinedAt: Date.now(),
  });
  if (s) {
    s.queueMode = mode;
    s.queueJoinedAt = Date.now();
  }
  return null;
}

export function leaveQueue(playerId: string) {
  const i = queue.findIndex((e) => e.playerId === playerId);
  if (i >= 0) queue.splice(i, 1);
  const s = session(playerId);
  if (s) s.queueMode = null;
}

function rangeFor(entry: Entry, now: number): number {
  const steps = Math.floor((now - entry.joinedAt) / CONFIG.MM_WIDEN_EVERY_MS);
  return Math.min(CONFIG.MM_CAP_RANGE, CONFIG.MM_BASE_RANGE + steps * CONFIG.MM_WIDEN);
}

export function tickMatchmaker(now = Date.now()) {
  for (const mode of ['duel', 'ffa'] as Mode[]) {
    const pool = queue.filter((e) => e.mode === mode).sort((a, b) => a.joinedAt - b.joinedAt);
    const need = mode === 'duel' ? 2 : 4;
    const used = new Set<string>();
    for (const seed of pool) {
      if (used.has(seed.playerId)) continue;
      const group = [seed];
      for (const other of pool) {
        if (other.playerId === seed.playerId || used.has(other.playerId)) continue;
        const limit = Math.max(rangeFor(seed, now), rangeFor(other, now));
        if (Math.abs(other.rating - seed.rating) <= limit) group.push(other);
        if (group.length === need) break;
      }
      if (group.length === need) {
        for (const g of group) {
          used.add(g.playerId);
          leaveQueue(g.playerId);
        }
        startRanked(mode, group.map((g) => g.playerId));
      }
    }
    for (const e of pool) {
      if (used.has(e.playerId)) continue;
      const elapsed = Math.round((now - e.joinedAt) / 1000);
      const waiting = pool.length;
      sendTo(e.playerId, {
        t: 'queue_status',
        eta: waiting >= need ? 5 : 20 + elapsed,
        searchRange: rangeFor(e, now),
        elapsed,
        mode,
      });
    }
  }
}
