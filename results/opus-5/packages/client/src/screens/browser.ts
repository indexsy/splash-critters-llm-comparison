/**
 * Public room browser. Polls the server every few seconds so a room that fills
 * up or starts while you are reading the list goes stale for at most one tick.
 */

import { themeDef, type GameMode, type MapTheme, type RoomSummary } from '@splash/shared';
import { playSfx } from '../audio';
import { send } from '../net';
import type { Screen } from '../router';
import { navigate } from '../router';
import { getState, subscribe } from '../store';
import { button, el, panel, screenShell } from '../ui/dom';

const REFRESH_MS = 3000;

type Filter = 'all' | GameMode;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'duel', label: 'Duel' },
  { id: 'ffa', label: 'Free-for-All' },
];

function themeLabel(theme: MapTheme | 'random'): string {
  return theme === 'random' ? 'Random map' : themeDef(theme).name;
}

function joinState(room: RoomSummary): { label: string; disabled: boolean } {
  if (room.inProgress) return { label: 'In progress', disabled: true };
  if (room.players >= room.maxPlayers) return { label: 'Full', disabled: true };
  return { label: 'Join', disabled: false };
}

export function createBrowserScreen(): Screen {
  let unsubscribeStore: (() => void) | null = null;
  let timer = 0;
  let filter: Filter = 'all';
  let lastRooms: RoomSummary[] | null = null;
  let lastFilter: Filter | null = null;

  const list = el('div', { class: 'list' });
  const status = el('p', { class: 'field-hint', text: 'Looking for rooms...' });
  const filterRow = el('div', { class: 'row' });

  function requestList(): void {
    if (filter === 'all') send({ t: 'room_list_request' });
    else send({ t: 'room_list_request', mode: filter });
  }

  function setFilter(next: Filter): void {
    if (filter === next) return;
    filter = next;
    playSfx('ui');
    renderFilters();
    renderList();
    requestList();
  }

  function renderFilters(): void {
    filterRow.replaceChildren(
      ...FILTERS.map((option) =>
        button(option.label, () => setFilter(option.id), {
          variant: filter === option.id ? 'primary' : 'secondary',
          title: `Show ${option.label.toLowerCase()} rooms`,
        }),
      ),
      button('Refresh', () => {
        playSfx('ui');
        requestList();
      }),
    );
  }

  function joinRoom(room: RoomSummary): void {
    playSfx('ui');
    // The server answers with lobby_state, and the global router follows it.
    send({ t: 'join_room', code: room.code });
  }

  function roomRow(room: RoomSummary): HTMLElement {
    const { label, disabled } = joinState(room);
    return el(
      'div',
      { class: 'list-row' },
      el(
        'div',
        { class: 'stack' },
        el(
          'div',
          { class: 'row' },
          el('strong', { text: room.name }),
          el('span', { class: 'badge', text: room.mode === 'duel' ? '2P' : '4P' }),
          el('span', { class: 'badge', text: `${room.players}/${room.maxPlayers}` }),
        ),
        el('span', {
          class: 'muted',
          text: `${themeLabel(room.theme)} - first to ${room.roundsToWin} - host ${room.hostName}`,
        }),
      ),
      button(label, () => joinRoom(room), {
        variant: disabled ? 'secondary' : 'primary',
        disabled,
        title: disabled ? `${room.name} cannot be joined right now` : `Join ${room.name}`,
      }),
    );
  }

  function renderList(): void {
    const rooms = getState().rooms;
    if (rooms === lastRooms && filter === lastFilter) return;
    lastRooms = rooms;
    lastFilter = filter;

    const visible = filter === 'all' ? rooms : rooms.filter((room) => room.mode === filter);
    status.textContent = `${visible.length} room${visible.length === 1 ? '' : 's'} - refreshing every ${REFRESH_MS / 1000} seconds`;

    if (visible.length === 0) {
      list.replaceChildren(
        el(
          'div',
          { class: 'list-row is-empty' },
          el('span', {
            text:
              filter === 'all'
                ? 'No public rooms right now. Create one and it shows up here for everyone.'
                : 'No public rooms in this mode. Try another filter or create one.',
          }),
        ),
      );
      return;
    }
    list.replaceChildren(...visible.map(roomRow));
  }

  return {
    mount(host) {
      renderFilters();
      renderList();

      host.appendChild(
        screenShell(
          'Room Browser',
          () => {
            playSfx('ui_back');
            navigate('/menu');
          },
          panel('Filter', filterRow, status),
          panel('Public rooms', list),
          panel(
            'Nothing you like?',
            el('p', {
              class: 'muted',
              text: 'Create your own room, pick the map and the bots, then share the code with a friend.',
            }),
            button('Create room', () => {
              playSfx('ui');
              navigate('/create');
            }, { wide: true }),
          ),
        ),
      );

      requestList();
      timer = window.setInterval(requestList, REFRESH_MS);
      // room_list lands in the store via main.ts, so one subscription repaints.
      unsubscribeStore = subscribe(renderList);
    },

    unmount() {
      window.clearInterval(timer);
      timer = 0;
      unsubscribeStore?.();
      unsubscribeStore = null;
    },
  };
}
