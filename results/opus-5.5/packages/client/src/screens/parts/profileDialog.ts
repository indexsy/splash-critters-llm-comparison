// Public profile dialog (leaderboard row click): level, Duel / FFA ratings with tier badges and
// the recent matches list (placement, ranked rating change, soaks, when).
import type { Mode, PublicProfile, RecentMatch } from '@splash/shared';
import { h, modal, spinner } from '../../ui';
import { fetchPublicProfile, requestError } from './api';
import { modeLabel, nameTag, ordinal, percent, signed, timeAgo } from './format';
import { chip, sectionLabel } from './shell';
import { portraitEl, tierBadgeEl } from './sprite';

function ratingRow(p: PublicProfile, mode: Mode): HTMLElement {
  const r = p.ratings[mode];
  const winrate = r.games > 0 ? percent(r.wins / r.games) : '--';
  return h(
    'div',
    { class: 'pd-rating' },
    tierBadgeEl(r.tier),
    h('span', { class: 'pd-mode' }, mode === 'duel' ? 'Duel' : 'FFA'),
    h('span', { class: 'pd-elo' }, String(r.rating)),
    h('span', { class: 'pd-meta' }, `${r.games} games / ${winrate} wins / peak ${r.peak}`),
  );
}

function matchRow(m: RecentMatch, now: number): HTMLElement {
  const change = m.ratingBefore !== null && m.ratingAfter !== null ? m.ratingAfter - m.ratingBefore : null;
  return h(
    'li',
    { class: 'pd-match' },
    chip(m.mode === 'duel' ? 'Duel' : 'FFA', m.mode === 'duel' ? 'water' : 'teal'),
    h('span', { class: 'pd-kind' }, m.ranked ? 'Ranked' : 'Casual'),
    h('span', { class: `pd-place${m.placement === 1 ? ' is-win' : ''}` }, `${ordinal(m.placement)}/${m.players}`),
    h('span', { class: `pd-change ${change === null ? '' : change >= 0 ? 'is-up' : 'is-down'}` }, change === null ? '' : signed(change)),
    h('span', { class: 'pd-when' }, timeAgo(m.endedAt, now)),
  );
}

function profileBody(p: PublicProfile): HTMLElement {
  const now = Date.now();
  return h(
    'div',
    { class: 'pd' },
    h(
      'div',
      { class: 'pd-head' },
      portraitEl(p.animal, p.hat, 1, 2),
      h('div', { class: 'pd-id' }, h('span', { class: 'pd-name selectable' }, nameTag(p.nickname, p.tag)), chip(`Lv ${p.level}`, 'sand')),
    ),
    ratingRow(p, 'duel'),
    ratingRow(p, 'ffa'),
    sectionLabel('Recent matches'),
    p.recentMatches.length > 0
      ? h('ul', { class: 'pd-matches' }, p.recentMatches.map((m) => matchRow(m, now)))
      : h('p', { class: 'muted-note' }, 'No matches played yet.'),
  );
}

/** Open the dialog for player `id` (the name known from the row labels it while loading). */
export function openProfileDialog(id: string, knownName: string): void {
  const body = h('div', { class: 'pd-wrap' }, spinner(`Loading ${knownName}`));
  const abort = new AbortController();
  modal({
    title: 'Player profile',
    body,
    onClose: () => abort.abort(),
    actions: [{ label: 'Close', variant: 'ghost', hotkey: 'Escape' }],
  });
  fetchPublicProfile(id, abort.signal)
    .then((p) => body.replaceChildren(profileBody(p)))
    .catch((err: unknown) => {
      if (!abort.signal.aborted) body.replaceChildren(h('p', { class: 'error-line' }, requestError(err)));
    });
}

/** Mode line used by the leaderboard's "your standing" footer. */
export function standingText(mode: Mode, rating: number, games: number): string {
  return games > 0 ? `Your ${modeLabel(mode)} rating: ${rating}` : `Play a ranked ${modeLabel(mode)} to get on the board`;
}
