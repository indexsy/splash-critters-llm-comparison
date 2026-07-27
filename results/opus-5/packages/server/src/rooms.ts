/**
 * Every live room on the server, plus the one-room-per-player rule that keeps
 * the lobby honest. Nothing here talks to sockets: the gateway calls in, gets a
 * Room or an ErrorCode back, and does the broadcasting itself.
 */

import {
  CONFIG,
  type BotDifficulty,
  type CreateRoomOpts,
  type ErrorCode,
  type GameMode,
  type RoomSummary,
} from '@splash/shared';
import { Room, type PlayerLookup } from './room.js';

/** No O/0/I/1: room codes get read aloud and typed in by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(): string {
  let code = '';
  for (let i = 0; i < CONFIG.ROOM_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export interface JoinResult {
  room?: Room;
  slot?: number;
  error?: ErrorCode;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  /** playerId -> room code. A player is only ever in one room. */
  private readonly byPlayer = new Map<string, string>();
  private readonly lookup: PlayerLookup;

  constructor(lookup: PlayerLookup) {
    this.lookup = lookup;
  }

  create(opts: CreateRoomOpts, hostPlayerId: string | null, ranked: boolean): Room {
    const room = new Room(this.freshCode(), opts, ranked, hostPlayerId);
    this.rooms.set(room.code, room);

    if (hostPlayerId !== null) {
      room.addHuman(hostPlayerId);
      this.byPlayer.set(hostPlayerId, room.code);
    }
    // Practice and tutorial rooms have nobody else coming, so seat the bots now.
    if (room.autoStart) room.fillWithBots();

    return room;
  }

  private freshCode(): string {
    for (let attempt = 0; attempt < 200; attempt++) {
      const code = randomCode();
      if (!this.rooms.has(code)) return code;
    }
    // Astronomically unlikely; a suffix keeps the server alive rather than looping.
    return `${randomCode()}${this.rooms.size}`;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  /** What the room browser shows: public, still in the lobby, still has space. */
  list(mode?: GameMode): Room[] {
    const open: Room[] = [];
    for (const room of this.rooms.values()) {
      if (!room.isPublic || room.ranked) continue;
      if (room.phase !== 'lobby') continue;
      if (room.occupiedCount() >= room.maxPlayers) continue;
      if (mode !== undefined && room.mode !== mode) continue;
      open.push(room);
    }
    return open.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  /** The wire shape of `list`, which is all the gateway actually sends. */
  listSummaries(mode?: GameMode): RoomSummary[] {
    return this.list(mode).map((room) => room.toSummary(this.lookup));
  }

  roomOfPlayer(playerId: string): Room | undefined {
    const code = this.byPlayer.get(playerId);
    return code === undefined ? undefined : this.rooms.get(code);
  }

  join(code: string, playerId: string): JoinResult {
    const room = this.get(code);
    if (!room) return { error: 'room_not_found' };

    const existing = room.slotOfPlayer(playerId);
    if (existing >= 0) {
      this.byPlayer.set(playerId, room.code);
      return { room, slot: existing };
    }

    if (room.phase !== 'lobby') return { error: 'room_in_progress' };

    // Joining somewhere new always means leaving wherever you were.
    const current = this.roomOfPlayer(playerId);
    if (current && current.code !== room.code) this.leave(playerId);

    const slot = room.addHuman(playerId);
    if (slot < 0) return { error: 'room_full' };

    this.byPlayer.set(playerId, room.code);
    return { room, slot };
  }

  /**
   * Host slot editing, with the membership bookkeeping the room cannot do for
   * itself. A human evicted from a seat (only ever possible while they are
   * disconnected) must stop counting as a member of the room, or they keep a
   * vote, keep the room alive and come back to a seat that is not theirs.
   */
  setSlot(
    room: Room,
    slot: number,
    kind: 'open' | 'bot',
    difficulty?: BotDifficulty,
  ): boolean {
    const change = room.setSlot(slot, kind, difficulty);
    if (change.evicted !== null && this.byPlayer.get(change.evicted) === room.code) {
      this.byPlayer.delete(change.evicted);
    }
    return change.ok;
  }

  leave(playerId: string): Room | undefined {
    const room = this.roomOfPlayer(playerId);
    this.byPlayer.delete(playerId);
    if (!room) return undefined;

    room.removeHuman(playerId);
    // An empty room has nobody to play for, even if bots are still standing.
    if (room.humanCount() === 0) this.destroy(room.code);
    return room;
  }

  destroy(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const playerId of room.humanIds()) this.byPlayer.delete(playerId);
    this.rooms.delete(code);
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  /** Idle rooms are garbage collected; a match in flight is never idle. */
  sweep(nowMs: number): string[] {
    const removed: string[] = [];
    for (const room of this.rooms.values()) {
      if (room.match !== null && !room.match.finished) continue;
      if (nowMs - room.lastActivityAt < CONFIG.ROOM_TTL_MS) continue;
      removed.push(room.code);
    }
    for (const code of removed) this.destroy(code);
    return removed;
  }
}
