// Entering a ranked queue: a search already running is shown again instead of starting another,
// a seated player must leave their room first, and ranked requires a custom nickname (the dialog
// opens first for guest names). Then queue_join is sent and the queue screen takes over; it asks
// `takeQueueRequest` whether the join is already on its way (so it never sends a duplicate).
import type { Mode } from '@splash/shared';
import { navigate } from '../../app';
import { net } from '../../net';
import { store } from '../../store';
import { toast } from '../../ui';
import { modeLabel } from './format';
import { openNicknameDialog } from './nicknameDialog';
import { leaveRoomFirstText, rankedEntry } from './queueRules';

/** A queue_join sent this recently still counts as pending when the queue screen mounts. */
const REQUEST_FRESH_MS = 5000;

let lastRequest: { mode: Mode; at: number } | null = null;

/** Send queue_join for `mode`. Returns false when the socket is not open. */
export function sendQueueJoin(mode: Mode): boolean {
  if (!net.send({ type: 'queue_join', mode })) return false;
  lastRequest = { mode, at: Date.now() };
  return true;
}

/** True (once) when a queue_join for `mode` was sent moments ago by the menu. */
export function takeQueueRequest(mode: Mode): boolean {
  const fresh = lastRequest !== null && lastRequest.mode === mode && Date.now() - lastRequest.at < REQUEST_FRESH_MS;
  lastRequest = null;
  return fresh;
}

function joinQueue(mode: Mode): void {
  if (!sendQueueJoin(mode)) {
    toast('Not connected. Try again in a moment.', 'error');
    return;
  }
  navigate(`/queue/${mode}`);
}

/** Main-menu "Play Ranked": back to a search already running, room check, nickname gate, then queue. */
export function playRanked(mode: Mode): void {
  const entry = rankedEntry(store.get(), mode);
  switch (entry.action) {
    case 'wait_connect':
      toast('Still connecting to the server', 'warn');
      return;
    case 'view_queue':
      if (entry.mode !== mode) toast(`You are already searching for a ranked ${modeLabel(entry.mode)}.`, 'info');
      navigate(`/queue/${entry.mode}`);
      return;
    case 'leave_room_first':
      toast(leaveRoomFirstText(entry.code), 'warn');
      return;
    case 'pick_nickname':
      openNicknameDialog({ reason: 'Ranked play needs your own nickname first.', onSaved: () => playRanked(mode) });
      return;
    case 'join':
      joinQueue(mode);
  }
}
