// Ranked results panel: rating before -> after counting up, the +/-N change, the tier badge and
// a progress bar toward the next tier (tierBand(rating).progress), with a TIER UP! celebration.
import { CONFIG, tierBand, type RatingDelta, type TierId } from '@splash/shared';
import { audio } from '../../audio';
import { PAL } from '../../render/palette';
import { h, pixelTitle } from '../../ui';
import { signed } from './format';
import type { Scope } from './scope';
import { chip, progressBar, sectionLabel } from './shell';
import { tierBadgeEl } from './sprite';

const COUNT_MS = 900;

function tierIndex(id: TierId): number {
  return CONFIG.TIERS.findIndex((t) => t.id === id);
}

export interface RatingPanel {
  readonly el: HTMLElement;
  play(): void;
}

export function ratingPanel(scope: Scope, delta: RatingDelta): RatingPanel {
  const badge = h('div', { class: 'rating-badge' }, tierBadgeEl(delta.tierBefore, 'large'));
  const value = h('span', { class: 'rating-value' }, String(delta.before));
  const change = chip(signed(delta.delta), delta.delta >= 0 ? 'teal' : 'coral');
  const tierName = h('span', { class: 'rating-tier' });
  const bar = progressBar(0, 'tier', 'Progress to the next tier');
  const nextLabel = h('span', { class: 'rating-next' });
  const banner = h('div', { class: 'rating-banner', hidden: true });

  const paintTier = (rating: number) => {
    const band = tierBand(rating);
    tierName.textContent = band.name;
    bar.set(band.progress);
    nextLabel.textContent = band.next ? `${band.next.min - Math.round(rating)} to ${band.next.name}` : 'Top tier!';
  };
  paintTier(delta.before);

  const celebrate = () => {
    const up = tierIndex(delta.tierAfter) > tierIndex(delta.tierBefore);
    const down = tierIndex(delta.tierAfter) < tierIndex(delta.tierBefore);
    if (!up && !down) return;
    badge.replaceChildren(tierBadgeEl(delta.tierAfter, 'large'));
    badge.classList.add(up ? 'is-up' : 'is-down');
    banner.hidden = false;
    banner.replaceChildren(up ? pixelTitle('TIER UP!', 1, { color: PAL.yellow, shadow: PAL.orangeDark }) : h('span', { class: 'muted-note' }, 'Dropped a tier. Bounce back!'));
    if (up) audio.sfx('level_up');
  };

  const play = () => {
    const start = performance.now();
    scope.loop((now) => {
      const p = Math.min(1, (now - start) / COUNT_MS);
      const rating = delta.before + (delta.after - delta.before) * p;
      value.textContent = String(Math.round(rating));
      paintTier(rating);
      if (p < 1) return;
      celebrate();
      return false;
    });
  };

  const el = h(
    'section',
    { class: 'results-panel results-rating' },
    sectionLabel('Rating'),
    h(
      'div',
      { class: 'rating-row' },
      badge,
      h('div', { class: 'rating-main' }, h('div', { class: 'rating-line' }, value, change), h('div', { class: 'rating-line' }, tierName, nextLabel)),
    ),
    bar.el,
    banner,
  );
  return { el, play };
}
