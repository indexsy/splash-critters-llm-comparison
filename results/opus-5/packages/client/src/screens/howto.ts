/**
 * How to Play. Everything a new player needs in one scroll, with the control
 * list read live from settings so a remapped key never contradicts this page.
 */

import { CONFIG } from '@splash/shared';
import { playSfx } from '../audio';
import type { Screen } from '../router';
import { navigate } from '../router';
import { ACTION_LABELS, getSettings, onSettingsChange, type ActionId } from '../settings';
import { el, panel, screenShell } from '../ui/dom';

const CONTROL_ORDER: ActionId[] = ['up', 'down', 'left', 'right', 'drop'];
const EMOTE_ORDER: ActionId[] = ['emote1', 'emote2', 'emote3', 'emote4'];

function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return `${code.slice(5)} arrow`;
  switch (code) {
    case 'Space':
      return 'Spacebar';
    case 'ShiftLeft':
      return 'Left shift';
    case 'ShiftRight':
      return 'Right shift';
    case 'ControlLeft':
      return 'Left ctrl';
    case 'ControlRight':
      return 'Right ctrl';
    case 'Escape':
      return 'Esc';
    default:
      return code;
  }
}

function bindText(action: ActionId): string {
  const codes = getSettings().keybinds[action];
  if (codes.length === 0) return 'Unbound';
  return codes.map(keyLabel).join(' or ');
}

/** One "term: explanation" line. Terms are marked up, never colour-coded only. */
function entry(term: string, body: string): HTMLElement {
  return el(
    'p',
    { class: 'stack' },
    el('strong', { text: term }),
    el('span', { class: 'muted', text: body }),
  );
}

function controlRow(action: ActionId): HTMLElement {
  return el(
    'div',
    { class: 'spread' },
    el('span', { text: ACTION_LABELS[action] }),
    el('span', { class: 'badge', text: bindText(action) }),
  );
}

function seconds(ticks: number): string {
  const value = ticks / CONFIG.TICK_RATE;
  return Number.isInteger(value) ? `${value}s` : `${value.toFixed(1)}s`;
}

function minutes(ticks: number): string {
  const total = Math.round(ticks / CONFIG.TICK_RATE);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function tierLine(): string {
  return CONFIG.RANK_TIERS.map((tier) => {
    if (tier.min === -Infinity) return `${tier.name} below ${tier.max + 1}`;
    if (tier.max === Infinity) return `${tier.name} ${tier.min}+`;
    return `${tier.name} ${tier.min} to ${tier.max}`;
  }).join(' - ');
}

export function createHowToScreen(): Screen {
  let unsubscribe: (() => void) | null = null;
  const controls = el('div', { class: 'stack' });
  const emotes = el('div', { class: 'stack' });

  function renderControls(): void {
    controls.replaceChildren(...CONTROL_ORDER.map(controlRow));
    emotes.replaceChildren(...EMOTE_ORDER.map(controlRow));
  }

  return {
    mount(host) {
      renderControls();

      host.appendChild(
        screenShell(
          'How to Play',
          () => {
            playSfx('ui_back');
            navigate('/menu');
          },
          panel(
            'The goal',
            el('p', {
              class: 'muted',
              text: 'Drop water balloons, wash away sandcastles, and soak everyone else. The last critter still dry wins the round; first to the round target wins the match.',
            }),
          ),
          panel(
            'Controls',
            controls,
            el('p', { class: 'field-hint', text: 'Remap any of these in Settings.' }),
          ),
          panel(
            'Splashes',
            entry(
              'Fuse',
              `A dropped balloon wobbles for ${seconds(CONFIG.FUSE_TICKS)} and then bursts. It is solid once placed, but you may step off the tile you dropped it on.`,
            ),
            entry(
              'The cross',
              `A burst throws water ${CONFIG.RANGE_BASE} tiles in each direction to start with. Boulders stop it dead, and each arm washes away the first sandcastle it reaches and goes no further.`,
            ),
            entry(
              'Getting soaked',
              `Water lingers for about ${seconds(CONFIG.SPLASH_TICKS)}. Touch any of it and you are out for the round. Two critters soaked on the same tick means a drawn round.`,
            ),
          ),
          panel(
            'Chain bursts',
            el('p', {
              class: 'muted',
              text: 'Water that touches another balloon sets it off immediately, and that balloon uses its own range. Line your balloons up and one burst can clear half the arena. The announcer calls out double and triple splashes.',
            }),
          ),
          panel(
            'Power-ups',
            el('p', {
              class: 'muted',
              text: 'Sandcastles hide power-ups. Wash a castle away to reveal what was inside, then walk over it to collect. An exposed power-up caught in a splash is destroyed.',
            }),
            entry('Extra Balloon', `One more balloon out at a time, up to ${CONFIG.BALLOONS_CAP}.`),
            entry('Big Splash', `One more tile of reach in every direction, up to ${CONFIG.RANGE_CAP}.`),
            entry('Flippers', `Move faster, up to ${CONFIG.SPEED_CAP} tiles a second.`),
            entry('Rubber Boots', 'Rare. Lets you kick balloons for the rest of the round.'),
          ),
          panel(
            'The kick',
            el('p', {
              class: 'muted',
              text: 'With Rubber Boots on, walking into a balloon boots it down the lane. It slides until it hits a boulder, a sandcastle, another balloon or a critter, and its fuse keeps ticking the whole way. Perfect for returning a gift to sender.',
            }),
          ),
          panel(
            'The Rising Tide',
            el('p', {
              class: 'muted',
              text: `At ${minutes(CONFIG.TIDE_START_TICKS)} the water starts rising. Tiles flood one ring at a time from the outside in, roughly every ${seconds(CONFIG.TIDE_RING_TICKS)}. Flooded tiles dissolve sandcastles and soak anyone standing in them, so no round can stall forever.`,
            }),
          ),
          panel(
            'Revenge ducks',
            el('p', {
              class: 'muted',
              text: `Get soaked in a casual match and you come back as a rubber duck paddling the arena border. Every ${seconds(CONFIG.REVENGE_LOB_COOLDOWN_TICKS)} you can lob a balloon ${CONFIG.REVENGE_LOB_TILES} tiles into the fight. Revenge soaks count in your stats but score no points, and ducks are switched off in ranked.`,
            }),
          ),
          panel('Emotes', emotes, el('p', { class: 'field-hint', text: 'Quick animal noises with a pixel speech bubble. Rate limited, so spam politely.' })),
          panel(
            'Ranked, Elo and tiers',
            entry(
              'Two ladders',
              `Duel and Free-for-All have separate queues and separate ratings. Everyone starts at ${CONFIG.ELO_START}.`,
            ),
            entry(
              'Rating moves',
              `Your first ${CONFIG.ELO_PROVISIONAL_GAMES} games in a mode move your rating fast, then settle down. In Free-for-All you are scored against each of the other three critters separately, so finishing second still earns something.`,
            ),
            entry('Tiers', tierLine()),
            entry(
              'Leaving',
              `Disconnect in ranked and you have ${Math.round(CONFIG.RECONNECT_GRACE_MS / 1000)} seconds to get back before it counts as a forfeit. Bots never fill in for a ranked player.`,
            ),
          ),
        ),
      );

      unsubscribe = onSettingsChange(renderControls);
    },

    unmount() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
