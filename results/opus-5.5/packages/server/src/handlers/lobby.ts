// Room messages: create / join / leave, host slot control, ready, start, rematch votes and the
// public room list. Room rules live in RoomManager; these only orchestrate.
import { ClientError, errorMessage } from '../net/errors';
import { CLOSE_POLICY, type Session } from '../session';
import type { Handler, ServerContext } from './context';
import { memberInfo } from './members';

/** Rooms and the ranked queue are exclusive; a finished or abandoned tutorial sandbox is closed first. */
export function prepareForActivity(ctx: ServerContext, playerId: string): void {
  if (ctx.matchmaker.modeOf(playerId)) throw new ClientError('already_queued', 'Leave the ranked queue first.');
  ctx.rooms.releaseSandbox(playerId);
}

export const handleCreateRoom: Handler<'create_room'> = (ctx, { playerId, msg, now }) => {
  prepareForActivity(ctx, playerId);
  ctx.rooms.create(memberInfo(ctx.db, playerId), msg.opts, now);
};

/**
 * False (already answered) while the player or their address spent the wrong-code budget: the
 * code is not looked up. A player who keeps trying anyway is disconnected (1008).
 */
function roomCodeAdmitted(ctx: ServerContext, session: Session, playerId: string, now: number): boolean {
  const verdict = ctx.roomCodes.admit(playerId, session.address, now);
  if (verdict === 'ok') return true;
  session.send(errorMessage('rate_limited', 'Too many wrong room codes. Wait a minute, then try again.'));
  if (verdict === 'abuse') session.close(CLOSE_POLICY, 'Too many wrong room codes');
  return false;
}

export const handleJoinRoom: Handler<'join_room'> = (ctx, { session, playerId, msg, now }) => {
  // Re-joining the room you are in reveals nothing and costs nothing.
  const guessing = ctx.rooms.roomOf(playerId)?.code !== msg.code;
  if (guessing && !roomCodeAdmitted(ctx, session, playerId, now)) return;
  prepareForActivity(ctx, playerId);
  try {
    ctx.rooms.join(memberInfo(ctx.db, playerId), msg.code, now);
  } catch (err) {
    if (err instanceof ClientError && err.code === 'not_found') ctx.roomCodes.miss(playerId, session.address, now);
    throw err;
  }
};

export const handleLeaveRoom: Handler<'leave_room'> = (ctx, { playerId, now }) => {
  ctx.rooms.leave(playerId, now);
};

export const handleSetSlot: Handler<'set_slot'> = (ctx, { playerId, msg, now }) => {
  ctx.rooms.setSlot(playerId, { slot: msg.slot, kind: msg.kind, difficulty: msg.difficulty }, now);
};

export const handleSetReady: Handler<'set_ready'> = (ctx, { playerId, msg, now }) => {
  ctx.rooms.setReady(playerId, msg.ready, now);
};

export const handleStartMatch: Handler<'start_match'> = (ctx, { playerId, now }) => {
  ctx.rooms.start(playerId, now);
};

export const handleRematchVote: Handler<'rematch_vote'> = (ctx, { playerId, msg, now }) => {
  ctx.rooms.rematchVote(playerId, msg.yes, now);
};

export const handleRoomListRequest: Handler<'room_list_request'> = (ctx, { session, msg }) => {
  session.send({ type: 'room_list', rooms: ctx.rooms.list(msg.mode) });
};

export const handleRoomListWatch: Handler<'room_list_watch'> = (ctx, { playerId, msg }) => {
  ctx.rooms.watchList(playerId, msg.on);
};
