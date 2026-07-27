/**
 * What each client message means.
 *
 * Every handler assumes its message has already been validated by
 * protocolGuards, and re-checks authority instead: are you the host, are you in
 * this room, is this room even playing. Anything refused gets an `error` back
 * and changes nothing.
 */

import {
  validateNickname,
  type AnimalId,
  type BotDifficulty,
  type ClientMessage,
  type CreateRoomOpts,
  type GameMode,
  type HatId,
} from '@splash/shared';
import type { Client, Hub } from './net.js';
import type { Room } from './room.js';

/** Ranked is open to everyone; the nickname just has to be a real one. */
const RANKED_NICKNAME_HINT = 'Pick a nickname before playing ranked.';

export function dispatch(hub: Hub, client: Client, msg: ClientMessage): void {
  if (msg.t === 'hello') {
    onHello(hub, client, msg.token);
    return;
  }

  const playerId = client.playerId;
  if (playerId === null) {
    hub.sendError(client, 'not_authenticated', 'Say hello first.');
    return;
  }

  switch (msg.t) {
    case 'set_nickname':
      onSetNickname(hub, client, playerId, msg.nickname);
      return;
    case 'set_cosmetics':
      onSetCosmetics(hub, client, playerId, msg.animal, msg.hat);
      return;
    case 'set_tutorial_done':
      hub.players.setTutorialDone(playerId);
      sendProfile(hub, client, playerId);
      return;
    case 'queue_join':
      onQueueJoin(hub, client, playerId, msg.mode);
      return;
    case 'queue_leave':
      onQueueLeave(hub, client, playerId);
      return;
    case 'create_room':
      onCreateRoom(hub, client, playerId, msg.opts);
      return;
    case 'join_room':
      onJoinRoom(hub, client, playerId, msg.code);
      return;
    case 'room_list_request':
      hub.sendToSocketClient(client, { t: 'room_list', rooms: hub.rooms.listSummaries(msg.mode) });
      return;
    case 'leave_room':
      onLeaveRoom(hub, client, playerId);
      return;
    case 'set_slot':
      onSetSlot(hub, client, playerId, msg.slot, msg.kind, msg.difficulty);
      return;
    case 'set_ready':
      onSetReady(hub, client, playerId, msg.ready);
      return;
    case 'start_match':
      onStartMatch(hub, client, playerId);
      return;
    case 'input':
      onInput(hub, client, playerId, msg);
      return;
    case 'emote':
      onEmote(hub, client, playerId, msg.id);
      return;
    case 'rematch_vote':
      onRematchVote(hub, client, playerId, msg.vote);
      return;
    case 'pong':
      client.alive = true;
      client.missedPongs = 0;
      client.latencyMs = Math.max(0, Math.min(5000, Date.now() - msg.time));
      return;
  }
}

// ------------------------------------------------------------------- account

function onHello(hub: Hub, client: Client, token: string | undefined): void {
  if (client.playerId !== null) {
    hub.sendError(client, 'bad_message', 'You are already signed in.');
    return;
  }

  // A hello with no usable token mints a permanent account, so it is the one
  // place a brake belongs. Returning players are never held up by it.
  if (hub.players.getByToken(token) === null && !hub.guestLimiter.allow(client.address)) {
    hub.sendError(client, 'rate_limited', 'Too many new critters from here. Try again later.');
    return;
  }

  const auth = hub.players.authenticate(token);
  const profile = hub.players.getProfile(auth.record.id);
  if (profile === null) {
    hub.sendError(client, 'server_error', 'Could not load your profile.');
    return;
  }
  hub.bindPlayer(client, auth.record.id);

  const room = hub.rooms.roomOfPlayer(auth.record.id);
  client.roomCode = room?.code ?? null;
  hub.sendToSocketClient(client, {
    t: 'welcome',
    playerId: auth.record.id,
    token: auth.token,
    profile,
    activeRoom: room?.code ?? null,
    serverTime: Date.now(),
  });

  if (room !== undefined) resume(hub, client, room, auth.record.id);
}

/** A refreshed tab picks its seat back up exactly where it left it. */
function resume(hub: Hub, client: Client, room: Room, playerId: string): void {
  const slot = room.slotOfPlayer(playerId);
  if (slot < 0) return;

  const occupant = room.slots[slot];
  if (occupant.kind === 'human') {
    occupant.connected = true;
    occupant.disconnectedAt = null;
  }
  client.lastInputSeq = 0;
  room.touch(Date.now());

  const record = hub.players.getById(playerId);
  hub.broadcastRoom(room, {
    t: 'notice',
    kind: 'reconnect',
    msg: `${record?.nickname ?? 'A critter'} is back.`,
  });
  hub.broadcastLobby(room);

  const match = room.match;
  if (room.phase === 'match' && match !== null && !match.finished) match.resync(slot);
}

function onSetNickname(hub: Hub, client: Client, playerId: string, nickname: string): void {
  const result = hub.players.setNickname(playerId, nickname);
  if (!result.ok) {
    hub.sendError(client, result.code ?? 'nickname_invalid', result.msg ?? 'Try another nickname.');
    return;
  }
  sendProfile(hub, client, playerId);
  refreshLobbyOf(hub, playerId);
}

