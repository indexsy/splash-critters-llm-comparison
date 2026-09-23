// Main-menu profile card: portrait, nickname#tag with an edit button, level + XP bar and the
// Duel / FFA tier badges with ratings. The GUEST chip sits on the level row so the name row has
// room for a full 16-character nickname#tag. Re-renders whenever the store's profile changes.
import type { Mode, Profile } from '@splash/shared';
import { store } from '../../store';
import { button, h, spinner } from '../../ui';
import { modeSize } from './format';
import type { Scope } from './scope';
import { chip, nameTagEl, progressBar } from './shell';
import { portraitEl, tierBadgeEl } from './sprite';

function ratingLine(profile: Profile, mode: Mode): HTMLElement {
  const r = profile.ratings[mode];
  return h(
    'div',
    { class: 'pc-rating', title: `${mode === 'duel' ? 'Duel' : 'Free-for-All'}: ${r.games} ranked games` },
    tierBadgeEl(r.tier),
    h('span', { class: 'pc-mode' }, mode === 'duel' ? 'Duel' : 'FFA'),
    h('span', { class: 'pc-elo' }, String(r.rating)),
    h('span', { class: 'pc-size' }, modeSize(mode)),
  );
}

function render(profile: Profile, onEdit: () => void): HTMLElement[] {
  const xp = progressBar(profile.xpIntoLevel / Math.max(1, profile.xpForNext), 'xp', 'Experience');
  return [
    portraitEl(profile.animal, profile.hat, 0, 2),
    h(
      'div',
      { class: 'pc-main' },
      h(
        'div',
        { class: 'pc-name-row' },
        nameTagEl(profile.nickname, profile.tag, 'pc-name selectable'),
        button('Edit', onEdit, { small: true, variant: 'ghost', title: 'Change your nickname' }),
      ),
      h(
        'div',
        { class: 'pc-level-row' },
        profile.hasNickname ? null : chip('Guest', 'coral'),
        chip(`Lv ${profile.level}`, 'sand'),
        xp.el,
        h('span', { class: 'pc-xp' }, `${profile.xpIntoLevel}/${profile.xpForNext}`),
      ),
    ),
    h('div', { class: 'pc-ratings' }, ratingLine(profile, 'duel'), ratingLine(profile, 'ffa')),
  ];
}

/** The card element; it tracks store.profile until `scope` is disposed. */
export function profileCard(scope: Scope, onEdit: () => void): HTMLElement {
  const card = h('section', { class: 'profile-card', 'aria-label': 'Your profile' });
  const paint = () => {
    const profile = store.get().profile;
    card.replaceChildren(...(profile ? render(profile, onEdit) : [spinner('Connecting')]));
  };
  paint();
  scope.add(
    store.subscribe((next, prev) => {
      if (next.profile !== prev.profile) paint();
    }),
  );
  return card;
}
