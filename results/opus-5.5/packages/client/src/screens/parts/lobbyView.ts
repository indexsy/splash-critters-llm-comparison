// Lobby body built from a LobbyState: room info chips + the big shareable code, slot cards and
// the action bar (host START with the reason it is blocked, READY toggle for everyone else).
import type { LobbyState } from '@splash/shared';
import { navigate } from '../../app';
import { PAL } from '../../render/palette';
import { store } from '../../store';
import { button, h } from '../../ui';
import { copyWithFeedback } from './clipboard';
import { modeLabel, modeSize, themeLabel } from './format';
import { isHost, mySlot, startBlocker } from './lobbyRules';
import { navKey } from './refocus';
import { chip } from './shell';
import { slotCard } from './slotCard';
import { openSlotChooser } from './slotChooser';
import { pixelLabel } from './sprite';
import { themeIconEl } from './themeIcon';

export interface LobbyActions {
  toggleReady(): void;
  start(): void;
}

/** Shareable join link: the server's path for the room (lobby.link, e.g. "/#/room/CODE") on this origin. */
function roomLink(lobby: LobbyState): string {
  return `${window.location.origin}${lobby.link}`;
}

function infoBar(lobby: LobbyState): HTMLElement {
  const chips = h(
    'div',
    { class: 'lobby-chips' },
    themeIconEl(lobby.theme),
    chip(`${modeLabel(lobby.mode)} ${modeSize(lobby.mode)}`, lobby.mode === 'duel' ? 'water' : 'teal'),
    chip(themeLabel(lobby.theme)),
    chip(`First to ${lobby.roundsToWin}`, 'sand'),
    chip(lobby.practice ? 'Practice' : lobby.isPublic ? 'Public' : 'Private', lobby.isPublic ? 'plain' : 'coral'),
    lobby.botFill ? chip('Bot fill') : null,
  );
  const code = h(
    'div',
    { class: 'lobby-code' },
    h('span', { class: 'lobby-code-label' }, 'Room code'),
    pixelLabel(lobby.code, { color: PAL.sand, shadow: PAL.ink, scale: 2 }),
    navKey(button('Copy link', () => void copyWithFeedback(roomLink(lobby), 'Invite link copied!'), { small: true, title: roomLink(lobby) }), 'copy'),
  );
  return h('div', { class: 'lobby-info' }, chips, code);
}

function slotGrid(lobby: LobbyState): HTMLElement {
  const host = isHost(lobby);
  return h(
    'div',
    { class: `lobby-slots size-${lobby.size}` },
    lobby.slots.map((slot) =>
      slotCard({ slot, isYou: slot.slot === lobby.yourSlot, canEdit: host && lobby.phase === 'lobby' && slot.kind !== 'human', onEdit: openSlotChooser }),
    ),
  );
}

function phaseNote(lobby: LobbyState): HTMLElement | null {
  if (lobby.phase === 'in_match') return h('span', { class: 'lobby-note' }, 'Match in progress...');
  if (lobby.phase === 'results') {
    return h(
      'span',
      { class: 'lobby-note' },
      'Rematch vote in progress',
      store.get().matchEnd ? navKey(button('Results', () => navigate('/results'), { small: true }), 'results') : null,
    );
  }
  if (lobby.practice) return h('span', { class: 'lobby-note' }, 'Practice match starting...');
  return null;
}

function actionBar(lobby: LobbyState, actions: LobbyActions): HTMLElement {
  const note = phaseNote(lobby);
  if (note) return h('div', { class: 'lobby-actions' }, note);
  if (isHost(lobby)) {
    const blocker = startBlocker(lobby);
    const start = navKey(button('Start match', actions.start, { variant: 'primary', disabled: blocker !== null }), 'start');
    if (!blocker) start.dataset.autofocus = '';
    return h('div', { class: 'lobby-actions' }, h('span', { class: 'lobby-note' }, blocker ?? 'Everyone is ready. Splash time!'), start);
  }
  const me = mySlot(lobby);
  const ready = me?.ready ?? false;
  const toggle = navKey(button(ready ? 'Not ready' : 'Ready!', actions.toggleReady, { variant: ready ? 'ghost' : 'primary' }), 'ready');
  toggle.dataset.autofocus = '';
  return h(
    'div',
    { class: 'lobby-actions' },
    h('span', { class: 'lobby-note' }, ready ? 'Waiting for the host to start' : 'Press READY when you are set'),
    toggle,
  );
}

/** The whole lobby body for `lobby` (re-built on every lobby_state). */
export function lobbyBody(lobby: LobbyState, actions: LobbyActions): Node[] {
  return [infoBar(lobby), slotGrid(lobby), actionBar(lobby, actions)];
}
