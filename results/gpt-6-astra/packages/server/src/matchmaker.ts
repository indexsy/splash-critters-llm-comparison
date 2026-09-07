import { CONFIG, type Mode } from "@splash/shared";
import { send, type Peer } from "./net.js";
import type { Rooms } from "./rooms.js";

interface Entry {
  peer: Peer;
  rating: number;
  joinedAt: number;
  mode: Mode;
}
export class Matchmaker {
  readonly entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private rooms: Rooms) {
    this.timer = setInterval(() => this.tick(), CONFIG.MATCHMAKER_INTERVAL_MS);
  }
  range(entry: Entry, now: number): number {
    return Math.min(
      CONFIG.MATCHMAKER_MAX_RANGE,
      CONFIG.MATCHMAKER_INITIAL_RANGE +
        Math.floor((now - entry.joinedAt) / CONFIG.MATCHMAKER_WIDEN_MS) *
          CONFIG.MATCHMAKER_WIDEN_BY,
    );
  }
  join(peer: Peer, mode: Mode): void {
    if (peer.roomCode || peer.queue)
      throw new Error("Leave your room or current queue first.");
    const p = this.rooms.store.profile(peer.id!)!;
    if (!p.nicknameSet)
      throw new Error("Choose a nickname before playing ranked.");
    if (
      [...this.rooms.rooms.values()].some(
        (r) =>
          r.status === "playing" &&
          r.slots.some((s) => s.playerId === peer.id && s.kind === "human"),
      )
    )
      throw new Error("Your previous match is still running.");
    peer.queue = mode;
    this.entries.set(peer.id!, {
      peer,
      mode,
      joinedAt: Date.now(),
      rating: p.ratings.find((r) => r.mode === mode)!.rating,
    });
    this.status(this.entries.get(peer.id!)!);
  }
  leave(peer: Peer): void {
    this.entries.delete(peer.id!);
    peer.queue = null;
    send(peer, { type: "queue_left" });
  }
  private status(entry: Entry): void {
    const queued = [...this.entries.values()].filter(
      (e) => e.mode === entry.mode,
    ).length;
    send(entry.peer, {
      type: "queue_status",
      mode: entry.mode,
      eta: queued >= CONFIG.ARENAS[entry.mode].players ? 2 : null,
      searchRange: this.range(entry, Date.now()),
      elapsed: Math.floor((Date.now() - entry.joinedAt) / 1000),
      queued,
    });
  }
  tick(): void {
    const now = Date.now();
    for (const entry of this.entries.values()) this.status(entry);
    for (const mode of ["duel", "ffa"] as Mode[]) {
      const candidates = [...this.entries.values()]
        .filter((e) => e.mode === mode)
        .sort((a, b) => a.joinedAt - b.joinedAt);
      const size = CONFIG.ARENAS[mode].players;
      for (const first of candidates) {
        if (!this.entries.has(first.peer.id!)) continue;
        const group = [first];
        for (const other of candidates) {
          if (other === first || !this.entries.has(other.peer.id!)) continue;
          if (
            group.every(
              (e) =>
                Math.abs(e.rating - other.rating) <=
                Math.min(this.range(e, now), this.range(other, now)),
            )
          )
            group.push(other);
          if (group.length === size) break;
        }
        if (group.length !== size) continue;
        for (const entry of group) {
          this.entries.delete(entry.peer.id!);
          entry.peer.queue = null;
        }
        const room = this.rooms.create(
          first.peer,
          {
            name: "Ranked match",
            mode,
            isPublic: false,
            theme: "random",
            roundsToWin: 3,
            botFill: false,
          },
          true,
        );
        for (const entry of group.slice(1))
          this.rooms.join(entry.peer, room.code, true);
        for (const slot of room.slots) slot.ready = true;
        for (const entry of group)
          send(entry.peer, { type: "match_found", code: room.code, mode });
        this.rooms.start(room);
      }
    }
  }
  close(): void {
    clearInterval(this.timer);
  }
}
