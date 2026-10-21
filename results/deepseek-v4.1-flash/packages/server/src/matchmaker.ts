import {
  CONFIG,
  ratingSearchRange,
  type GameMode,
} from "@splash/shared";
import type { SplashDb } from "./db/index.js";
import { getSingleRating } from "./db/queries.js";

export interface MatchmakerTransport {
  send(playerId: string, message: import("@splash/shared").ServerMessage): void;
  isOnline(playerId: string): boolean;
  onMatched(mode: GameMode, playerIds: string[]): boolean;
}

interface QueueEntry {
  playerId: string;
  mode: GameMode;
  joinedAt: number;
  rating: number;
}

export class Matchmaker {
  private queues: Record<GameMode, Map<string, QueueEntry>> = {
    duel: new Map(),
    ffa: new Map(),
  };

  constructor(
    private readonly db: SplashDb,
    private readonly transport: MatchmakerTransport,
  ) {}

  queueSize(mode: GameMode): number {
    return this.queues[mode].size;
  }

  isQueued(playerId: string): boolean {
    return this.queues.duel.has(playerId) || this.queues.ffa.has(playerId);
  }

  join(playerId: string, mode: GameMode): string | null {
    if (this.isQueued(playerId)) this.leave(playerId);
    if (mode !== "duel" && mode !== "ffa") return "Invalid queue.";
    const rating = getSingleRating(this.db, playerId, mode).rating;
    this.queues[mode].set(playerId, {
      playerId,
      mode,
      joinedAt: Date.now(),
      rating,
    });
    this.sendStatus(playerId);
    return null;
  }

  leave(playerId: string): void {
    this.queues.duel.delete(playerId);
    this.queues.ffa.delete(playerId);
    this.transport.send(playerId, {
      t: "notice",
      msg: "Left the queue.",
    });
  }

  removePlayer(playerId: string): void {
    this.queues.duel.delete(playerId);
    this.queues.ffa.delete(playerId);
  }

  sendStatus(playerId: string): void {
    const mode = this.queues.duel.has(playerId)
      ? "duel"
      : this.queues.ffa.has(playerId)
        ? "ffa"
        : null;
    if (!mode) return;
    const entry = this.queues[mode].get(playerId);
    if (!entry) return;
    const waitMs = Date.now() - entry.joinedAt;
    const queueSize = this.queues[mode].size;
    const candidates = Math.max(0, queueSize - 1);
    const eta = candidates === 0 ? 0 : Math.max(3, Math.ceil(18 / (candidates + 1)));
    this.transport.send(playerId, {
      t: "queue_status",
      eta,
      searchRange: ratingSearchRange(waitMs),
      mode,
      elapsedMs: waitMs,
    });
  }

  tick(): void {
    for (const mode of ["duel", "ffa"] as const) {
      this.prune(mode);
      const entries = [...this.queues[mode].values()].sort(
        (a, b) => a.joinedAt - b.joinedAt,
      );
      const targetSize = mode === "duel" ? 2 : CONFIG.MATCHMAKING.ffaSize;
      if (mode === "duel") {
        this.matchDuel(entries);
      } else {
        this.matchFfa(entries, targetSize);
      }
      for (const entry of this.queues[mode].values()) {
        this.sendStatus(entry.playerId);
      }
    }
  }

  private prune(mode: GameMode): void {
    for (const [playerId] of this.queues[mode]) {
      if (!this.transport.isOnline(playerId)) this.queues[mode].delete(playerId);
    }
  }

  private ranges(entry: QueueEntry): number {
    return ratingSearchRange(Date.now() - entry.joinedAt);
  }

  private mutuallyClose(a: QueueEntry, b: QueueEntry): boolean {
    const diff = Math.abs(a.rating - b.rating);
    return diff <= this.ranges(a) && diff <= this.ranges(b);
  }

  private matchDuel(entries: QueueEntry[]): void {
    const used = new Set<string>();
    for (let i = 0; i < entries.length; i += 1) {
      const anchor = entries[i];
      if (!anchor || used.has(anchor.playerId)) continue;
      const candidates = entries
        .slice(i + 1)
        .filter((entry) => !used.has(entry.playerId) && this.mutuallyClose(anchor, entry))
        .sort((a, b) => Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating));
      const partner = candidates[0];
      if (!partner) continue;
      used.add(anchor.playerId);
      used.add(partner.playerId);
      this.queues.duel.delete(anchor.playerId);
      this.queues.duel.delete(partner.playerId);
      const created = this.transport.onMatched("duel", [anchor.playerId, partner.playerId]);
      if (!created) {
        this.queues.duel.set(anchor.playerId, anchor);
        this.queues.duel.set(partner.playerId, partner);
      }
    }
  }

  private matchFfa(entries: QueueEntry[], size: number): void {
    const used = new Set<string>();
    for (let i = 0; i < entries.length; i += 1) {
      const anchor = entries[i];
      if (!anchor || used.has(anchor.playerId)) continue;
      const group: QueueEntry[] = [anchor];
      const candidates = entries
        .slice(i + 1)
        .filter(
          (entry) =>
            !used.has(entry.playerId) &&
            !group.includes(entry) &&
            this.mutuallyClose(anchor, entry),
        )
        .sort((a, b) => Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating));
      for (const candidate of candidates) {
        if (group.length >= size) break;
        if (group.every((member) => this.mutuallyClose(member, candidate))) {
          group.push(candidate);
        }
      }
      if (group.length < size) continue;
      for (const member of group) {
        used.add(member.playerId);
        this.queues.ffa.delete(member.playerId);
      }
      const created = this.transport.onMatched(
        "ffa",
        group.map((member) => member.playerId),
      );
      if (!created) {
        for (const member of group) this.queues.ffa.set(member.playerId, member);
      }
      if (this.queues.ffa.size < size) break;
    }
  }
}
