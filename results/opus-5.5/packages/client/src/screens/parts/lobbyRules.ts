// Pure lobby rules the lobby and results screens display (the server enforces the same ones).
import type { LobbyState, SlotView } from '@splash/shared';
import { rematchNeeded } from './format';

/** Players who will take part if the match started now (open slots count when bots fill them). */
export function participantCount(lobby: LobbyState): number {
  return lobby.slots.filter((s) => s.kind === 'human' || s.kind === 'bot' || (lobby.botFill && s.kind === 'open')).length;
}

/** Humans other than the host who still have to press READY. */
function unreadyGuests(lobby: LobbyState): SlotView[] {
  return lobby.slots.filter((s) => s.kind === 'human' && !s.isHost && !s.ready);
}

/**
 * Why the host cannot start yet, or null when the match is startable:
 * at least 2 participants and every non-host human ready.
 */
export function startBlocker(lobby: LobbyState): string | null {
  if (lobby.phase !== 'lobby') return 'Match already running';
  if (participantCount(lobby) < 2) return 'Add a bot or wait for a player';
  const waiting = unreadyGuests(lobby);
  if (waiting.length === 1) return `Waiting for ${waiting[0].name ?? 'a player'} to ready up`;
  if (waiting.length > 1) return `Waiting for ${waiting.length} players to ready up`;
  return null;
}

export interface RematchTally {
  votes: number;
  needed: number;
  youVoted: boolean;
}

/** Live rematch vote count against the majority of connected humans. */
export function rematchTally(lobby: LobbyState): RematchTally {
  const humans = lobby.slots.filter((s) => s.kind === 'human' && s.connected).length;
  return {
    votes: lobby.rematchVotes.length,
    needed: rematchNeeded(humans),
    youVoted: lobby.rematchVotes.includes(lobby.yourSlot),
  };
}

/** The local player's own slot view, if seated. */
export function mySlot(lobby: LobbyState): SlotView | undefined {
  return lobby.slots.find((s) => s.slot === lobby.yourSlot);
}

export function isHost(lobby: LobbyState): boolean {
  return lobby.hostSlot === lobby.yourSlot;
}
