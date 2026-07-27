/**
 * Create-room form. Every option here maps one-to-one onto CreateRoomOpts, so
 * the server never has to guess what the host meant.
 */

import { CONFIG, type CreateRoomOpts, type MapTheme } from '@splash/shared';
import { playSfx } from '../audio';
import { send } from '../net';
import type { Screen } from '../router';
import { navigate } from '../router';
import { getState } from '../store';
import { button, el, field, panel, screenShell } from '../ui/dom';

type ThemeChoice = MapTheme | 'random';

function option(value: string, label: string): HTMLOptionElement {
  return el('option', { value, text: label });
}

function selectEl(options: HTMLOptionElement[], initial: string): HTMLSelectElement {
  const node = el('select', {}, ...options);
  node.value = initial;
  return node;
}

function defaultRoomName(): string {
  const nickname = getState().profile?.nickname ?? 'Critter';
  return `${nickname}'s room`.slice(0, CONFIG.ROOM_NAME_MAX);
}

export function createCreateRoomScreen(): Screen {
  const nameInput = el('input', {
    type: 'text',
    maxLength: CONFIG.ROOM_NAME_MAX,
    placeholder: 'Room name',
  });
  const sizeSelect = selectEl([option('2', '2 players - Duel'), option('4', '4 players - Free-for-All')], '4');
  const visibilitySelect = selectEl(
    [option('public', 'Public - listed in the browser'), option('private', 'Private - code only')],
    'public',
  );
  const themeSelect = selectEl(
    [option('random', 'Random'), ...CONFIG.THEMES.map((theme) => option(theme.id, theme.name))],
    'random',
  );
  const roundsSelect = selectEl(
    CONFIG.ROUNDS_TO_WIN_OPTIONS.map((rounds) => option(String(rounds), `First to ${rounds}`)),
    String(CONFIG.DEFAULT_ROUNDS_TO_WIN),
  );
  const botFill = el('input', { type: 'checkbox', checked: true });

  function readOptions(): CreateRoomOpts {
    const name = nameInput.value.trim().slice(0, CONFIG.ROOM_NAME_MAX) || defaultRoomName();
    const size = sizeSelect.value === '2' ? 2 : 4;
    const rounds = Number(roundsSelect.value);
    return {
      name,
      size,
      isPublic: visibilitySelect.value === 'public',
      theme: themeSelect.value as ThemeChoice,
      roundsToWin: CONFIG.ROUNDS_TO_WIN_OPTIONS.includes(rounds) ? rounds : CONFIG.DEFAULT_ROUNDS_TO_WIN,
      botFill: botFill.checked,
    };
  }

  function create(): void {
    playSfx('ui');
    // room_created carries the code; main.ts routes us into the lobby.
    send({ t: 'create_room', opts: readOptions() });
  }

  return {
    mount(host) {
      nameInput.value = defaultRoomName();

      host.appendChild(
        screenShell(
          'Create Room',
          () => {
            playSfx('ui_back');
            navigate('/menu');
          },
          panel(
            'Room',
            field('Name', nameInput, `Up to ${CONFIG.ROOM_NAME_MAX} characters. Shown in the browser.`),
            el(
              'div',
              { class: 'grid grid-2' },
              field('Size', sizeSelect, 'Duel is a 13x11 arena, Free-for-All is 15x13.'),
              field('Visibility', visibilitySelect, 'Private rooms are reachable by code or shared link.'),
            ),
            el(
              'div',
              { class: 'grid grid-2' },
              field('Map theme', themeSelect, 'Pure reskins: the layout rules never change.'),
              field('Rounds to win', roundsSelect, 'The match ends as soon as someone gets there.'),
            ),
            field(
              'Fill empty slots with bots',
              el('div', { class: 'row' }, botFill, el('span', { class: 'muted', text: 'Bots take any slot still open at the start.' })),
              'You can still set each slot by hand in the lobby.',
            ),
          ),
          panel(
            null,
            button('Create room', create, { variant: 'primary', wide: true }),
            el('p', {
              class: 'field-hint',
              text: 'You become the host: you assign bots, and you start the match.',
            }),
          ),
        ),
      );
    },

    unmount() {
      // Nothing subscribed: the form is inert until the create button is pressed.
    },
  };
}
