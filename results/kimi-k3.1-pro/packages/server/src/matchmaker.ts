import { CONFIG } from "@splash/shared";
import type { GameMode } from "@splash/shared";
import { sendError, sendMessage, type ClientConnection } from "./net.js";
import type { RoomManager } from "./rooms.js";

interface QueueEntry {
  connection: ClientConnection;
  mode: GameMode;
  joinedAt: number;
  rating: number;
}

export class Matchmaker {
  private readonly entries = new Map<ClientConnection, QueueEntry>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly rooms: RoomManager) {
    this.timer = setInterval(() => this.tick(), CONFIG.MATCHMAKING.TICK_MS);
  }

  join(connection: ClientConnection, mode: GameMode): void {
    if (!connection.accountId || !connection.profile) return;
    if (!connection.profile.nicknameSet) return sendError(connection, "NICKNAME_REQUIRED", "Set a nickname before ranked play");
    if (connection.roomCode) this.rooms.leave(connection);
    const rating = this.rooms.db.getRating(connection.accountId, mode).rating;
    this.entries.set(connection, { connection, mode, joinedAt: Date.now(), rating });
    connection.queueMode = mode;
    this.status(connection);
  }

  leave(connection: ClientConnection): void {
    this.entries.delete(connection);
    connection.queueMode = null;
  }

  disconnect(connection: ClientConnection): void {
    this.leave(connection);
  }

  private range(entry: QueueEntry, now: number): number {
    const steps = Math.floor((now - entry.joinedAt) / CONFIG.MATCHMAKING.WIDEN_MS);
    return Math.min(CONFIG.MATCHMAKING.MAX_RANGE, CONFIG.MATCHMAKING.INITIAL_RANGE + steps * CONFIG.MATCHMAKING.WIDEN_STEP);
  }

  private status(connection: ClientConnection): void {
    const entry = this.entries.get(connection);
    if (!entry) return;
    const now = Date.now();
    const players = [...this.entries.values()].filter((candidate) => candidate.mode === entry.mode).length;
    sendMessage(connection, {
      type: "queue_status",
      mode: entry.mode,
      eta: Math.max(5, CONFIG.MATCHMAKING.ETA_SECONDS - players * 2),
      searchRange: this.range(entry, now),
      players
    });
  }

  private compatible(a: QueueEntry, b: QueueEntry, now: number): boolean {
    const difference = Math.abs(a.rating - b.rating);
    return difference <= this.range(a, now) && difference <= this.range(b, now);
  }

  private matches(mode: GameMode, now: number): ClientConnection[][] {
    const entries = [...this.entries.values()].filter((entry) => entry.mode === mode && entry.connection.ws.readyState === 1).sort((a, b) => a.joinedAt - b.joinedAt);
    const used = new Set<ClientConnection>();
    const matches: ClientConnection[][] = [];
    const size = mode === "duel" ? 2 : 4;
    for (const anchor of entries) {
      if (used.has(anchor.connection)) continue;
      const candidates = entries.filter((entry) => !used.has(entry.connection) && entry.connection !== anchor.connection && this.compatible(anchor, entry, now)).sort((a, b) => Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating));
      if (candidates.length < size - 1) continue;
      const group = [anchor.connection, ...candidates.slice(0, size - 1).map((entry) => entry.connection)];
      for (const connection of group) used.add(connection);
      matches.push(group);
    }
    return matches;
  }

  private tick(): void {
    const now = Date.now();
    for (const mode of ["duel", "ffa"] as const) {
      for (const group of this.matches(mode, now)) {
        for (const connection of group) this.leave(connection);
        this.rooms.createRanked(group, mode);
      }
    }
    for (const entry of this.entries.values()) this.status(entry.connection);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
