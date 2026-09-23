// MATCH FOUND! flash for the queue screen: every matched player with portrait, name#tag,
// rating and tier badge ("VS" between the two in a duel).
import type { MatchPlayerInfo } from '@splash/shared';
import { net } from '../../net';
import { PAL } from '../../render/palette';
import type { MatchFoundInfo } from '../../store';
import { h, pixelTitle, spinner } from '../../ui';
import { chip, nameTagEl } from './shell';
import { portraitEl, tierBadgeEl } from './sprite';

function playerCard(p: MatchPlayerInfo): HTMLElement {
  const you = p.playerId !== null && p.playerId === net.playerId;
  return h(
    'div',
    { class: `found-player${you ? ' is-you' : ''}` },
    portraitEl(p.animal, p.hat, p.slot, 2),
    nameTagEl(p.name, p.tag, 'found-name'),
    h(
      'span',
      { class: 'found-rating' },
      p.tier ? tierBadgeEl(p.tier) : null,
      p.rating !== undefined ? String(p.rating) : `Lv ${p.level}`,
      you ? chip('You', 'sand') : null,
    ),
  );
}

export function matchFoundView(found: MatchFoundInfo): HTMLElement {
  const players = [...found.players].sort((a, b) => a.slot - b.slot);
  const cards: HTMLElement[] = [];
  players.forEach((p, i) => {
    if (found.mode === 'duel' && i === 1) cards.push(h('span', { class: 'found-vs' }, pixelTitle('VS', 2, { color: PAL.red })));
    cards.push(playerCard(p));
  });
  return h(
    'div',
    { class: 'found', role: 'alert' },
    h('div', { class: 'found-flash' }, pixelTitle('MATCH FOUND!', 2, { color: PAL.yellow, shadow: PAL.orangeDark })),
    h('div', { class: `found-players found-${found.mode}` }, cards),
    h('div', { class: 'found-wait' }, spinner('Get ready')),
  );
}
