import { CONFIG } from "@sc/shared";
import type { GameMode } from "@sc/shared";
import type { Rooms, Conn } from "./rooms";

interface QueueEntry {
  playerId: string;
  conn: Conn;
  rating: number;
  joinedAt: number;
}

export class Matchmaker {
  private queues: Record<GameMode, QueueEntry[]> = { duel: [], ffa: [] };
  private timer: NodeJS.Timeout | null = null;
  /** players currently in a queue (to block double-queue) */
  private inQueue = new Set<string>();

  constructor(
    private rooms: Rooms,
    private ratingOf: (playerId: string, mode: GameMode) => number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), CONFIG.matchmakerTickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  join(mode: GameMode, conn: Conn): void {
    const playerId = conn.playerRow!.id;
    if (this.inQueue.has(playerId)) return;
    if (this.rooms.activeRankedMatch(playerId)) return;
    this.queues[mode].push({
      playerId,
      conn,
      rating: this.ratingOf(playerId, mode),
      joinedAt: Date.now(),
    });
    this.inQueue.add(playerId);
  }

  leave(playerId: string): boolean {
    let removed = false;
    for (const mode of ["duel", "ffa"] as GameMode[]) {
      const before = this.queues[mode].length;
      this.queues[mode] = this.queues[mode].filter((e) => e.playerId !== playerId);
      if (this.queues[mode].length !== before) removed = true;
    }
    this.inQueue.delete(playerId);
    return removed;
  }

  isQueued(playerId: string): boolean {
    return this.inQueue.has(playerId);
  }

  searchRange(entry: QueueEntry): number {
    const elapsed = Date.now() - entry.joinedAt;
    return Math.min(
      CONFIG.matchmakerMaxRange,
      CONFIG.matchmakerStartRange + Math.floor(elapsed / 10000) * CONFIG.matchmakerWidenPer10s,
    );
  }

  queueStatus(mode: GameMode, playerId: string): { range: number; waiting: number; etaSec: number | null; elapsedMs: number } {
    const entry = this.queues[mode].find((e) => e.playerId === playerId);
    if (!entry) return { range: 0, waiting: 0, etaSec: null, elapsedMs: 0 };
    const elapsedMs = Date.now() - entry.joinedAt;
    return {
      range: this.searchRange(entry),
      waiting: this.queues[mode].length,
      etaSec: this.queues[mode].length > (mode === "duel" ? 1 : 3) ? 5 : null,
      elapsedMs,
    };
  }

  private tick(): void {
    for (const mode of ["duel", "ffa"] as GameMode[]) {
      const size = mode === "duel" ? 2 : 4;
      const queue = this.queues[mode];
      // try to form groups within range
      let progress = true;
      while (progress && queue.length >= size) {
        progress = false;
        const first = queue[0]!;
        const range = this.searchRange(first);
        const group = [first];
        for (let i = 1; i < queue.length && group.length < size; i++) {
          const candidate = queue[i]!;
          if (Math.abs(candidate.rating - first.rating) <= range) group.push(candidate);
        }
        if (group.length >= size) {
          for (const e of group) {
            this.inQueue.delete(e.playerId);
            const idx = queue.indexOf(e);
            if (idx !== -1) queue.splice(idx, 1);
          }
          this.rooms.launchRankedMatch(
            mode,
            group.map((e) => ({ conn: e.conn, rating: e.rating })),
          );
          progress = true;
        }
      }
      // drop disconnected conns
      this.queues[mode] = queue.filter((e) => {
        const alive = e.conn.playerRow !== null && this.rooms.getConn(e.playerId) === e.conn;
        if (!alive) this.inQueue.delete(e.playerId);
        return alive;
      });
    }
  }

  queuedEntries(): Array<{ playerId: string; mode: GameMode }> {
    const out: Array<{ playerId: string; mode: GameMode }> = [];
    for (const mode of ["duel", "ffa"] as GameMode[]) {
      for (const e of this.queues[mode]) out.push({ playerId: e.playerId, mode });
    }
    return out;
  }

  /** Called when a player disconnects while queued. */
  handleDisconnect(playerId: string): void {
    this.leave(playerId);
  }
}
