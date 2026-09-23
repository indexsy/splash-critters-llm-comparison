// One row of the public room browser: theme icon, room name + host, mode, players and a
// one-click JOIN (the pending "..." while this client's join for it is in flight, or IN MATCH /
// FULL when the room cannot be joined right now).
import type { RoomSummary } from '@splash/shared';
import { button, h } from '../../ui';
import { setPending } from './form';
import { modeSize, themeLabel } from './format';
import { navKey } from './refocus';
import { roomAction } from './roomRules';
import { chip } from './shell';
import { themeIconEl } from './themeIcon';

function joinButton(room: RoomSummary, pendingCode: string | null, onJoin: (room: RoomSummary) => void): HTMLButtonElement {
  // One join at a time: every other JOIN waits while a join is in flight.
  const idle = pendingCode === null;
  const btn = button('Join', () => onJoin(room), { small: true, variant: 'primary', disabled: !idle, title: `Join ${room.name}` });
  if (roomAction(room, pendingCode) === 'pending') setPending(btn, true, '...');
  return navKey(btn, `join-${room.code}`);
}

/** Row element; `onJoin` runs for joinable rooms (row click or its JOIN button). */
export function roomRow(room: RoomSummary, pendingCode: string | null, onJoin: (room: RoomSummary) => void): HTMLElement {
  const action = roomAction(room, pendingCode);
  const join = joinButton(room, pendingCode, onJoin);
  const status = action === 'in_match' ? chip('In match', 'coral') : action === 'full' ? chip('Full', 'plain') : null;
  return h(
    'li',
    {
      class: ['room-row', status ? 'is-closed' : 'is-open'].join(' '),
      onClick: (e: MouseEvent) => {
        if (action === 'join' && e.target instanceof Element && !e.target.closest('button')) join.click();
      },
    },
    themeIconEl(room.theme),
    h(
      'div',
      { class: 'room-main' },
      h('span', { class: 'room-name' }, room.name),
      h('span', { class: 'room-host' }, `${themeLabel(room.theme)} / host ${room.host}`),
    ),
    chip(modeSize(room.mode), room.mode === 'duel' ? 'water' : 'teal'),
    h('span', { class: 'room-count', 'aria-label': `${room.players} of ${room.maxPlayers} players` }, `${room.players}/${room.maxPlayers}`),
    h('div', { class: 'room-action' }, status ?? join),
  );
}
