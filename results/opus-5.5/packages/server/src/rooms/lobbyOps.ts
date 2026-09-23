// Lobby commands on a casual room: slot assignment (host), ready flags, match start and the
// post-match rematch vote. Rejections throw ClientError (sent back as `error`).
import { CONFIG } from '@splash/shared';
import type { Difficulty } from '@splash/shared';
import { ClientError } from '../net/errors';
import { makeBotSeat } from './bots';
import type { RoomHub } from './hub';
import type { Room } from './room';

function requireCasualLobby(room: Room): void {
  if (room.kind !== 'casual') throw new ClientError('invalid', 'This room is managed automatically.');
  if (room.phase !== 'lobby') throw new ClientError('room_in_match', 'The match has already started.');
}

function requireHost(room: Room, playerId: string): void {
  if (room.hostId !== playerId) throw new ClientError('not_host', 'Only the host can do that.');
}

/** Host sets a non-human seat to open, closed or a bot of some difficulty. */
export function setSlot(
  hub: RoomHub,
  room: Room,
  playerId: string,
  cmd: { slot: number; kind: 'open' | 'bot' | 'closed'; difficulty?: Difficulty },
  now: number,
): void {
  requireCasualLobby(room);
  requireHost(room, playerId);
  const current = room.seats[cmd.slot];
  if (!current) throw new ClientError('invalid', 'That slot does not exist in this room.');
  if (current.kind === 'human') throw new ClientError('invalid', 'That seat belongs to a player.');
  if (cmd.kind !== 'bot') {
    room.seats[cmd.slot] = { kind: cmd.kind };
  } else {
    const difficulty = cmd.difficulty ?? CONFIG.DISCONNECT_BOT_DIFFICULTY;
    room.seats[cmd.slot] = current.kind === 'bot' ? { ...current, difficulty, auto: false } : makeBotSeat(difficulty, room.botNames());
  }
  room.touch(now);
  hub.pushLobby(room);
  hub.listChanged(room);
}

export function setReady(hub: RoomHub, room: Room, playerId: string, ready: boolean, now: number): void {
  if (room.phase !== 'lobby') throw new ClientError('room_in_match', 'The match has already started.');
  const seat = room.human(room.slotOf(playerId));
  if (!seat) throw new ClientError('not_in_room', 'You are not seated in this room.');
  seat.ready = ready;
  room.touch(now);
  hub.pushLobby(room);
}

/** Bot fill: open seats get Medium bots for this match (they reopen back in the lobby). */
function fillOpenSeats(room: Room): void {
  if (!room.botFill) return;
  room.seats.forEach((seat, slot) => {
    if (seat.kind === 'open') room.seats[slot] = makeBotSeat(CONFIG.DISCONNECT_BOT_DIFFICULTY, room.botNames(), { auto: true });
  });
}

/** Host starts: every guest ready; bot fill seats Medium bots in open slots; at least 2 critters. */
export function requestStart(hub: RoomHub, room: Room, playerId: string, now: number): void {
  requireCasualLobby(room);
  requireHost(room, playerId);
  if (!room.allGuestsReady()) throw new ClientError('not_ready', 'Waiting for everyone to press ready.');
  fillOpenSeats(room);
  if (room.participantCount() < 2) {
    hub.pushLobby(room);
    throw new ClientError('not_ready', 'You need at least 2 critters: add a bot or wait for a friend.');
  }
  hub.startMatch(room, now);
}

/** After match_end: phase 'results' with an open rematch vote. Disconnected players lose their seat. */
export function enterResults(hub: RoomHub, room: Room, now: number): void {
  room.phase = 'results';
  room.runner = null;
  room.votes.clear();
  room.rematchDeadline = now + CONFIG.REMATCH_VOTE_MS;
  for (const slot of room.humanSlots()) {
    const seat = room.human(slot)!;
    if (seat.connected) continue;
    hub.release(room, seat.member.playerId);
    room.vacate(slot);
  }
  hub.pushLobby(room);
  hub.listChanged(room);
}

/** The rematch did not happen: lobby again, ready flags cleared, bot-filled seats open again. */
export function backToLobby(hub: RoomHub, room: Room, now: number): void {
  room.phase = 'lobby';
  room.votes.clear();
  room.rematchDeadline = 0;
  room.clearReady();
  room.reopenAutoSeats();
  room.touch(now);
  hub.pushLobby(room);
  hub.listChanged(room);
}

/**
 * Majority of connected humans voting yes restarts the room; once a majority is out of reach
 * (everyone voted, or too many said no) the room goes back to the lobby early.
 */
export function evaluateRematch(hub: RoomHub, room: Room, now: number): void {
  const voters = room.connectedHumanSlots();
  const yes = voters.filter((slot) => room.votes.get(slot) === true).length;
  const undecided = voters.filter((slot) => !room.votes.has(slot)).length;
  if (voters.length > 0 && yes * 2 > voters.length) restart(hub, room, now);
  else if (undecided === 0 || (yes + undecided) * 2 <= voters.length) backToLobby(hub, room, now);
  else hub.pushLobby(room);
}

/** Rematch with the same seats (bot fill applies again); too few critters left -> lobby. */
function restart(hub: RoomHub, room: Room, now: number): void {
  fillOpenSeats(room);
  if (room.participantCount() < 2) backToLobby(hub, room, now);
  else hub.startMatch(room, now);
}

export function voteRematch(hub: RoomHub, room: Room, playerId: string, yes: boolean, now: number): void {
  if (room.phase !== 'results') throw new ClientError('invalid', 'There is no rematch vote right now.');
  const slot = room.slotOf(playerId);
  if (slot < 0) throw new ClientError('not_in_room', 'You are not seated in this room.');
  room.votes.set(slot, yes);
  room.touch(now);
  evaluateRematch(hub, room, now);
}
