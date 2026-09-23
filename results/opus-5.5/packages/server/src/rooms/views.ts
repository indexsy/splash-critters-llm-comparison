// Wire views of a room: the per-recipient LobbyState, the public RoomSummary and the match roster.
import { CONFIG, tierFor } from '@splash/shared';
import type { LobbyState, RoomSummary, SlotView } from '@splash/shared';
import type { MatchParticipant } from '../match/types';
import { BOT_LEVEL, botParticipant } from './bots';
import { roomLink } from './codes';
import type { Room, Seat } from './room';

function slotView(room: Room, seat: Seat, slot: number): SlotView {
  switch (seat.kind) {
    case 'human':
      return {
        slot,
        kind: 'human',
        playerId: seat.member.playerId,
        name: seat.member.name,
        tag: seat.member.tag,
        animal: seat.member.animal,
        hat: seat.member.hat,
        level: seat.member.level,
        ready: seat.ready,
        connected: seat.connected,
        isHost: seat.member.playerId === room.hostId,
      };
    case 'bot':
      return {
        slot,
        kind: 'bot',
        name: seat.name,
        animal: seat.animal,
        hat: seat.hat,
        difficulty: seat.difficulty,
        level: BOT_LEVEL,
        ready: true,
        connected: true,
        isHost: false,
      };
    default:
      return { slot, kind: seat.kind, ready: false, connected: false, isHost: false };
  }
}

export function lobbyStateFor(room: Room, yourSlot: number): LobbyState {
  return {
    code: room.code,
    name: room.name,
    mode: room.mode,
    size: room.size,
    isPublic: room.isPublic,
    practice: room.kind === 'practice',
    theme: room.theme,
    roundsToWin: room.roundsToWin,
    botFill: room.botFill,
    phase: room.phase,
    slots: room.seats.map((seat, slot) => slotView(room, seat, slot)),
    hostSlot: room.hostSlot(),
    yourSlot,
    rematchVotes: [...room.votes].filter(([, yes]) => yes).map(([slot]) => slot).sort((a, b) => a - b),
    rematchDeadline: room.phase === 'results' ? Math.round(room.rematchDeadline) : 0,
    link: roomLink(room.code),
  };
}

export function roomSummary(room: Room): RoomSummary {
  const host = room.hostId ? room.human(room.hostSlot()) : null;
  return {
    code: room.code,
    name: room.name,
    mode: room.mode,
    players: room.participantCount(),
    maxPlayers: room.size - room.closedCount(),
    theme: room.theme,
    host: host ? `${host.member.name}#${host.member.tag}` : '',
    inMatch: room.phase !== 'lobby',
    joinable: room.phase === 'lobby' && room.firstOpenSlot() >= 0,
  };
}

/** The seated humans and bots as match participants (ranked rooms pass each human's rating). */
export function participantsOf(room: Room, ratingOf?: (playerId: string) => number): MatchParticipant[] {
  const list: MatchParticipant[] = [];
  room.seats.forEach((seat, slot) => {
    if (seat.kind === 'bot') list.push(botParticipant(slot, seat));
    if (seat.kind !== 'human') return;
    const { member } = seat;
    const p: MatchParticipant = {
      slot,
      playerId: member.playerId,
      name: member.name,
      tag: member.tag,
      animal: member.animal,
      hat: member.hat,
      level: member.level,
    };
    if (ratingOf) {
      p.rating = ratingOf(member.playerId);
      p.tier = tierFor(p.rating);
    }
    list.push(p);
  });
  return list;
}

/** Arena size for a room's mode. */
export function arenaOf(room: Room): { w: number; h: number } {
  const { w, h } = CONFIG.MODES[room.mode];
  return { w, h };
}
