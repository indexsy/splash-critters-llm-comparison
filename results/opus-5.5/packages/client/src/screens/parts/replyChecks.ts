// When a dialog's room request has succeeded, judged on the store transition the server's answer
// causes. Each check needs a change this request brought about, never a state that merely still
// holds: store.match outlives a finished match and store.lobby outlives a trip to the menu.
import type { AppState } from '../../store';

export type ReplyCheck = (next: Readonly<AppState>, prev: Readonly<AppState>) => boolean;

/** create_room: the lobby of a room other than the one we were in (usually none) arrived. */
export const enteredNewRoom: ReplyCheck = (next, prev) => next.lobby !== null && next.lobby.code !== prev.lobby?.code;

/** join_room `code`: that room's lobby arrived (joining the room you already sit in re-sends it). */
export function receivedLobbyOf(code: string): ReplyCheck {
  return (next, prev) => next.lobby !== null && next.lobby !== prev.lobby && next.lobby.code === code;
}

/** Practice create_room: the practice room's lobby or its match_start arrived. */
export const startedPractice: ReplyCheck = (next, prev) =>
  enteredNewRoom(next, prev) || (next.match !== null && next.match !== prev.match);
