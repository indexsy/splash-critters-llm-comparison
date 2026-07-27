/**
 * Ranked matchmaking: humans only, one queue per mode.
 *
 * A player's search range starts tight and widens the longer they wait. Two
 * players are only paired when each sits inside the other's range, using the
 * tighter of the two - so somebody who has been waiting five minutes can reach
 * out, but never drags a freshly queued player into an unfair match.
 */

import {
  CONFIG,
  maxPlayersForMode,
  type ErrorCode,
  type GameMode,
  type QueueStatusMsg,
} from '@splash/shared';
import type { PlayerService } from './players.js';
import type { Room } from './room.js';
import type { RoomManager } from './rooms.js';

interface QueueEntry {
  playerId: string;
  joinedAt: number;
  /** Snapshotted at join: a rating cannot change while you sit in the queue. */
  rating: number;
}

export interface QueueUpdate {
  playerId: string;
  status: QueueStatusMsg;
}

const MODES: readonly GameMode[] = ['duel', 'ffa'];

/** How many recent successful waits feed the ETA estimate. */
const WAIT_SAMPLES = 12;

export class Matchmaker {
  private readonly rooms: RoomManager;
  private readonly players: PlayerService;
  private readonly onMatched: (room: Room, playerIds: string[]) => void;

  /** Per mode, ordered by join time - longest waiting first. */
  private readonly queues = new Map<GameMode, QueueEntry[]>();
  /** Per mode, how long recent matches took to form. Drives the ETA. */
  private readonly recentWaits = new Map<GameMode, number[]>();

  constructor(
    rooms: RoomManager,
    players: PlayerService,
    onMatched: (room: Room, playerIds: string[]) => void,
  ) {
    this.rooms = rooms;
    this.players = players;
    this.onMatched = onMatched;
    for (const mode of MODES) {
      this.queues.set(mode, []);
      this.recentWaits.set(mode, []);
    }
  }

  join(playerId: string, mode: GameMode): { ok: boolean; error?: ErrorCode } {
    if (this.isQueued(playerId)) return { ok: false, error: 'already_queued' };
    if (this.players.getById(playerId) === null) return { ok: false, error: 'server_error' };

    this.queueFor(mode).push({
      playerId,
      joinedAt: Date.now(),
      rating: this.players.getRating(playerId, mode).rating,
    });
    return { ok: true };
  }

  leave(playerId: string): void {
    for (const mode of MODES) {
      const queue = this.queueFor(mode);
      const index = queue.findIndex((entry) => entry.playerId === playerId);
      if (index >= 0) queue.splice(index, 1);
    }
  }

  isQueued(playerId: string): boolean {
    return MODES.some((mode) => this.queueFor(mode).some((e) => e.playerId === playerId));
  }

  /** Runs on CONFIG.MM_TICK_MS: pair everyone who can be paired, then report. */
  tick(nowMs: number): QueueUpdate[] {
    for (const mode of MODES) this.formMatches(mode, nowMs);

    const updates: QueueUpdate[] = [];
    for (const mode of MODES) {
      const queue = this.queueFor(mode);
      for (const entry of queue) {
        const elapsedMs = Math.max(0, nowMs - entry.joinedAt);
        updates.push({
          playerId: entry.playerId,
          status: {
            t: 'queue_status',
            mode,
            elapsedMs,
            eta: this.estimateEta(mode, elapsedMs),
            searchRange: searchRange(entry, nowMs),
            waiting: queue.length,
          },
        });
      }
    }
    return updates;
  }

  // ------------------------------------------------------------------ pairing

  private formMatches(mode: GameMode, nowMs: number): void {
    const needed = maxPlayersForMode(mode);
    const queue = this.queueFor(mode);

    for (;;) {
      const group = this.findGroup(queue, needed, nowMs);
      if (group === null) return;
      for (const entry of group) {
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
      }
      this.startRoom(mode, group, nowMs);
    }
  }

  /**
   * The longest-waiting player anchors the group; everyone added must be
   * mutually compatible with all of them, so no member is ever stretched past
   * their own search range by somebody else's patience.
   */
  private findGroup(queue: QueueEntry[], needed: number, nowMs: number): QueueEntry[] | null {
    for (let i = 0; i + needed <= queue.length; i++) {
      const group = [queue[i]];
      for (let j = i + 1; j < queue.length && group.length < needed; j++) {
        const candidate = queue[j];
        if (group.every((member) => compatible(member, candidate, nowMs))) group.push(candidate);
      }
      if (group.length === needed) return group;
    }
    return null;
  }

  private startRoom(mode: GameMode, group: QueueEntry[], nowMs: number): void {
    const room = this.rooms.create(
      {
        name: mode === 'duel' ? 'Ranked Duel' : 'Ranked Free-For-All',
        size: mode === 'duel' ? 2 : 4,
        isPublic: false,
        theme: 'random',
        roundsToWin: CONFIG.DEFAULT_ROUNDS_TO_WIN,
        // Ranked never papers over a missing human with a bot.
        botFill: false,
      },
      null,
      true,
    );

    const seated: string[] = [];
    for (const entry of group) {
      const result = this.rooms.join(room.code, entry.playerId);
      if (result.room === undefined) continue;
      seated.push(entry.playerId);
      this.recordWait(mode, nowMs - entry.joinedAt);
    }

    // A room nobody could be seated in is dead weight; drop it rather than leak.
    if (seated.length < 2) {
      this.rooms.destroy(room.code);
      return;
    }
    this.onMatched(room, seated);
  }

  // --------------------------------------------------------------------- eta

  private recordWait(mode: GameMode, waitMs: number): void {
    const samples = this.recentWaits.get(mode);
    if (samples === undefined) return;
    samples.push(Math.max(0, waitMs));
    if (samples.length > WAIT_SAMPLES) samples.shift();
  }

  /** Seconds left, from how long recent matches took. Null while we have no data. */
  private estimateEta(mode: GameMode, elapsedMs: number): number | null {
    const samples = this.recentWaits.get(mode);
    if (samples === undefined || samples.length === 0) return null;
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    return Math.max(0, Math.round((average - elapsedMs) / 1000));
  }

  private queueFor(mode: GameMode): QueueEntry[] {
    const queue = this.queues.get(mode);
    if (queue !== undefined) return queue;
    const fresh: QueueEntry[] = [];
    this.queues.set(mode, fresh);
    return fresh;
  }
}

function searchRange(entry: QueueEntry, nowMs: number): number {
  const steps = Math.floor(Math.max(0, nowMs - entry.joinedAt) / CONFIG.MM_WIDEN_EVERY_MS);
  return Math.min(CONFIG.MM_RANGE_MAX, CONFIG.MM_RANGE_START + steps * CONFIG.MM_RANGE_WIDEN);
}

function compatible(a: QueueEntry, b: QueueEntry, nowMs: number): boolean {
  const range = Math.min(searchRange(a, nowMs), searchRange(b, nowMs));
  return Math.abs(a.rating - b.rating) <= range;
}