function onSetCosmetics(
  hub: Hub,
  client: Client,
  playerId: string,
  animal: AnimalId,
  hat: HatId,
): void {
  if (hub.players.setCosmetics(playerId, animal, hat) === null) {
    hub.sendError(client, 'server_error', 'Could not save that look.');
    return;
  }
  sendProfile(hub, client, playerId);
  refreshLobbyOf(hub, playerId);
}

function sendProfile(hub: Hub, client: Client, playerId: string): void {
  const profile = hub.players.getProfile(playerId);
  if (profile !== null) hub.sendToSocketClient(client, { t: 'profile_update', profile });
}

// ------------------------------------------------------------------ matchmaking

function onQueueJoin(hub: Hub, client: Client, playerId: string, mode: GameMode): void {
  const record = hub.players.getById(playerId);
  if (record === null) {
    hub.sendError(client, 'server_error', 'Could not find your account.');
    return;
  }
  // Guests are welcome in ranked; the name they carry has to be a legal one,
  // which is the honest version of "have you chosen a nickname".
  const check = validateNickname(record.nickname);
  if (!check.ok) {
    hub.sendError(client, 'nickname_required', check.reason ?? RANKED_NICKNAME_HINT);
    return;
  }

  leaveCurrentRoom(hub, client, playerId);
  const result = hub.matchmaker.join(playerId, mode);
  if (!result.ok) {
    hub.sendError(client, result.error ?? 'server_error', 'You are already in a queue.');
  }
}

function onQueueLeave(hub: Hub, client: Client, playerId: string): void {
  if (!hub.matchmaker.isQueued(playerId)) {
    hub.sendError(client, 'not_queued', 'You are not in a queue.');
    return;
  }
  hub.matchmaker.leave(playerId);
  hub.sendToSocketClient(client, { t: 'notice', kind: 'info', msg: 'Left the queue.' });
}

// ------------------------------------------------------------------- rooms

function onCreateRoom(
  hub: Hub,
  client: Client,
  playerId: string,
  opts: CreateRoomOpts,
): void {
  hub.matchmaker.leave(playerId);
  leaveCurrentRoom(hub, client, playerId);

  const room = hub.rooms.create(opts, playerId, false);
  client.roomCode = room.code;
  hub.sendToSocketClient(client, { t: 'room_created', code: room.code });
  hub.broadcastLobby(room);

  // Practice and tutorial rooms have no lobby to wait in.
  if (room.autoStart && !hub.startMatch(room)) {
    hub.sendError(client, 'invalid_option', 'That room could not start a match.');
  }
}

function onJoinRoom(hub: Hub, client: Client, playerId: string, code: string): void {
  hub.matchmaker.leave(playerId);

  const target = hub.rooms.get(code);
  if (target === undefined) {
    hub.sendError(client, 'room_not_found', 'No room with that code.');
    return;
  }
  const current = hub.rooms.roomOfPlayer(playerId);
  if (current !== undefined && current.code !== target.code) {
    leaveCurrentRoom(hub, client, playerId);
  }

  const result = hub.rooms.join(target.code, playerId);
  if (result.room === undefined) {
    hub.sendError(client, result.error ?? 'room_not_found', 'Could not join that room.');
    return;
  }
  client.roomCode = result.room.code;
  hub.broadcastLobby(result.room);
}

function onLeaveRoom(hub: Hub, client: Client, playerId: string): void {
  if (hub.rooms.roomOfPlayer(playerId) === undefined) {
    hub.sendError(client, 'not_in_room', 'You are not in a room.');
    return;
  }
  leaveCurrentRoom(hub, client, playerId);
}

function onSetSlot(
  hub: Hub,
  client: Client,
  playerId: string,
  slot: number,
  kind: 'open' | 'bot',
  difficulty: BotDifficulty | undefined,
): void {
  const room = requireRoom(hub, client, playerId);
  if (room === null) return;
  if (room.hostPlayerId !== playerId) {
    hub.sendError(client, 'not_host', 'Only the host can change seats.');
    return;
  }
  if (room.phase !== 'lobby') {
    hub.sendError(client, 'room_in_progress', 'The match has already started.');
    return;
  }
  if (!hub.rooms.setSlot(room, slot, kind, difficulty)) {
    hub.sendError(client, 'invalid_slot', 'That seat cannot be changed.');
    return;
  }
  hub.broadcastLobby(room);
}

function onSetReady(hub: Hub, client: Client, playerId: string, ready: boolean): void {
  const room = requireRoom(hub, client, playerId);
  if (room === null) return;
  if (ready) room.ready.add(playerId);
  else room.ready.delete(playerId);
  hub.broadcastLobby(room);
}

