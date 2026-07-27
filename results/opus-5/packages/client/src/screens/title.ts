/**
 * Title screen. The canvas carries the animated logo, a strolling parade of
 * critters and bobbing balloons; the DOM underneath carries the two decisions a
 * player can make here (tutorial or straight into the menu).
 *
 * Audio is unlocked here because this is the first screen that ever sees a user
 * gesture, and browsers refuse to start an AudioContext before one.
 */

import { displayName, levelFromXp, type AnimalId, type HatId } from '@splash/shared';
import { initAudio, playSfx, startMusic } from '../audio';
import { UI, shade } from '../render/palette';
import { drawBalloon, drawCritterIcon, drawLogo } from '../render/sprites';
import { drawText } from '../render/text';
import type { Screen } from '../router';
import { navigate } from '../router';
import { STAGE_HEIGHT, STAGE_WIDTH, getContext, showStage } from '../stage';
import { getState, subscribe } from '../store';
import { button, el, panel } from '../ui/dom';

interface Walker {
  animal: AnimalId;
  hat: HatId;
  slot: number;
  /** Stage x in pixels; wraps once the critter walks off the right edge. */
  x: number;
  speed: number;
  bob: number;
}

interface Droplet {
  x: number;
  y: number;
  phase: number;
  slot: number;
}

const HORIZON = 168;
const PARADE_Y = 186;

function makeWalkers(): Walker[] {
  const cast: Array<[AnimalId, HatId]> = [
    ['frog', 'none'],
    ['duck', 'bucket'],
    ['otter', 'snorkel'],
    ['penguin', 'crown'],
  ];
  return cast.map(([animal, hat], i) => ({
    animal,
    hat,
    slot: i,
    x: -40 - i * 74,
    speed: 15 + i * 3,
    bob: i * 1.7,
  }));
}

/** The wordmark and both taglines, which balloons must stay out of. */
const LOGO_BOX = { left: 26, right: 230, top: 16, bottom: 142 };

function makeDroplets(): Droplet[] {
  const out: Droplet[] = [];
  for (let i = 0; i < 10; i++) {
    // Deterministic scatter: a cheap hash of the index keeps the field stable
    // across frames without carrying a PRNG around.
    const x = 20 + ((i * 53) % 218);
    let y = 24 + ((i * 41) % 116);
    // Balloons are the same blue as the wordmark, so one drifting behind a
    // letter reads as part of it. Push them clear rather than layering them.
    if (x > LOGO_BOX.left && x < LOGO_BOX.right && y > LOGO_BOX.top && y < LOGO_BOX.bottom) {
      y = LOGO_BOX.bottom + ((i * 17) % 40);
    }
    out.push({ x, y, phase: (i * 0.7) % (Math.PI * 2), slot: i % 4 });
  }
  return out;
}

function drawBackdrop(ctx: CanvasRenderingContext2D, t: number): void {
  ctx.fillStyle = UI.bg;
  ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

  // Layered water bands under the horizon, each shimmering at its own rate.
  for (let i = 0; i < 4; i++) {
    const top = HORIZON + i * 6;
    ctx.fillStyle = i % 2 === 0 ? UI.water : shade(UI.water, 0.25);
    ctx.fillRect(0, top, STAGE_WIDTH, 6);
    ctx.fillStyle = shade(UI.waterLight, 0.1);
    const offset = Math.floor((t * (10 + i * 6)) % 32);
    for (let x = -32 + offset; x < STAGE_WIDTH; x += 32) {
      ctx.fillRect(x, top + 2, 6, 1);
      ctx.fillRect(x + 14, top + 4, 4, 1);
    }
  }

  ctx.fillStyle = shade(UI.water, 0.55);
  ctx.fillRect(0, HORIZON + 24, STAGE_WIDTH, STAGE_HEIGHT - HORIZON - 24);
}

