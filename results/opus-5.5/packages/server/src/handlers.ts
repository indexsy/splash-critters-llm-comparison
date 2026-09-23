// Socket wiring and message dispatch. Every inbound message is rate-limited, (optionally delayed
// by DEV_LAG_MS), validated, then routed to its handler; rejected requests become `error`
// messages, anything unexpected is logged and answered with server_error.
import type { C2S, C2SType, S2C } from '@splash/shared';
import { AccountError } from './accounts';
import { handleHello, handlePong, handleSetCosmetics, handleSetNickname } from './handlers/account';
import { playerGone, type Handler, type Request, type ServerContext } from './handlers/context';
import {
  handleCreateRoom,
  handleJoinRoom,
  handleLeaveRoom,
  handleRematchVote,
  handleRoomListRequest,
  handleRoomListWatch,
  handleSetReady,
  handleSetSlot,
  handleStartMatch,
} from './handlers/lobby';
import { handleEmote, handleInput, handleTutorialSkip, handleTutorialStart } from './handlers/play';
import { handleQueueJoin, handleQueueLeave } from './handlers/queue';
import { DelayLine } from './lag';
import { createSender, parseClientMessage, type SocketLike } from './net';
import { ClientError, errorMessage } from './net/errors';
import { CLOSE_POLICY, CLOSE_TRY_AGAIN, Session } from './session';

type PlayerMessageType = Exclude<C2SType, 'hello'>;

const HANDLERS: { [T in PlayerMessageType]: Handler<T> } = {
  set_nickname: handleSetNickname,
  set_cosmetics: handleSetCosmetics,
  tutorial_start: handleTutorialStart,
  tutorial_skip: handleTutorialSkip,
  queue_join: handleQueueJoin,
  queue_leave: handleQueueLeave,
  create_room: handleCreateRoom,
  join_room: handleJoinRoom,
  room_list_request: handleRoomListRequest,
  room_list_watch: handleRoomListWatch,
  leave_room: handleLeaveRoom,
  set_slot: handleSetSlot,
  set_ready: handleSetReady,
  start_match: handleStartMatch,
  input: handleInput,
  emote: handleEmote,
  rematch_vote: handleRematchVote,
  pong: handlePong,
};

function toErrorMessage(err: unknown): S2C {
  if (err instanceof ClientError || err instanceof AccountError) return errorMessage(err.code, err.message);
  console.error('[handlers] unexpected error', err);
  return errorMessage('server_error', 'Something went wrong on our side. Please try again.');
}

/** Routes one validated message. `hello` must come first; everything else needs an identified player. */
function dispatch(ctx: ServerContext, session: Session, msg: C2S, now: number): void {
  try {
    if (msg.type === 'hello') {
      handleHello(ctx, session, msg, now);
      return;
    }
    if (!session.playerId) throw new ClientError('not_ready', 'Say hello first.');
    const handler = HANDLERS[msg.type] as Handler<PlayerMessageType>;
    handler(ctx, { session, playerId: session.playerId, msg, now } as Request<PlayerMessageType>);
  } catch (err) {
    session.send(toErrorMessage(err));
  }
}

function receive(ctx: ServerContext, session: Session, data: unknown): void {
  const now = ctx.clock();
  const msg = parseClientMessage(data);
  if (msg) dispatch(ctx, session, msg, now);
  else if (session.shouldNotify(now)) session.send(errorMessage('bad_message', 'That message was not understood.'));
}

function closed(ctx: ServerContext, session: Session): void {
  const wasCurrent = ctx.sessions.remove(session);
  if (!wasCurrent || !session.playerId || session.superseded) return;
  const now = ctx.clock();
  playerGone(ctx, session.playerId, now, session.goneSince(now));
}

/** The events of a `ws` socket the server listens to. */
export interface SocketEvents extends SocketLike {
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

export interface ConnectionInfo {
  /** DEV_LAG_MS. */
  lagMs: number;
  /** The client address (clientAddress), null when it cannot be told apart from others. */
  address: string | null;
}

/**
 * Wires a freshly accepted socket: one Session, rate limiting, lag-ordered inbound processing.
 * An address already holding too many sockets is turned away (error + close 1013): null.
 */
export function acceptConnection(ctx: ServerContext, socket: SocketEvents, info: ConnectionInfo): Session | null {
  const { lagMs, address } = info;
  if (!ctx.admission.openSocket(address)) {
    socket.on('error', () => undefined);
    const refusal = createSender(socket, lagMs);
    refusal.send(errorMessage('rate_limited', 'Too many connections from your network. Close a few game tabs and try again.'));
    refusal.close(CLOSE_TRY_AGAIN, 'Too many connections');
    return null;
  }
  socket.on('close', () => ctx.admission.closeSocket(address));
  const session = new Session(socket, ctx.clock(), lagMs, address);
  const inbound = new DelayLine(lagMs);
  ctx.sessions.add(session);
  socket.on('message', (data, isBinary) => {
    const now = ctx.clock();
    const verdict = session.admit(now);
    if (verdict === 'abuse') {
      session.close(CLOSE_POLICY, 'Too many messages');
      return;
    }
    if (verdict === 'limited') {
      if (session.shouldNotify(now)) session.send(errorMessage('rate_limited', 'Slow down: too many messages.'));
      return;
    }
    inbound.push(() => receive(ctx, session, isBinary ? null : data));
  });
  socket.on('close', () => inbound.push(() => closed(ctx, session)));
  socket.on('error', (err) => console.warn(`[ws] socket ${session.id} error: ${err.message}`));
  return session;
}
