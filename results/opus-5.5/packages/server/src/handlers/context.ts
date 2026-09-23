// Everything a message handler can reach, plus the shared "player went offline" cleanup.
import type { C2S, C2SType, MsgOf } from '@splash/shared';
import type { Db } from '../db';
import type { Matchmaker } from '../matchmaker';
import type { Admission } from '../net/admission';
import type { SessionRegistry } from '../net/registry';
import type { RoomCodeGuard } from '../net/roomCodes';
import type { RoomManager } from '../rooms';
import type { Session } from '../session';

export interface ServerContext {
  db: Db;
  sessions: SessionRegistry;
  rooms: RoomManager;
  matchmaker: Matchmaker;
  admission: Admission;
  /** Wrong-room-code budget per player and address (join_room). */
  roomCodes: RoomCodeGuard;
  clock: () => number;
}

/** One validated message from an identified player. */
export interface Request<T extends C2SType> {
  session: Session;
  playerId: string;
  msg: MsgOf<C2S, T>;
  now: number;
}

export type Handler<T extends C2SType> = (ctx: ServerContext, req: Request<T>) => void;

/**
 * The player's live socket is gone (closed or taken over): leave the queue, idle or free the
 * seat. `since` is when they were last heard (earlier than `now` for a silently dropped socket).
 */
export function playerGone(ctx: ServerContext, playerId: string, now: number, since: number = now): void {
  ctx.matchmaker.leave(playerId);
  ctx.rooms.disconnected(playerId, now, since);
}
