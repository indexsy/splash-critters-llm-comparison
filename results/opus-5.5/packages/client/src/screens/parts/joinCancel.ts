// Walking away from a room-link join (#/room/CODE) while its join_room is still unanswered. The
// request cannot be recalled, so a leave_room goes right behind it: the server handles one
// socket's messages in order and answers every leave_room with left_room, so a join it accepts
// is undone at once. Until that left_room arrives the code stays "abandoned", and the lobby
// screen hands a lobby for it straight back to the menu instead of showing the room.
import { net } from '../../net';

/** Stop treating the code as abandoned if left_room never comes (the socket dropped). */
const FORGET_AFTER_MS = 10_000;

interface Abandoned {
  code: string;
  forget: () => void;
}

let abandoned: Abandoned | null = null;

export function abandonRoomJoin(code: string): void {
  abandoned?.forget();
  if (!net.send({ type: 'leave_room' })) return;
  let off = () => {};
  const entry: Abandoned = {
    code,
    forget: () => {
      off();
      clearTimeout(timer);
      if (abandoned === entry) abandoned = null;
    },
  };
  const timer = setTimeout(entry.forget, FORGET_AFTER_MS);
  off = net.on('left_room', entry.forget);
  abandoned = entry;
}

/** True while the player is on the way out of `code` after abandoning its join. */
export function isAbandonedJoin(code: string): boolean {
  return abandoned?.code === code;
}
