/**
 * Room registry: create / join / list public rooms, run ranked hidden rooms,
 * tick every active match, and GC idle rooms.
 */

import type { CreateRoomOpts, Mode, RoomListItem } from '@splash/shared';
import type { ServerContext } from './context';
import type { Client } from './net';
import { Room } from './room';
import { roomCode } from './util';

export class RoomManager {
  private ctx: ServerContext;
  rooms = new Map<string, Room>();

  constructor(ctx: ServerContext) {
    this.ctx = ctx;
  }

  private uniqueCode(): string {
    let code = roomCode();
    while (this.rooms.has(code)) code = roomCode();
    return code;
  }

  create(opts: CreateRoomOpts, host: Client, ranked = false, practice = false): Room {
    const code = this.uniqueCode();
    const room = new Room(code, this.ctx, opts, host.id, ranked, practice);
    this.rooms.set(code, room);
    room.addClient(host, true);
    return room;
  }

  createRankedRoom(mode: Mode, host: Client): Room {
    const opts: CreateRoomOpts = {
      name: 'Ranked Match',
      mode,
      isPublic: false,
      theme: 'random',
      roundsToWin: 3,
      botFill: false,
    };
    return this.create(opts, host, true, false);
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  join(client: Client, code: string): { ok: boolean; room?: Room; error?: string } {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'no_room' };
    if (room.phase === 'in_match') return { ok: false, error: 'in_match' };
    if (!room.addClient(client)) return { ok: false, error: 'room_full' };
    return { ok: true, room };
  }

  findRoomForPlayer(playerId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.slots.some((s) => s.playerId === playerId || s.client?.id === playerId)) return room;
    }
    return undefined;
  }

  publicList(mode?: Mode | 'all'): RoomListItem[] {
    const out: RoomListItem[] = [];
    for (const room of this.rooms.values()) {
      if (!room.opts.isPublic || room.ranked || room.practice) continue;
      if (mode && mode !== 'all' && room.mode !== mode) continue;
      out.push(room.listItem());
    }
    return out.sort((a, b) => Number(a.inProgress) - Number(b.inProgress) || b.players - a.players);
  }

  tickAll(globalTick: number, wallMs: number): void {
    for (const room of this.rooms.values()) room.tick(globalTick, wallMs);
  }

  gc(nowMs: number): void {
    for (const [code, room] of this.rooms) {
      if (room.isIdle(nowMs)) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }

  remove(code: string): void {
    const room = this.rooms.get(code);
    if (room) {
      room.dispose();
      this.rooms.delete(code);
    }
  }
}
