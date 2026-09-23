// Rotating gameplay tips for the main menu (one line, changes every few seconds).
import { h } from '../../ui';
import type { Scope } from './scope';
import { chip } from './shell';

const TIP_MS = 6500;

const TIPS: readonly string[] = [
  'A splash that touches another balloon pops it instantly. Chain them!',
  'Splashes stop at the first sandcastle they wash away.',
  'Rubber Boots let you kick a balloon: walk into it and it slides.',
  'At 2:00 the tide rises from the edges. Head for the middle!',
  'Soaked? Ride your duck around the border and lob revenge balloons.',
  'Your balloon is solid once you step off it. Plan an escape route.',
  'Ranked tiers climb from Puddle all the way up to Tsunami.',
  'Level up to unlock new critters and hats in the Locker.',
  'Emote keys (1-4 by default): quack, ribbit, squeak and honk.',
];

/** Tip line that cycles through TIPS until `scope` is disposed. */
export function tipTicker(scope: Scope): HTMLElement {
  let index = Math.floor(Math.random() * TIPS.length);
  const text = h('span', { class: 'tip-text' }, TIPS[index]);
  scope.interval(() => {
    index = (index + 1) % TIPS.length;
    text.textContent = TIPS[index];
    text.classList.remove('tip-in');
    void text.offsetWidth;
    text.classList.add('tip-in');
  }, TIP_MS);
  return h('div', { class: 'menu-tip', role: 'status', 'aria-live': 'polite' }, chip('Tip', 'teal'), text);
}
