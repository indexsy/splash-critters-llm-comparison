// Pure ranked-queue rules: what "Play Ranked" does from the menu, and which screen the queue
// screen should hand over to as the server's answers arrive. The server keeps a player in at
// most one queue and never in a queue and a room at once; these rules follow that.
import type { Mode } from '@splash/shared';
import type { AppState } from '../../store';

type QueueView = Pick<AppState, 'profile' | 'lobby' | 'queue' | 'matchFound'>;

export function otherMode(mode: Mode): Mode {
  return mode === 'duel' ? 'ffa' : 'duel';
}

/** The mode the player is already searching (or was just matched) in, if any. */
export function searchingMode(state: Pick<AppState, 'queue' | 'matchFound'>): Mode | null {
  return state.matchFound?.mode ?? state.queue?.mode ?? null;
}

export type RankedEntry =
  | { action: 'wait_connect' }
  | { action: 'view_queue'; mode: Mode }
  | { action: 'leave_room_first'; code: string }
  | { action: 'pick_nickname' }
  | { action: 'join' };

/** Menu "Play Ranked <mode>": what to do instead of (or before) sending queue_join. */
export function rankedEntry(state: QueueView, mode: Mode): RankedEntry {
  if (!state.profile) return { action: 'wait_connect' };
  const searching = searchingMode(state);
  if (searching) return { action: 'view_queue', mode: searching };
  if (state.lobby) return { action: 'leave_room_first', code: state.lobby.code };
  if (!state.profile.hasNickname) return { action: 'pick_nickname' };
  return { action: 'join' };
}

export function leaveRoomFirstText(code: string): string {
  return `You are in room ${code}. Leave it before playing ranked.`;
}

export type QueueFollow = { to: 'stay' } | { to: 'menu' } | { to: 'queue'; mode: Mode };

/**
 * The queue screen for `mode` after a store change (before any match was found): follow the
 * server to the other mode's queue, or back to the menu once it drops or refuses the search.
 * already_queued on this screen means the server holds the player in the other mode's queue.
 */
export function followQueue(next: Readonly<AppState>, prev: Readonly<AppState>, mode: Mode): QueueFollow {
  if (next.queue && next.queue.mode !== mode) return { to: 'queue', mode: next.queue.mode };
  if (next.queue) return { to: 'stay' };
  if (prev.queue !== null) return { to: 'menu' };
  const error = next.lastError !== prev.lastError ? next.lastError : null;
  if (!error) return { to: 'stay' };
  return error.code === 'already_queued' ? { to: 'queue', mode: otherMode(mode) } : { to: 'menu' };
}
