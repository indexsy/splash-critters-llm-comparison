/**
 * The heartbeat.
 *
 * One 30Hz timer drives every live match on the server; rooms are not allowed
 * their own timers, because a hundred rooms would then be a hundred competing
 * clocks. Everything else that is time-based - matchmaking sweeps, room
 * expiry, liveness pings and reconnect grace - hangs off slower timers here.
 */

import { CONFIG } from '@splash/shared';
import { finaliseMatch } from './elo.js';
import { releaseSlot } from './handlers.js';
import type { Hub } from './net.js';
import type { Matchmaker } from './matchmaker.js';
import type { PlayerService } from './players.js';
import type { Room } from './room.js';
import type { RoomManager } from './rooms.js';

export interface GameLoopDeps {
  rooms: RoomManager;
  players: PlayerService;
  matchmaker: Matchmaker;
  hub: Hub;
}

type Timer = ReturnType<typeof setInterval>;

/**
 * A process that was paused - a laptop lid, a long GC, a debugger breakpoint -
 * comes back owing thousands of ticks. Simulating a handful and dropping the
 * rest keeps the world moving instead of stampeding through it.
 */
const MAX_CATCHUP_TICKS = 5;

/** How long a ranked results screen stays up before the room is collected. */
const RANKED_RESULTS_MS = 20000;

export class GameLoop {
  private readonly rooms: RoomManager;
  private readonly players: PlayerService;
  private readonly matchmaker: Matchmaker;
  private readonly hub: Hub;

  private timers: Timer[] = [];
  private readonly pendingDestroys = new Set<ReturnType<typeof setTimeout>>();
  private lastMs = 0;
  private accumulator = 0;

  constructor(deps: GameLoopDeps) {
    this.rooms = deps.rooms;
    this.players = deps.players;
    this.matchmaker = deps.matchmaker;
    this.hub = deps.hub;
  }

  start(): void {
    if (this.timers.length > 0) return;
    this.lastMs = Date.now();
    this.accumulator = 0;
    this.timers = [
      setInterval(() => this.step(), CONFIG.TICK_MS),
      setInterval(() => this.pumpMatchmaker(), CONFIG.MM_TICK_MS),
      setInterval(() => this.sweepRooms(), CONFIG.ROOM_SWEEP_MS),
      setInterval(() => this.hub.pingAll(Date.now()), CONFIG.PING_INTERVAL_MS),
    ];
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    for (const pending of this.pendingDestroys) clearTimeout(pending);
    this.pendingDestroys.clear();
  }

  // ----------------------------------------------------------------- the tick

  /** Accumulator clock: a late timer catches up rather than drifting behind. */
  private step(): void {
    const now = Date.now();
    this.accumulator += now - this.lastMs;
    this.lastMs = now;

    let steps = 0;
    while (this.accumulator >= CONFIG.TICK_MS && steps < MAX_CATCHUP_TICKS) {
      this.accumulator -= CONFIG.TICK_MS;
      steps++;
    }
    if (this.accumulator > CONFIG.TICK_MS * MAX_CATCHUP_TICKS) this.accumulator = 0;

    for (let i = 0; i < steps; i++) this.advanceRooms(now);
  }

  private advanceRooms(nowMs: number): void {
    for (const room of this.rooms.all()) {
      try {
        this.advanceRoom(room, nowMs);
      } catch (error) {
        // One sick room must never take the whole server down with it.
        console.error(`[loop] room ${room.code} failed a tick:`, error);
      }
    }
  }

  private advanceRoom(room: Room, nowMs: number): void {
    this.checkDisconnects(room, nowMs);

    const match = room.match;
    if (room.phase !== 'match' || match === null) return;
    if (!match.finished) match.tick(nowMs);
    if (match.finished) this.finish(room, nowMs);
  }

  // ------------------------------------------------------------- disconnects

  /**
   * The grace period expiring is the only disconnect rule that is about time,
   * which is why it lives here rather than in the socket layer.
   */
  private checkDisconnects(room: Room, nowMs: number): void {
    for (let slot = 0; slot < room.slots.length; slot++) {
      const occupant = room.slots[slot];
      if (occupant.kind !== 'human' || occupant.connected) continue;
      if (occupant.disconnectedAt === null) continue;
      if (nowMs - occupant.disconnectedAt < CONFIG.RECONNECT_GRACE_MS) continue;

      // Clearing the stamp marks the timeout as handled, so it fires once.
      occupant.disconnectedAt = null;
      this.onGraceExpired(room, slot, occupant.playerId);
    }
  }

  private onGraceExpired(room: Room, slot: number, playerId: string): void {
    const match = room.match;
    if (room.phase === 'match' && match !== null && !match.finished) {
      // Casual hands the critter to a bot, ranked calls it a forfeit. Either
      // way the seat stays theirs, so a late reconnect still lands somewhere.
      releaseSlot(this.hub, room, slot);
      return;
    }
    this.rooms.leave(playerId);
    this.hub.broadcastLobby(room);
  }

  // ---------------------------------------------------------------- finishing

  private finish(room: Room, nowMs: number): void {
    const match = room.match;
    if (match === null) return;

    const end = finaliseMatch(this.players, room, match.results(), match.startedAt);
    this.hub.broadcastRoom(room, end);

    room.phase = 'results';
    room.rematchVotes.clear();
    room.ready.clear();
    room.touch(nowMs);

    // Ratings, XP and unlocks all just moved: nobody should have to refresh.
    for (const playerId of room.humanIds()) {
      const profile = this.players.getProfile(playerId);
      if (profile !== null) this.hub.send(playerId, { t: 'profile_update', profile });
    }
    this.hub.broadcastLobby(room);

    // Ranked rooms belong to the matchmaker and have no rematch to wait for.
    if (room.ranked) this.scheduleDestroy(room.code);
  }

  private scheduleDestroy(code: string): void {
    const timer = setTimeout(() => {
      this.pendingDestroys.delete(timer);
      this.rooms.destroy(code);
    }, RANKED_RESULTS_MS);
    // Never a reason to hold the process open just to bin a room.
    timer.unref();
    this.pendingDestroys.add(timer);
  }

  // ------------------------------------------------------------ slower timers

  private pumpMatchmaker(): void {
    for (const update of this.matchmaker.tick(Date.now())) {
      this.hub.send(update.playerId, update.status);
    }
  }

  private sweepRooms(): void {
    const removed = this.rooms.sweep(Date.now());
    if (removed.length > 0) console.log(`[rooms] swept idle: ${removed.join(', ')}`);
  }
}
