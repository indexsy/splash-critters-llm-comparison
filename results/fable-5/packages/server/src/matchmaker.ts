import { CONFIG, type GameMode } from "../../shared/src/index.js";
import { getRating } from "./db/queries.js";
import { gameLoop, Match, type Sender, type SeatSpec } from "./gameLoop.js";

export interface QueueMember extends Sender {
  playerId: string;
  displayName: string;
  animal: string;
  hat: string;
  /** Called when a ranked match starts so net.ts can bind the conn to it. */
  onRankedMatch(match: Match): void;
}

interface QueueEntry {
  member: QueueMember;
  rating: number;
  joinedAt: number;
}

function searchRange(waitedMs: number): number {
  const widened = CONFIG.MM_INITIAL_RANGE + Math.floor(waitedMs / 10_000) * CONFIG.MM_WIDEN_PER_10S;
  return Math.min(CONFIG.MM_MAX_RANGE, widened);
}

/**
 * Ranked matchmaker: ticks every 2s, pairs players within ±100 rating,
 * widening +50 every 10s up to ±400. Humans only — never bots.
 */
export class Matchmaker {
  private queues: Record<GameMode, QueueEntry[]> = { duel: [], ffa: [] };

  constructor() {
    setInterval(() => this.tick(), CONFIG.MATCHMAKER_TICK_MS).unref();
  }

  join(mode: GameMode, member: QueueMember): void {
    this.leave(member.playerId);
    this.queues[mode].push({
      member,
      rating: getRating(member.playerId, mode).rating,
      joinedAt: Date.now(),
    });
    this.sendStatus(mode);
  }

  leave(playerId: string): void {
    for (const mode of ["duel", "ffa"] as GameMode[]) {
      this.queues[mode] = this.queues[mode].filter((e) => e.member.playerId !== playerId);
    }
  }

  inQueue(playerId: string): GameMode | null {
    for (const mode of ["duel", "ffa"] as GameMode[]) {
      if (this.queues[mode].some((e) => e.member.playerId === playerId)) return mode;
    }
    return null;
  }

  private tick(): void {
    this.matchMode("duel", 2);
    this.matchMode("ffa", 4);
    this.sendStatus("duel");
    this.sendStatus("ffa");
  }

  private matchMode(mode: GameMode, size: number): void {
    const queue = this.queues[mode];
    if (queue.length < size) return;
    const now = Date.now();
    // Sort by rating; scan windows of `size` where the spread fits within the
    // widest search range in the window (longest-waiting player helps everyone).
    const sorted = [...queue].sort((a, b) => a.rating - b.rating);
    const taken = new Set<QueueEntry>();
    for (let i = 0; i + size <= sorted.length; i++) {
      const window = sorted.slice(i, i + size);
      if (window.some((e) => taken.has(e))) continue;
      const spread = window[size - 1].rating - window[0].rating;
      const range = Math.max(...window.map((e) => searchRange(now - e.joinedAt)));
      if (spread > range) continue;
      for (const e of window) taken.add(e);
      this.launch(mode, window);
      i += size - 1;
    }
    if (taken.size > 0) {
      this.queues[mode] = queue.filter((e) => !taken.has(e));
    }
  }

  private launch(mode: GameMode, entries: QueueEntry[]): void {
    for (const e of entries) e.member.send({ t: "match_found", mode });
    const seats: SeatSpec[] = entries.map((e) => ({
      playerId: e.member.playerId,
      nickname: e.member.displayName,
      animal: e.member.animal,
      hat: e.member.hat,
      isBot: false,
      conn: e.member,
      rating: e.rating,
    }));
    const themes = ["backyard", "beach", "pool"] as const;
    const match = new Match({
      mode,
      ranked: true,
      roundsToWin: CONFIG.DEFAULT_ROUNDS_TO_WIN,
      theme: themes[Math.floor(Math.random() * themes.length)],
      seats,
      onEnd: () => {},
    });
    for (const e of entries) e.member.onRankedMatch(match);
    gameLoop.add(match);
  }

  private sendStatus(mode: GameMode): void {
    const now = Date.now();
    const queue = this.queues[mode];
    for (const e of queue) {
      const waitingMs = now - e.joinedAt;
      e.member.send({
        t: "queue_status",
        mode,
        waitingMs,
        searchRange: searchRange(waitingMs),
        etaMs: Math.max(4000, 30_000 - waitingMs),
      });
    }
  }
}

export const matchmaker = new Matchmaker();
