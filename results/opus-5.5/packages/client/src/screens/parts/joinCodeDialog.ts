// Join by Code dialog: a 6-character room code (only the server's code alphabet is accepted
// while typing). Sends join_room; the app moves to the lobby on lobby_state.
import { CONFIG, type ErrorCode } from '@splash/shared';
import { navigate } from '../../app';
import { net } from '../../net';
import { h, modal, textInput } from '../../ui';
import { isRoomCode, normaliseRoomCode } from './format';
import { modalButton, setPending } from './form';
import { receivedLobbyOf } from './replyChecks';
import { awaitServerReply, errorText } from './serverReply';

/** Why the server refuses join_room (also used by the room browser's one-click Join). */
export const JOIN_ROOM_ERRORS: readonly ErrorCode[] = ['not_found', 'room_full', 'room_in_match', 'already_in_room', 'already_queued'];

export function openJoinCodeDialog(): void {
  let cancelReply: (() => void) | null = null;
  const error = h('div', { class: 'error-line', role: 'alert' });
  const input = textInput({
    label: 'Room code',
    placeholder: 'ABC123',
    maxLength: CONFIG.ROOM_CODE_LEN,
    autofocus: true,
    transform: normaliseRoomCode,
    onInput: (v) => {
      error.textContent = '';
      if (joinBtn && !cancelReply) joinBtn.disabled = !isRoomCode(v);
    },
    onEnter: () => submit(),
  });
  input.classList.add('code-input');

  const dialog = modal({
    title: 'Join by code',
    body: h(
      'div',
      { class: 'col join-body' },
      h('p', { class: 'muted-note' }, 'Ask the host for the 6-character code shown in their lobby.'),
      input,
      error,
    ),
    onClose: () => cancelReply?.(),
    actions: [
      { label: 'Join', variant: 'primary', onClick: () => (submit(), false) },
      { label: 'Cancel', variant: 'ghost', hotkey: 'Escape' },
    ],
  });
  const joinBtn = modalButton(dialog.el, 0);
  if (joinBtn) joinBtn.disabled = true;

  function submit(): void {
    const code = normaliseRoomCode(input.value);
    if (cancelReply || !isRoomCode(code)) return;
    if (!net.send({ type: 'join_room', code })) {
      error.textContent = 'Not connected. Try again in a moment.';
      return;
    }
    setPending(joinBtn, true, 'Joining...');
    cancelReply = awaitServerReply({
      errors: JOIN_ROOM_ERRORS,
      succeeded: receivedLobbyOf(code),
      onSuccess: () => {
        dialog.close();
        // Normally the app has already moved to the lobby; re-joining your own room does not.
        navigate('/lobby');
      },
      onError: (err) => {
        cancelReply = null;
        setPending(joinBtn, false);
        error.textContent = errorText(err);
        input.focus();
      },
    });
  }
}
