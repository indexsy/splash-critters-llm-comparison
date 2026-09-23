// Public room browser: a live list (room_list_watch while mounted, re-armed after reconnects,
// plus room_list_request on mount and Refresh), filter All / Duel / FFA, one-click Join and an
// empty state that invites the player to create a room.
import type { Mode, RoomSummary } from '@splash/shared';
import { navigate } from '../app';
import { audio } from '../audio';
import { net } from '../net';
import { store } from '../store';
import { button, h, segmented, spinner, toast } from '../ui';
import type { Screen } from './index';
import { focusInitial, installArrowNav } from './parts/arrowNav';
import { runMenuBackdrop } from './parts/backdrop';
import { openCreateRoomDialog } from './parts/createRoomDialog';
import { JOIN_ROOM_ERRORS } from './parts/joinCodeDialog';
import { rerender } from './parts/refocus';
import { receivedLobbyOf } from './parts/replyChecks';
import { roomRow } from './parts/roomRow';
import { sortRooms } from './parts/roomRules';
import { Scope } from './parts/scope';
import { awaitServerReply, errorText } from './parts/serverReply';
import { screenShell } from './parts/shell';
import './parts/styles/browser.css';

type Filter = 'all' | Mode;

let scope: Scope | null = null;

/** Keep the server pushing room_list updates while this screen is open. */
function watchRooms(s: Scope): void {
  const subscribe = () => {
    net.send({ type: 'room_list_watch', on: true });
    net.send({ type: 'room_list_request' });
  };
  if (store.get().connected) subscribe();
  s.add(
    store.subscribe((next, prev) => {
      if (next.connected && !prev.connected) subscribe();
    }),
  );
  s.add(() => net.send({ type: 'room_list_watch', on: false }));
}

function emptyState(filter: Filter): HTMLElement {
  const what = filter === 'all' ? 'open rooms' : filter === 'duel' ? 'Duel rooms' : 'Free-for-All rooms';
  return h(
    'li',
    { class: 'room-empty' },
    h('p', null, `No ${what} right now.`),
    h('p', { class: 'muted-note' }, 'Start one and your friends (or bots) can jump in.'),
    button('Create room', openCreateRoomDialog, { variant: 'primary' }),
  );
}

export const screen: Screen = {
  mount(root) {
    const s = new Scope();
    scope = s;
    audio.music('menu');
    runMenuBackdrop(s);
    let filter: Filter = 'all';
    let loaded = false;
    /** The join in flight: its room keeps a pending JOIN across live list updates. */
    let pending: { code: string; cancel: () => void } | null = null;
    s.add(() => pending?.cancel());

    const list = h('ul', { class: 'room-list scroll', 'aria-label': 'Open rooms' });
    const count = h('span', { class: 'room-total' });

    const join = (room: RoomSummary) => {
      if (pending) return;
      if (!net.send({ type: 'join_room', code: room.code })) {
        toast('Not connected. Try again in a moment.', 'error');
        return;
      }
      const cancel = awaitServerReply({
        errors: JOIN_ROOM_ERRORS,
        succeeded: receivedLobbyOf(room.code),
        // Normally the app has already moved to the lobby; re-joining your own room does not.
        onSuccess: () => navigate('/lobby'),
        onError: (err) => {
          pending = null;
          render();
          toast(errorText(err), 'error');
        },
      });
      pending = { code: room.code, cancel };
      render();
    };

    const render = () => {
      const rooms = sortRooms(store.get().roomList.filter((r) => filter === 'all' || r.mode === filter));
      count.textContent = loaded ? `${rooms.length} room${rooms.length === 1 ? '' : 's'}` : '';
      rerender(list, () => {
        if (!loaded) return [h('li', { class: 'room-empty' }, spinner('Loading rooms'))];
        if (rooms.length === 0) return [emptyState(filter)];
        return rooms.map((room) => roomRow(room, pending?.code ?? null, join));
      });
    };

    const refresh = () => {
      if (net.send({ type: 'room_list_request' })) return;
      toast('Not connected. Try again in a moment.', 'error');
    };

    const filterCtl = segmented<Filter>(
      [
        { value: 'all', label: 'All' },
        { value: 'duel', label: 'Duel 2P' },
        { value: 'ffa', label: 'FFA 4P' },
      ],
      filter,
      (v) => {
        filter = v;
        render();
      },
      'Filter rooms by mode',
    );

    root.append(
      screenShell(
        {
          title: 'Rooms',
          onBack: () => navigate('/menu'),
          tools: button('Refresh', refresh, { small: true, title: 'Refresh the room list' }),
        },
        h('div', { class: 'browser-bar' }, filterCtl.el, count, button('Create room', openCreateRoomDialog, { small: true, variant: 'primary' })),
        list,
      ),
    );

    /** On the first list, hand the cursor to the first JOIN unless the player already moved it. */
    const focusFirstJoin = () => {
      const active = document.activeElement;
      const idle = !(active instanceof HTMLElement) || active === document.body || active.dataset.hotkey === 'Escape';
      if (idle) list.querySelector<HTMLButtonElement>('.room-row .btn:not([disabled])')?.focus({ preventScroll: true });
    };
    s.add(
      store.subscribe((next, prev) => {
        if (next.roomList === prev.roomList) return;
        const first = !loaded;
        loaded = true;
        render();
        if (first) focusFirstJoin();
      }),
    );
    render();
    watchRooms(s);
    s.add(installArrowNav(root));
    focusInitial(root);
  },

  unmount() {
    scope?.dispose();
    scope = null;
  },
};
