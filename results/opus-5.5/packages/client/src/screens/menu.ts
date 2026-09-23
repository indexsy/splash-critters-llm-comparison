// Main menu: profile card, then PLAY (ranked Duel / FFA, casual rooms, practice vs bots) and
// MORE (leaderboard, locker, how to play, settings, replay tutorial). A strip offers a way back
// when the player is still seated in a room or waiting in a ranked queue.
import type { Mode } from '@splash/shared';
import { navigate } from '../app';
import { audio } from '../audio';
import { store } from '../store';
import { button, h, type ButtonOptions } from '../ui';
import type { Screen } from './index';
import { focusInitial, installArrowNav } from './parts/arrowNav';
import { runMenuBackdrop } from './parts/backdrop';
import { openCreateRoomDialog } from './parts/createRoomDialog';
import { modeLabel } from './parts/format';
import { openJoinCodeDialog } from './parts/joinCodeDialog';
import { openNicknameDialog } from './parts/nicknameDialog';
import { openPracticeDialog } from './parts/practiceDialog';
import { profileCard } from './parts/profileCard';
import { playRanked } from './parts/ranked';
import { Scope } from './parts/scope';
import { sectionLabel } from './parts/shell';
import { tipTicker } from './parts/tips';
import './parts/styles/menu.css';

let scope: Scope | null = null;

function item(label: string, onClick: () => void, opts: ButtonOptions & { autofocus?: boolean } = {}): HTMLButtonElement {
  const btn = button(label, onClick, { variant: 'secondary', ...opts });
  btn.classList.add('nav-item', 'menu-item');
  if (opts.autofocus) btn.dataset.autofocus = '';
  return btn;
}

function playColumn(): HTMLElement {
  const ranked = (mode: Mode) => () => playRanked(mode);
  return h(
    'div',
    { class: 'menu-col' },
    sectionLabel('Ranked'),
    h('div', { class: 'menu-pair' }, item('Duel 1v1', ranked('duel'), { variant: 'primary', autofocus: true }), item('Free-for-All', ranked('ffa'), { variant: 'primary' })),
    sectionLabel('Casual'),
    item('Browse rooms', () => navigate('/browse')),
    h('div', { class: 'menu-pair' }, item('Create room', openCreateRoomDialog), item('Join by code', openJoinCodeDialog)),
    sectionLabel('Practice'),
    item('Practice vs bots', openPracticeDialog),
  );
}

function moreColumn(): HTMLElement {
  return h(
    'div',
    { class: 'menu-col' },
    sectionLabel('More'),
    item('Leaderboard', () => navigate('/leaderboard')),
    item('Locker', () => navigate('/locker')),
    item('How to play', () => navigate('/howto')),
    item('Settings', () => navigate('/settings')),
    item('Replay tutorial', () => navigate('/tutorial'), { variant: 'ghost' }),
  );
}

/** "You are still in room X / in the Duel queue" with a way back, when that applies. */
function activityStrip(s: Scope): HTMLElement {
  const strip = h('div', { class: 'menu-activity', role: 'status' });
  const paint = () => {
    const { lobby, queue } = store.get();
    if (lobby) {
      strip.replaceChildren(h('span', null, `You are in room ${lobby.code}`), button('Return', () => navigate('/lobby'), { small: true }));
    } else if (queue) {
      strip.replaceChildren(
        h('span', null, `Searching: ranked ${modeLabel(queue.mode)}`),
        button('View', () => navigate(`/queue/${queue.mode}`), { small: true }),
      );
    } else {
      strip.replaceChildren();
    }
    strip.hidden = !lobby && !queue;
  };
  paint();
  s.add(
    store.subscribe((next, prev) => {
      if (next.lobby !== prev.lobby || next.queue !== prev.queue) paint();
    }),
  );
  return strip;
}

export const screen: Screen = {
  mount(root) {
    const s = new Scope();
    scope = s;
    audio.music('menu');
    runMenuBackdrop(s);
    root.append(
      h(
        'div',
        { class: 'menu screen-fill' },
        profileCard(s, () => openNicknameDialog()),
        activityStrip(s),
        h('nav', { class: 'menu-columns', 'aria-label': 'Main menu' }, playColumn(), moreColumn(), tipTicker(s)),
        h('div', { class: 'menu-hint' }, 'Arrows move / Enter selects / M mutes'),
      ),
    );
    s.add(installArrowNav(root));
    focusInitial(root);
  },

  unmount() {
    scope?.dispose();
    scope = null;
  },
};