function onStartMatch(hub: Hub, client: Client, playerId: string): void {
  const room = requireRoom(hub, client, playerId);
  if (room === null) return;
  if (room.hostPlayerId !== playerId) {
    hub.sendError(client, 'not_host', 'Only the host can start the match.');
    return;
  }
  if (!room.canStart() || !hub.startMatch(room)) {
    hub.sendError(client, 'invalid_option', 'Two critters are needed to start.');
  }
}

// ------------------------------------------------------------------ in-match

function onInput(
  hub: Hub,
  client: Client,
  playerId: string,
  msg: Extract<ClientMessage, { t: 'input' }>,
): void {
  const room = hub.rooms.roomOfPlayer(playerId);
  const match = room?.match;
  if (room === undefined || match === null || match === undefined || match.finished) return;
  const slot = room.slotOfPlayer(playerId);
  if (slot < 0) return;

  // Late-arriving duplicates would rewind the acknowledgement the client is
  // reconciling against, so anything not newer is dropped.
  if (msg.seq > 0 && msg.seq <= client.lastInputSeq) return;
  client.lastInputSeq = Math.max(client.lastInputSeq, msg.seq);
  room.touch(Date.now());

  match.setInput(slot, {
    seq: msg.seq,
    tick: msg.tick,
    dir: msg.dir,
    balloonPressed: msg.balloonPressed,
  });
}

function onEmote(hub: Hub, client: Client, playerId: string, id: number): void {
  const room = requireRoom(hub, client, playerId);
  if (room === null) return;
  const match = room.match;
  if (match === null || match.finished) return;
  const slot = room.slotOfPlayer(playerId);
  // The sim owns the cooldown, so a refusal here is simply nothing happening.
  if (slot >= 0) match.emote(slot, id);
}

function onRematchVote(hub: Hub, client: Client, playerId: string, vote: boolean): void {
  const room = requireRoom(hub, client, playerId);
  if (room === null) return;
  if (room.ranked || room.tutorial) {
    hub.sendError(client, 'invalid_option', 'This room does not do rematches.');
    return;
  }
  if (room.phase === 'match') {
    hub.sendError(client, 'room_in_progress', 'The match is still running.');
    return;
  }
  // A rematch is a vote on a match that finished. In the lobby the same
  // threshold would start the match out from under the host, who is the only
  // one allowed to do that.
  if (room.phase !== 'results') {
    hub.sendError(client, 'invalid_option', 'There is no finished match to rematch.');
    return;
  }

  if (vote) room.rematchVotes.add(playerId);
  else room.rematchVotes.delete(playerId);

  const humans = room.humanIds();
  const needed = Math.floor(humans.length / 2) + 1;
  const votes = room.rematchVotes.size;
  for (const id of humans) {
    hub.send(id, { t: 'rematch_state', votes, needed, youVoted: room.rematchVotes.has(id) });
  }
  if (votes < needed) return;

  // Same room, same seats, fresh scoreboard.
  room.phase = 'lobby';
  room.match = null;
  if (!hub.startMatch(room)) {
    room.rematchVotes.clear();
    hub.broadcastLobby(room);
  }
}

// ------------------------------------------------------------------- helpers

function requireRoom(hub: Hub, client: Client, playerId: string): Room | null {
  const room = hub.rooms.roomOfPlayer(playerId);
  // Membership is the seat, not the bookkeeping: someone whose seat was given
  // away speaks for nobody, however they still show up in the index.
  if (room === undefined || room.slotOfPlayer(playerId) < 0) {
    hub.sendError(client, 'not_in_room', 'You are not in a room.');
    return null;
  }
  room.touch(Date.now());
  return room;
}

function refreshLobbyOf(hub: Hub, playerId: string): void {
  const room = hub.rooms.roomOfPlayer(playerId);
  if (room !== undefined) hub.broadcastLobby(room);
}

/**
 * Someone stopped playing mid-match. Ranked treats it as a forfeit; casual
 * hands the critter to a bot so the round is still worth finishing. Shared with
 * the game loop, which applies the same rules when a grace period runs out.
 */
export function releaseSlot(hub: Hub, room: Room, slot: number): void {
  const match = room.match;
  if (room.phase !== 'match' || match === null || match.finished) return;

  const occupant = room.slots[slot];
  const name =
    occupant !== undefined && occupant.kind === 'human'
      ? (hub.players.getById(occupant.playerId)?.nickname ?? 'A critter')
      : 'A critter';

  if (room.ranked) {
    match.forfeit(slot);
    hub.broadcastRoom(room, { t: 'notice', kind: 'forfeit', msg: `${name} forfeited.` });
    return;
  }
  match.substituteBot(slot, 'medium');
  hub.broadcastRoom(room, {
    t: 'notice',
    kind: 'bot_substitute',
    msg: `${name} dropped out. A bot is filling in.`,
  });
}

function leaveCurrentRoom(hub: Hub, client: Client, playerId: string): void {
  const room = hub.rooms.roomOfPlayer(playerId);
  if (room === undefined) return;

  const slot = room.slotOfPlayer(playerId);
  if (slot >= 0) releaseSlot(hub, room, slot);
  hub.rooms.leave(playerId);
  client.roomCode = null;
  hub.broadcastLobby(room);
}
