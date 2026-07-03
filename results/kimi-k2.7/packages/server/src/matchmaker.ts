import { CONFIG, MODES, type Mode } from "@splash/shared";
import type { Connection } from "./net.js";
import { send } from "./net.js";
import { getRatings } from "./db/index.js";

export type QueuedPlayer = {
  conn: Connection;
  mode: Mode;
  joinedAt: number;
  searchRange: number;
  lastWidenedAt: number;
};

const queue = new Map<string, QueuedPlayer>();
let lastTick = 0;

export function joinQueue(conn: Connection, mode: Mode) {
  if (conn.roomCode) return;
  conn.queueMode = mode;
  conn.queueJoinedAt = Date.now();
  queue.set(conn.playerId, {
    conn,
    mode,
    joinedAt: Date.now(),
    searchRange: CONFIG.MM_INITIAL_RANGE,
    lastWidenedAt: Date.now(),
  });
  send(conn.ws, { type: "queue_status", elapsedMs: 0, searchRange: CONFIG.MM_INITIAL_RANGE });
}

export function leaveQueue(conn: Connection) {
  conn.queueMode = null;
  queue.delete(conn.playerId);
}

export function tickMatchmaker(now: number): { players: Connection[]; mode: Mode }[] {
  if (now - lastTick < CONFIG.MM_TICK_MS) return [];
  lastTick = now;

  // Widen ranges
  for (const q of queue.values()) {
    if (now - q.lastWidenedAt >= CONFIG.MM_WIDEN_EVERY_MS) {
      q.searchRange = Math.min(CONFIG.MM_MAX_RANGE, q.searchRange + CONFIG.MM_WIDEN_BY);
      q.lastWidenedAt = now;
    }
    send(q.conn.ws, {
      type: "queue_status",
      elapsedMs: now - q.joinedAt,
      searchRange: q.searchRange,
    });
  }

  const matches: { players: Connection[]; mode: Mode }[] = [];
  for (const mode of MODES) {
    const players = [...queue.values()].filter((q) => q.mode === mode);
    if (players.length < (mode === "duel" ? 2 : 4)) continue;

    // Sort by rating
    const ids = players.map((p) => p.conn.playerId);
    const ratings = getRatings(ids, mode);
    players.sort((a, b) => (ratings[a.conn.playerId]?.rating ?? CONFIG.ELO_START) - (ratings[b.conn.playerId]?.rating ?? CONFIG.ELO_START)
    );

    const needed = mode === "duel" ? 2 : 4;
    while (players.length >= needed) {
      const anchor = players.shift()!;
      const anchorRating = ratings[anchor.conn.playerId]?.rating ?? CONFIG.ELO_START;
      const chosen: QueuedPlayer[] = [anchor];
      for (let i = 0; i < players.length && chosen.length < needed; i++) {
        const other = players[i];
        const otherRating = ratings[other.conn.playerId]?.rating ?? CONFIG.ELO_START;
        if (Math.abs(anchorRating - otherRating) <= Math.min(anchor.searchRange, other.searchRange)) {
          chosen.push(other);
          players.splice(i, 1);
          i--;
        }
      }
      if (chosen.length === needed) {
        for (const c of chosen) {
          queue.delete(c.conn.playerId);
          c.conn.queueMode = null;
        }
        matches.push({ players: chosen.map((c) => c.conn), mode });
      } else {
        // Put anchor back
        players.unshift(anchor);
        break;
      }
    }
  }
  return matches;
}

export function queuedCount(mode?: Mode): number {
  if (!mode) return queue.size;
  return [...queue.values()].filter((q) => q.mode === mode).length;
}
