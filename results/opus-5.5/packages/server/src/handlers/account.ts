// Identity messages: hello (login / guest creation, session takeover, match re-attach),
// nickname and cosmetics changes, pong.
import { CONFIG } from '@splash/shared';
import type { C2S, MsgOf } from '@splash/shared';
import { buildProfile, claimNickname, hashToken, loginOrCreate, setCosmetics, validateToken } from '../accounts';
import { findPlayerByTokenHash, type Db } from '../db';
import { ClientError, errorMessage } from '../net/errors';
import { CLOSE_POLICY, CLOSE_REPLACED, CLOSE_TRY_AGAIN, type Session } from '../session';
import { playerGone, type Handler, type ServerContext } from './context';
import { memberInfo } from './members';

/** True when the token belongs to an existing player (so logging in creates no account). */
function isKnownToken(db: Db, token: string | undefined): boolean {
  return validateToken(token) && findPlayerByTokenHash(db, hashToken(token)) !== null;
}

/**
 * First message on every socket. Version mismatch -> error bad_version + close. Otherwise logs in
 * (or creates a guest, rate-limited per address), takes over any older socket of the same player,
 * sends welcome and, when the player's match is still running, re-attaches them (lobby_state,
 * match_start, round_start).
 */
export function handleHello(ctx: ServerContext, session: Session, msg: MsgOf<C2S, 'hello'>, now: number): void {
  if (session.playerId) throw new ClientError('bad_message', 'Already signed in on this connection.');
  if (msg.v !== CONFIG.PROTOCOL_VERSION) {
    session.send(errorMessage('bad_version', 'A new version of the game is out. Please reload the page.'));
    session.close(CLOSE_POLICY, 'Protocol version mismatch');
    return;
  }
  if (!isKnownToken(ctx.db, msg.token) && !ctx.admission.allowGuest(session.address, now)) {
    session.send(errorMessage('rate_limited', 'Too many new players from your network right now. Please try again later.'));
    session.close(CLOSE_TRY_AGAIN, 'Too many new accounts');
    return;
  }
  const { player, token } = loginOrCreate(ctx.db, msg.token);
  const previous = ctx.sessions.sessionOf(player.id);
  if (previous && previous !== session) {
    previous.superseded = true;
    playerGone(ctx, player.id, now);
    previous.close(CLOSE_REPLACED, 'Signed in from another connection');
  }
  ctx.sessions.bind(player.id, session);
  session.identify(player.id, now);
  session.send({ type: 'welcome', playerId: player.id, profile: buildProfile(ctx.db, player.id), token, serverTime: Math.round(now) });
  ctx.rooms.reattach(player.id, now);
}

export const handleSetNickname: Handler<'set_nickname'> = (ctx, { session, playerId, msg }) => {
  const profile = claimNickname(ctx.db, playerId, msg.nickname);
  session.send({ type: 'profile', profile });
  ctx.rooms.refreshMember(memberInfo(ctx.db, playerId));
};

export const handleSetCosmetics: Handler<'set_cosmetics'> = (ctx, { session, playerId, msg }) => {
  const profile = setCosmetics(ctx.db, playerId, msg.animal, msg.hat);
  session.send({ type: 'profile', profile });
  ctx.rooms.refreshMember(memberInfo(ctx.db, playerId));
};

export const handlePong: Handler<'pong'> = (_ctx, { session, msg, now }) => {
  session.notePong(msg.t, now);
};
