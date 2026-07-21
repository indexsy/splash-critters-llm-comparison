import { CONFIG, type Mode } from "@splash/shared";
import type { Profile } from "@splash/shared";
import type { RoomStore } from "./rooms.js";

interface QueueEntry {
  playerId: string;
  rating: number;
  enqueuedAt: number;
  lastWidenAt: number;
  range: number;
}

interface QueueState {
  entries: Map<string, QueueEntry>;
}

export interface MatchmakeResult {
  formedGroups: Array<{ playerIds: string[]; mode: Mode }>;
}

export class Matchmaker {
  private queues: Record<Mode, QueueState> = {
    duel: { entries: new Map() },
    ffa: { entries: new Map() }
  };
  private readonly dbGetRating: (playerId: string, mode: Mode) => number;

  constructor(opts: { getRating: (playerId: string, mode: Mode) => number }) {
    this.dbGetRating = opts.getRating;
  }

  enqueue(playerId: string, mode: Mode, profile?: Profile): void {
    void profile;
    const rating = this.dbGetRating(playerId, mode);
    const now = Date.now();
    this.queue(mode).entries.set(playerId, {
      playerId,
      rating,
      enqueuedAt: now,
      lastWidenAt: now,
      range: CONFIG.MATCHMAKING_INITIAL_RANGE
    });
  }

  dequeue(playerId: string): void {
    this.queues.duel.entries.delete(playerId);
    this.queues.ffa.entries.delete(playerId);
  }

  status(playerId: string): { mode: Mode | null; eta: number; searchRange: number; elapsed: number } {
    const modes: ReadonlyArray<Mode> = ["duel", "ffa"];
    for (const mode of modes) {
      const entry = this.queue(mode).entries.get(playerId);
      if (entry) {
        const now = Date.now();
        return {
          mode,
          eta: Math.max(0, 4_000 - (now - entry.enqueuedAt)),
          searchRange: entry.range,
          elapsed: now - entry.enqueuedAt
        };
      }
    }
    return { mode: null, eta: 0, searchRange: 0, elapsed: 0 };
  }

  tick(now: number): MatchmakeResult {
    const formedGroups: Array<{ playerIds: string[]; mode: Mode }> = [];
    const modes: ReadonlyArray<Mode> = ["duel", "ffa"];
    for (const mode of modes) {
      const queue = this.queue(mode);
      const target = mode === "duel" ? 2 : 4;
      this.widenRanges(queue, now);
      const group = this.findGroup(queue, target, now);
      if (group.length === target) {
        for (const entry of group) queue.entries.delete(entry.playerId);
        formedGroups.push({ playerIds: group.map((e) => e.playerId), mode });
      }
    }
    return { formedGroups };
  }

  private queue(mode: Mode): QueueState {
    if (mode === "duel") return this.queues.duel;
    return this.queues.ffa;
  }

  private widenRanges(queue: QueueState, now: number): void {
    for (const entry of queue.entries.values()) {
      if (now - entry.lastWidenAt >= CONFIG.MATCHMAKING_WIDEN_MS) {
        entry.range = Math.min(CONFIG.MATCHMAKING_MAX_RANGE, entry.range + CONFIG.MATCHMAKING_WIDEN_AMOUNT);
        entry.lastWidenAt = now;
      }
    }
  }

  private findGroup(queue: QueueState, target: number, _now: number): QueueEntry[] {
    const entries = [...queue.entries.values()].sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    for (let i = 0; i < entries.length; i++) {
      const seed = entries[i]!;
      const group: QueueEntry[] = [seed];
      for (let j = 0; j < entries.length && group.length < target; j++) {
        if (j === i) continue;
        const candidate = entries[j]!;
        if (group.some((g) => g.playerId === candidate.playerId)) continue;
        if (group.every((member) => rangesOverlap(member, candidate))) group.push(candidate);
      }
      if (group.length === target) return group;
      if (target === 2 && group.length >= 2) {
        return group.slice(0, 2);
      }
    }
    return [];
  }
}

function rangesOverlap(a: QueueEntry, b: QueueEntry): boolean {
  const gap = Math.abs(a.rating - b.rating);
  const window = Math.min(a.range, b.range);
  return gap <= window;
}

export function shouldRunMatchmaker(now: number, lastRunAt: number): boolean {
  return now - lastRunAt >= CONFIG.MATCHMAKING_TICK_MS;
}

export function formRankedRoom(store: RoomStore, playerIds: string[], mode: Mode): import("./rooms.js").Room {
  const size: 2 | 4 = mode === "duel" ? 2 : 4;
  const room = store.create(playerIds[0]!, {
    name: `Ranked ${mode === "duel" ? "Duel" : "FFA"}`,
    size,
    visibility: "private",
    theme: "random",
    roundsToWin: mode === "duel" ? 3 : 3,
    botFill: false
  }, "ranked");
  for (let i = 1; i < playerIds.length; i++) {
    const next = playerIds[i]!;
    const target = room.slots.find((s) => s.kind === "empty");
    if (target) {
      target.kind = "human";
      target.playerId = next;
      target.ready = true;
    }
  }
  const hostSlot = room.slots.find((s) => s.playerId === room.hostId);
  if (hostSlot) hostSlot.ready = true;
  return room;
}
