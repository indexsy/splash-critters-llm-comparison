// Practice vs Bots dialog: 2 players (1 bot) or 4 players (3 bots), bot difficulty and map.
// Creates a private practice room that the server fills with bots and starts right away.
import { CONFIG, type Difficulty, type ThemeChoice } from '@splash/shared';
import { net } from '../../net';
import { h, modal, segmented } from '../../ui';
import { CREATE_ROOM_ERRORS, THEME_OPTIONS } from './createRoomDialog';
import { formGrid, formRow, modalButton, setPending } from './form';
import { startedPractice } from './replyChecks';
import { awaitServerReply, errorText } from './serverReply';

export function openPracticeDialog(): void {
  let size: 2 | 4 = 2;
  let difficulty: Difficulty = 'medium';
  let theme: ThemeChoice = 'random';
  let cancelReply: (() => void) | null = null;
  const error = h('div', { class: 'error-line', role: 'alert' });

  const body = h(
    'div',
    { class: 'col' },
    formGrid(
      formRow('Match', segmented([{ value: 2, label: 'Vs 1 bot' }, { value: 4, label: 'Vs 3 bots' }], size, (v) => (size = v as 2 | 4), 'Opponents').el),
      formRow(
        'Bots',
        segmented(
          [
            { value: 'easy', label: 'Easy' },
            { value: 'medium', label: 'Medium' },
            { value: 'hard', label: 'Hard' },
          ],
          difficulty,
          (v) => (difficulty = v as Difficulty),
          'Bot difficulty',
        ).el,
      ),
      formRow('Map', segmented(THEME_OPTIONS, theme, (v) => (theme = v), 'Map theme').el),
    ),
    error,
    h('p', { class: 'muted-note' }, `Practice earns ${Math.round(CONFIG.XP.PRACTICE_MULT * 100)}% XP and never touches your rating.`),
  );

  const dialog = modal({
    title: 'Practice vs bots',
    body,
    onClose: () => cancelReply?.(),
    actions: [
      { label: 'Start', variant: 'primary', onClick: () => (submit(), false) },
      { label: 'Cancel', variant: 'ghost', hotkey: 'Escape' },
    ],
  });
  const startBtn = modalButton(dialog.el, 0);

  function submit(): void {
    if (cancelReply) return;
    const sent = net.send({
      type: 'create_room',
      opts: {
        name: 'Practice',
        size,
        isPublic: false,
        theme,
        roundsToWin: CONFIG.ROUNDS_TO_WIN_DEFAULT as 3,
        botFill: true,
        practice: true,
        practiceDifficulty: difficulty,
      },
    });
    if (!sent) {
      error.textContent = 'Not connected. Try again in a moment.';
      return;
    }
    setPending(startBtn, true, 'Starting...');
    cancelReply = awaitServerReply({
      errors: CREATE_ROOM_ERRORS,
      succeeded: startedPractice,
      onSuccess: () => dialog.close(),
      onError: (err) => {
        cancelReply = null;
        setPending(startBtn, false);
        error.textContent = errorText(err);
      },
    });
  }
}
