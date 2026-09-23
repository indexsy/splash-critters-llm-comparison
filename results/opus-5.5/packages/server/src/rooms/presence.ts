// Who is still at the table: disconnect grace, bot take-over (casual), forfeits (ranked) and
// seat removal outside a match. All functions act on one room through the RoomHub.
import { CONFIG } from '@splash/shared';
import { botParticipant, makeBotSeat } from './bots';
import type { LeftReason, RoomHub } from './hub';
import { evaluateRematch } from './lobbyOps';
import type { Room } from './room';

function playerStatus(slot: number, flags: { connected: boolean; replacedByBot?: boolean; forfeited?: boolean }) {
  return {
    type: 'player_status' as const,
    slot,
    connected: flags.connected,
    replacedByBot: flags.replacedByBot === true,
    forfeited: flags.forfeited === true,
  };
}

/**
 * Mid-match disconnect: the seat idles for RECONNECT_GRACE_MS, counted from `since` (when the
 * player was last heard: a half-open socket is only noticed after the heartbeat timeout).
 */
export function markDisconnected(hub: RoomHub, room: Room, slot: number, since: number): void {
  const seat = room.human(slot);
  if (!seat) return;
  seat.connected = false;
  seat.graceUntil = since + CONFIG.RECONNECT_GRACE_MS;
  room.runner?.idle(slot);
  hub.broadcast(room, playerStatus(slot, { connected: false }));
  hub.pushLobby(room);
}

/**
 * The player is back within the grace period: they get lobby_state, then the match re-sync
 * (match_start, current round_start), and the table learns they are connected again.
 */
export function markReconnected(hub: RoomHub, room: Room, slot: number): void {
  const seat = room.human(slot);
  if (!seat) return;
  seat.connected = true;
  seat.graceUntil = 0;
  hub.pushLobby(room);
  if (room.runner?.resync(seat.member.playerId)) sendTableStatus(hub, room, seat.member.playerId, slot);
  hub.broadcast(room, playerStatus(slot, { connected: true }));
}

/**
 * A re-attached player missed every player_status sent while they were away: tell them which
 * other seats are disconnected, bot-played or forfeited so the HUD chips are right at once.
 */
function sendTableStatus(hub: RoomHub, room: Room, playerId: string, ownSlot: number): void {
  room.seats.forEach((seat, slot) => {
    if (slot === ownSlot) return;
    if (seat.kind === 'human' && (seat.forfeited || !seat.connected)) {
      hub.sendTo(playerId, playerStatus(slot, { connected: false, forfeited: seat.forfeited }));
    } else if (seat.kind === 'bot' && seat.replacedHuman) {
      hub.sendTo(playerId, playerStatus(slot, { connected: false, replacedByBot: true }));
    }
  });
}

/** Casual: a leaver's (or timed-out player's) slot is played by a Medium bot from now on. */
export function convertToBot(hub: RoomHub, room: Room, slot: number): void {
  const seat = room.human(slot);
  if (!seat) return;
  const bot = makeBotSeat(CONFIG.DISCONNECT_BOT_DIFFICULTY, room.botNames(), { auto: true, replacedHuman: true });
  room.seats[slot] = bot;
  if (room.hostId === seat.member.playerId) room.reassignHost();
  hub.release(room, seat.member.playerId);
  room.runner?.replaceWithBot(slot, botParticipant(slot, bot));
  hub.broadcast(room, playerStatus(slot, { connected: false, replacedByBot: true }));
  hub.pushLobby(room);
  hub.listChanged(room);
}

/** Ranked: the player forfeits (placed last, still rated); the match may end right here. */
export function forfeitSeat(hub: RoomHub, room: Room, slot: number, now: number): void {
  const seat = room.human(slot);
  if (!seat || seat.forfeited) return;
  seat.forfeited = true;
  seat.connected = false;
  seat.graceUntil = 0;
  if (room.hostId === seat.member.playerId) room.reassignHost();
  hub.release(room, seat.member.playerId);
  hub.broadcast(room, playerStatus(slot, { connected: false, forfeited: true }));
  hub.pushLobby(room);
  room.runner?.forfeit(slot, now);
}

/**
 * The match result is already settled (deciding round over): the player just goes. No bot takes
 * the seat and nothing is forfeited; their placement, XP and rating stand when the match ends.
 */
export function departSettledMatch(hub: RoomHub, room: Room, slot: number): void {
  const seat = room.human(slot);
  if (!seat) return;
  seat.connected = false;
  seat.graceUntil = 0;
  if (room.hostId === seat.member.playerId) room.reassignHost();
  hub.release(room, seat.member.playerId);
  room.runner?.release(slot);
  hub.broadcast(room, playerStatus(slot, { connected: false }));
  hub.pushLobby(room);
}

/**
 * A human leaves a running match for good (explicit leave, or the reconnect grace ran out).
 * Settled result -> they just go; otherwise a casual seat is taken over by a bot, a ranked seat
 * forfeits and a solo room (practice / tutorial) closes with `soloReason`.
 */
export function leaveRunningMatch(hub: RoomHub, room: Room, slot: number, now: number, soloReason: LeftReason | null): void {
  if (room.kind !== 'tutorial' && room.runner?.outcomeDecided) departSettledMatch(hub, room, slot);
  else if (room.kind === 'casual') convertToBot(hub, room, slot);
  else if (room.kind === 'ranked') forfeitSeat(hub, room, slot, now);
  else hub.dissolve(room, soloReason);
}

/** Outside a match a leaving (or disconnecting) player's seat is freed immediately. */
export function removeFromLobby(hub: RoomHub, room: Room, slot: number, now: number): void {
  const seat = room.human(slot);
  if (!seat) return;
  hub.release(room, seat.member.playerId);
  room.vacate(slot);
  room.touch(now);
  if (room.phase === 'results' && room.connectedHumanSlots().length > 0) evaluateRematch(hub, room, now);
  if (room.phase !== 'in_match') hub.pushLobby(room);
  hub.listChanged(room);
}

/**
 * Ends grace periods that ran out: casual seats become bots, ranked seats forfeit (which may end
 * the match and dissolve the room), a solo practice / tutorial room is closed. After the result
 * is settled the player is simply let go.
 */
export function expireGrace(hub: RoomHub, room: Room, now: number): void {
  for (const slot of room.humanSlots()) {
    if (!hub.isOpen(room)) return;
    const seat = room.human(slot)!;
    if (seat.connected || seat.graceUntil === 0 || now < seat.graceUntil) continue;
    leaveRunningMatch(hub, room, slot, now, 'closed');
  }
}
