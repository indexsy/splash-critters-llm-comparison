// Create Room dialog (menu + room browser): name, 2 or 4 players, public/private, map theme,
// rounds to win and bot fill. Sends create_room; the app moves to the lobby on lobby_state.
import { CONFIG, type CreateRoomOpts, type ErrorCode, type ThemeChoice } from '@splash/shared';
import { net } from '../../net';
import { store } from '../../store';
import { h, modal, segmented, textInput, toggle } from '../../ui';
import { formGrid, formRow, modalButton, setPending } from './form';
import { enteredNewRoom } from './replyChecks';
import { awaitServerReply, errorText } from './serverReply';

export const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'backyard', label: 'Backyard' },
  { value: 'beach', label: 'Beach' },
  { value: 'pool', label: 'Pool Party' },
  { value: 'random', label: 'Random' },
];

/** Why the server refuses create_room (casual or practice): the player is busy elsewhere. */
export const CREATE_ROOM_ERRORS: readonly ErrorCode[] = ['already_in_room', 'already_queued'];

function defaultRoomName(): string {
  const nick = store.get().profile?.nickname ?? 'Splash';
  return `${nick}'s Room`.slice(0, CONFIG.ROOM_NAME_MAX);
}

export function openCreateRoomDialog(): void {
  const opts: CreateRoomOpts = {
    name: defaultRoomName(),
    size: 4,
    isPublic: true,
    theme: 'random',
    roundsToWin: CONFIG.ROUNDS_TO_WIN_DEFAULT as 3,
    botFill: true,
  };
  let cancelReply: (() => void) | null = null;
  const error = h('div', { class: 'error-line', role: 'alert' });
  const name = textInput({
    label: 'Room name',
    value: opts.name,
    maxLength: CONFIG.ROOM_NAME_MAX,
    autofocus: true,
    onInput: () => (error.textContent = ''),
    onEnter: () => submit(),
  });

  const body = formGrid(
    formRow('Name', name),
    formRow('Players', segmented([{ value: 2, label: '2P Duel' }, { value: 4, label: '4P FFA' }], opts.size, (v) => (opts.size = v as 2 | 4), 'Players').el),
    formRow('Room', segmented([{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }], 'public', (v) => (opts.isPublic = v === 'public'), 'Visibility').el),
    formRow('Map', segmented(THEME_OPTIONS, opts.theme, (v) => (opts.theme = v), 'Map theme').el),
    formRow(
      'Rounds',
      segmented(
        CONFIG.ROUNDS_TO_WIN_OPTIONS.map((n) => ({ value: n, label: `First to ${n}` })),
        opts.roundsToWin,
        (v) => (opts.roundsToWin = v),
        'Rounds to win',
      ).el,
    ),
    formRow('Bots', toggle('Fill empty slots', opts.botFill, (on) => (opts.botFill = on)).el),
    error,
  );

  const dialog = modal({
    title: 'Create room',
    body,
    onClose: () => cancelReply?.(),
    actions: [
      { label: 'Create', variant: 'primary', onClick: () => (submit(), false) },
      { label: 'Cancel', variant: 'ghost', hotkey: 'Escape' },
    ],
  });
  const createBtn = modalButton(dialog.el, 0);

  function submit(): void {
    if (cancelReply) return;
    const roomName = name.value.trim() || defaultRoomName();
    if (!net.send({ type: 'create_room', opts: { ...opts, name: roomName } })) {
      error.textContent = 'Not connected. Try again in a moment.';
      return;
    }
    setPending(createBtn, true, 'Creating...');
    cancelReply = awaitServerReply({
      errors: CREATE_ROOM_ERRORS,
      succeeded: enteredNewRoom,
      onSuccess: () => dialog.close(),
      onError: (err) => {
        cancelReply = null;
        setPending(createBtn, false);
        error.textContent = errorText(err);
      },
    });
  }
}
