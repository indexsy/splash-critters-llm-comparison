// Leaderboard: Duel / FFA tabs over GET /api/leaderboard (top 100: rank, portrait, name#tag,
// rating, tier badge, games, win %), the local player highlighted, Refresh, loading and error
// states. A row opens that player's public profile.
import type { LeaderboardEntry, Mode } from '@splash/shared';
import { navigate } from '../app';
import { audio } from '../audio';
import { net } from '../net';
import { store } from '../store';
import { button, h, segmented, spinner, table, type TableColumn } from '../ui';
import type { Screen } from './index';
import { fetchLeaderboard, requestError } from './parts/api';
import { focusInitial, installArrowNav } from './parts/arrowNav';
import { runMenuBackdrop } from './parts/backdrop';
import { nameTag, percent } from './parts/format';
import { openProfileDialog, standingText } from './parts/profileDialog';
import { Scope } from './parts/scope';
import { nameTagEl, screenShell } from './parts/shell';
import { portraitEl, tierBadgeEl } from './parts/sprite';
import './parts/styles/leaderboard.css';

let scope: Scope | null = null;

function isMe(e: LeaderboardEntry): boolean {
  return e.playerId === (store.get().profile?.id ?? net.playerId);
}

const COLUMNS: TableColumn<LeaderboardEntry>[] = [
  { label: '#', cell: (e) => h('span', { class: `lb-rank rank-${Math.min(e.rank, 4)}` }, String(e.rank)), align: 'right' },
  {
    label: 'Player',
    cell: (e) => h('span', { class: 'lb-player' }, portraitEl(e.animal, 'none', isMe(e) ? 0 : 1), nameTagEl(e.nickname, e.tag, 'lb-name')),
  },
  { label: 'Rating', cell: (e) => h('span', { class: 'lb-rating' }, tierBadgeEl(e.tier), String(e.rating)), align: 'right' },
  { label: 'Games', cell: (e) => String(e.games), align: 'right' },
  { label: 'Win', cell: (e) => percent(e.winrate), align: 'right' },
];

/** Make every body row focusable and open the profile on click / Enter / Space. */
function wireRows(wrap: HTMLElement, rows: readonly LeaderboardEntry[]): void {
  wrap.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr, i) => {
    const entry = rows[i];
    const open = () => {
      audio.sfx('ui_select');
      openProfileDialog(entry.playerId, nameTag(entry.nickname, entry.tag));
    };
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    tr.setAttribute('aria-label', `${entry.rank}. ${nameTag(entry.nickname, entry.tag)}, rating ${entry.rating}`);
    tr.classList.add('lb-row');
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Space') return;
      e.preventDefault();
      open();
    });
  });
}

function standing(mode: Mode, rows: readonly LeaderboardEntry[]): HTMLElement {
  const mine = rows.find(isMe);
  const r = store.get().profile?.ratings[mode];
  const text = mine ? `You are #${mine.rank} with ${mine.rating}` : r ? standingText(mode, r.rating, r.games) : '';
  return h('div', { class: 'lb-standing' }, text);
}

export const screen: Screen = {
  mount(root) {
    const s = new Scope();
    scope = s;
    audio.music('menu');
    runMenuBackdrop(s);
    let mode: Mode = 'duel';
    let request: AbortController | null = null;
    s.add(() => request?.abort());
    const content = h('div', { class: 'lb-content' });

    const load = () => {
      request?.abort();
      const ctl = new AbortController();
      request = ctl;
      content.replaceChildren(h('div', { class: 'lb-state' }, spinner('Loading')));
      fetchLeaderboard(mode, ctl.signal)
        .then((rows) => {
          if (ctl.signal.aborted) return;
          const wrap = table(COLUMNS, rows, { empty: 'No ranked players yet. Be the first!', rowClass: (e) => (isMe(e) ? 'is-me' : undefined), className: 'lb-table' });
          wireRows(wrap, rows);
          content.replaceChildren(wrap, standing(mode, rows));
        })
        .catch((err: unknown) => {
          if (ctl.signal.aborted && request !== ctl) return;
          const retry = button('Retry', load, { small: true });
          content.replaceChildren(h('div', { class: 'lb-state' }, h('p', { class: 'danger' }, 'Could not load the leaderboard.'), h('p', { class: 'muted-note' }, requestError(err)), retry));
          retry.focus({ preventScroll: true });
        });
    };

    const tabs = segmented<Mode>(
      [
        { value: 'duel', label: 'Duel' },
        { value: 'ffa', label: 'Free-for-All' },
      ],
      mode,
      (v) => {
        mode = v;
        load();
      },
      'Leaderboard mode',
    );
    tabs.el.querySelector<HTMLElement>('[aria-checked="true"]')?.setAttribute('data-autofocus', '');

    root.append(
      screenShell(
        { title: 'Leaderboard', onBack: () => navigate('/menu'), tools: button('Refresh', load, { small: true, title: 'Reload the standings' }) },
        h('div', { class: 'lb-bar' }, tabs.el, h('span', { class: 'lb-hint' }, 'Top 100 / select a row for details')),
        content,
      ),
    );
    load();
    s.add(installArrowNav(root));
    focusInitial(root);
  },

  unmount() {
    scope?.dispose();
    scope = null;
  },
};
