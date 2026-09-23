// Ranked queue messages. Queueing needs a claimed nickname and no room.
import { getRating } from '../db';
import { ClientError } from '../net/errors';
import type { Handler } from './context';
import { memberInfo } from './members';

export const handleQueueJoin: Handler<'queue_join'> = (ctx, { session, playerId, msg, now }) => {
  const member = memberInfo(ctx.db, playerId);
  if (!member.hasNickname) throw new ClientError('nickname_required', 'Pick a nickname before playing ranked.');
  ctx.rooms.releaseSandbox(playerId);
  if (ctx.rooms.roomOf(playerId)) throw new ClientError('already_in_room', 'Leave your room before queueing for ranked.');
  ctx.matchmaker.join(member, getRating(ctx.db, playerId, msg.mode).rating, msg.mode, now, session.address);
};

export const handleQueueLeave: Handler<'queue_leave'> = (ctx, { session, playerId }) => {
  ctx.matchmaker.leave(playerId);
  session.send({ type: 'queue_left' });
};
