// Pure room-browser rules: what each row's action slot shows and the list order.
import type { RoomSummary } from '@splash/shared';

/**
 * A row's action: JOIN for an open room, the pending "..." while this client's join for it is
 * in flight (kept even when that join is what just filled the room), else why it is closed.
 */
export type RoomAction = 'join' | 'pending' | 'in_match' | 'full';

export function isRoomOpen(room: RoomSummary): boolean {
  return room.joinable && !room.inMatch && room.players < room.maxPlayers;
}

export function roomAction(room: RoomSummary, pendingCode: string | null): RoomAction {
  if (pendingCode !== null && room.code === pendingCode) return 'pending';
  if (room.inMatch) return 'in_match';
  return isRoomOpen(room) ? 'join' : 'full';
}

/** Joinable rooms first, then running matches, then full rooms (server order kept within). */
export function sortRooms(rooms: readonly RoomSummary[]): RoomSummary[] {
  const rank = (r: RoomSummary) => (isRoomOpen(r) ? 0 : r.inMatch ? 1 : 2);
  return [...rooms].sort((a, b) => rank(a) - rank(b));
}