export function createTitleScreen(): Screen {
  const walkers = makeWalkers();
  const droplets = makeDroplets();
  let elapsed = 0;
  let signature = '';
  let unsubscribe: (() => void) | null = null;
  let gestureBound = false;

  const actions = el('div', { class: 'stack' });
  const identity = el('p', { class: 'center', text: 'Connecting...' });
  const hint = el('p', { class: 'muted center', text: 'Waiting for the server.' });

  function unlockAudio(): void {
    if (!gestureBound) return;
    gestureBound = false;
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    initAudio();
    startMusic('title');
  }

  function go(path: string): void {
    playSfx('ui');
    navigate(path);
  }

  function renderActions(): void {
    const state = getState();
    const profile = state.profile;
    const next = `${state.ready}|${profile?.tutorialDone ?? false}|${profile?.nickname ?? ''}|${profile?.tag ?? ''}|${profile?.xp ?? 0}`;
    if (next === signature) return;
    signature = next;

    if (!state.ready || !profile) {
      identity.textContent = state.connected ? 'Connecting...' : 'Offline. Retrying...';
      hint.textContent = state.connected
        ? 'Setting up your critter.'
        : 'Lost the server. The game reconnects on its own.';
      actions.replaceChildren(button('Play', () => undefined, { variant: 'primary', wide: true, disabled: true }));
      return;
    }

    const { level } = levelFromXp(profile.xp);
    identity.textContent = displayName(profile.nickname, profile.tag);
    hint.textContent = `Level ${level}`;

    if (!profile.tutorialDone) {
      actions.replaceChildren(
        button('Play tutorial', () => go('/tutorial'), { variant: 'primary', wide: true }),
        button('Skip to menu', () => go('/menu'), { wide: true }),
      );
      return;
    }
    actions.replaceChildren(
      button('Play', () => go('/menu'), { variant: 'primary', wide: true }),
      button('Replay tutorial', () => go('/tutorial'), { wide: true }),
      button('How to play', () => go('/howto'), { wide: true }),
    );
  }

  return {
    mount(host) {
      showStage(true);
      gestureBound = true;
      window.addEventListener('pointerdown', unlockAudio);
      window.addEventListener('keydown', unlockAudio);

      host.appendChild(
        el(
          'div',
          { class: 'screen-shell' },
          panel(null, identity, hint, actions),
          el('p', {
            class: 'muted center',
            text: 'Drop balloons, wash away sandcastles, stay dry. Last critter dry wins.',
          }),
        ),
      );
      renderActions();
      unsubscribe = subscribe(renderActions);
    },

    unmount() {
      unsubscribe?.();
      unsubscribe = null;
      if (gestureBound) {
        gestureBound = false;
        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
      }
      showStage(false);
    },

    frame(dtMs) {
      const dt = dtMs / 1000;
      elapsed += dt;
      const ctx = getContext();
      drawBackdrop(ctx, elapsed);

      // Balloons first so the wordmark always sits on top of them.
      for (const drop of droplets) {
        const y = drop.y + Math.sin(elapsed * 1.6 + drop.phase) * 3;
        // A low fuse value keeps the wobble lazy and stops the balloon flashing.
        const wobble = 0.25 + 0.18 * Math.sin(elapsed * 1.1 + drop.phase);
        drawBalloon(ctx, drop.x, Math.round(y), wobble, drop.slot);
      }

      drawLogo(ctx, STAGE_WIDTH / 2, 54, elapsed);
      drawText(ctx, 'Online water balloon battler', STAGE_WIDTH / 2, 118, UI.inkDim, {
        align: 'center',
        shadow: UI.shadow,
      });
      drawText(ctx, 'Last critter dry wins', STAGE_WIDTH / 2, 132, UI.gold, {
        align: 'center',
        shadow: UI.shadow,
      });

      for (const walker of walkers) {
        walker.x += walker.speed * dt;
        if (walker.x > STAGE_WIDTH + 24) walker.x = -24;
        const bob = Math.sin(elapsed * 6 + walker.bob) > 0 ? 0 : 1;
        const look = { animal: walker.animal, hat: walker.hat, slot: walker.slot };
        drawCritterIcon(ctx, look, Math.round(walker.x), PARADE_Y + bob);
      }
    },
  };
}
