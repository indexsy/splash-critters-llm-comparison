// How to Play pages: controls (live keybinds), balloons + splashes + chains, power-ups with
// their icons, the Rubber Boots kick, rising tide + revenge ducks, and ranked tiers.
import { CONFIG, Dir, PowerUp, type PowerUpKind } from '@splash/shared';
import { ctx2d } from '../../render/pixelart';
import { getCritter, getItem, getTierBadge } from '../../render/sprites';
import { WATER_FRAMES, WATER_FRAME_MS } from '../../render/tiles';
import { settings, type BindAction } from '../../settings';
import { h, keyLabel, type Child } from '../../ui';
import { burstArt, kickArt, paintTideArt, TIDE_ART_H, TIDE_ART_W } from './howtoArt';
import type { Scope } from './scope';
import { chip } from './shell';
import { pixelCanvas, spriteEl } from './sprite';

export interface HowtoPage {
  title: string;
  build(scope: Scope): Child;
}

const SECONDS = (ticks: number) => Math.round((ticks / CONFIG.TICK_RATE) * 10) / 10;

function art(cv: HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  cv.className = 'sprite howto-art';
  cv.style.setProperty('--w', String(cv.width * scale));
  cv.style.setProperty('--h', String(cv.height * scale));
  cv.setAttribute('aria-hidden', 'true');
  return cv;
}

function kbd(code: string | undefined): HTMLElement {
  return code ? h('kbd', { class: 'howto-kbd' }, keyLabel(code)) : h('kbd', { class: 'howto-kbd is-empty' }, 'none');
}

function keys(action: BindAction): HTMLElement {
  const codes = settings.get().keybinds[action];
  return h('span', { class: 'howto-keys' }, codes.length ? codes.map((c) => kbd(c)) : kbd(undefined));
}

const MOVE_ACTIONS = ['up', 'left', 'down', 'right'] as const;

/**
 * Move keys grouped by binding set, one unbreakable row each: "W A S D" (every direction's
 * first key), then "or" and the second keys ("UP LEFT DOWN RIGHT" by default).
 */
function moveKeys(): HTMLElement {
  const binds = settings.get().keybinds;
  const sets = Math.max(1, ...MOVE_ACTIONS.map((a) => binds[a].length));
  const rows = Array.from({ length: sets }, (_, i) =>
    h('span', { class: 'howto-move-set' }, i > 0 ? h('span', { class: 'howto-or' }, 'or') : null, MOVE_ACTIONS.map((a) => kbd(binds[a][i]))),
  );
  return h('span', { class: 'howto-move' }, rows);
}

function lines(...items: Child[]): HTMLElement {
  return h('ul', { class: 'howto-lines' }, items.map((i) => h('li', null, i)));
}

function controls(): Child {
  const cb = settings.get().colorblind;
  return h(
    'div',
    { class: 'howto-split' },
    h('div', { class: 'howto-figure' }, spriteEl(getCritter('frog', 'bucket', Dir.Down, 0, 0, cb), 3)),
    h(
      'div',
      { class: 'howto-keytable' },
      h('span', null, 'Move'),
      moveKeys(),
      h('span', null, 'Drop balloon'),
      keys('balloon'),
      h('span', null, 'Emotes'),
      h('span', { class: 'howto-keys' }, (['emote1', 'emote2', 'emote3', 'emote4'] as const).map((a) => keys(a))),
      h('span', null, 'Mute'),
      keys('mute'),
      h('p', { class: 'muted-note howto-span' }, 'Remap any key in Settings. Last critter dry wins the round!'),
    ),
  );
}

function balloons(): Child {
  return h(
    'div',
    { class: 'howto-col' },
    art(burstArt()),
    lines(
      `A balloon bursts ${SECONDS(CONFIG.FUSE_TICKS)} s after you drop it, splashing in a cross.`,
      'Each arm stops at the first sandcastle and washes it away. Pillars block it.',
      'Any splash that touches another balloon pops it at once: DOUBLE SPLASH, TRIPLE SPLASH!',
      'Get splashed and you are soaked for the round. You can walk off your own balloon, not back on.',
    ),
  );
}

const POWERUPS: { kind: PowerUpKind; name: string; text: string }[] = [
  { kind: PowerUp.Balloon, name: 'Extra Balloon', text: `+1 balloon at a time (max ${CONFIG.BALLOONS_CAP})` },
  { kind: PowerUp.Range, name: 'Big Splash', text: `+1 splash reach (max ${CONFIG.RANGE_CAP})` },
  { kind: PowerUp.Speed, name: 'Flippers', text: 'Run faster' },
  { kind: PowerUp.Boots, name: 'Rubber Boots', text: 'Kick balloons (rare!)' },
];

function powerups(): Child {
  return h(
    'div',
    { class: 'howto-col' },
    h(
      'div',
      { class: 'howto-items' },
      POWERUPS.map((p) => {
        const icon = getItem(p.kind, 0);
        return h('div', { class: 'howto-item' }, icon ? spriteEl(icon, 2) : null, h('div', null, h('div', { class: 'howto-item-name' }, p.name), h('div', { class: 'muted-note' }, p.text)));
      }),
    ),
    lines(
      `${Math.round(CONFIG.POWERUP_BLOCK_CHANCE * 100)}% of sandcastles hide a power-up. Wash one away to reveal it, then walk over it.`,
      'Careful: a splash destroys power-ups lying in the open.',
    ),
  );
}

function kick(): Child {
  return h(
    'div',
    { class: 'howto-col' },
    art(kickArt(), 2),
    lines(
      'With Rubber Boots, walk into a balloon to kick it.',
      'It slides until it hits a wall, a sandcastle, another balloon or a critter, and its fuse keeps ticking.',
    ),
  );
}

function tide(scope: Scope): Child {
  const canvas = pixelCanvas(TIDE_ART_W, TIDE_ART_H, 1, 'howto-art');
  const ctx = ctx2d(canvas);
  let frame = 0;
  paintTideArt(ctx, frame);
  scope.interval(() => {
    frame = (frame + 1) % WATER_FRAMES;
    paintTideArt(ctx, frame);
  }, WATER_FRAME_MS);
  return h(
    'div',
    { class: 'howto-col' },
    canvas,
    lines(
      `Rising Tide: at ${Math.floor(CONFIG.TIDE_START_TICKS / CONFIG.TICK_RATE / 60)}:00 the water floods in from the edge, one ring every ${SECONDS(CONFIG.TIDE_INTERVAL_TICKS)} s. Flooded tiles soak you.`,
      `Revenge Ducks (casual): soaked critters ride the border and lob a balloon every ${SECONDS(CONFIG.DUCK_LOB_COOLDOWN_TICKS)} s. Revenge soaks score no points.`,
    ),
  );
}

function tiers(): Child {
  return h(
    'div',
    { class: 'howto-col' },
    h(
      'div',
      { class: 'howto-tiers' },
      CONFIG.TIERS.map((t) =>
        h('div', { class: 'howto-tier' }, spriteEl(getTierBadge(t.id, 'large')), h('span', null, t.name), h('span', { class: 'muted-note' }, Number.isFinite(t.min) ? `${t.min}+` : `< ${CONFIG.TIERS[1].min}`)),
      ),
    ),
    lines(
      h('span', null, chip('Duel'), ' 1 vs 1 and ', chip('FFA'), ' 4 players: separate queues and ratings.'),
      `Everyone starts at ${CONFIG.ELO_START}. Placement is by round wins, then soaks. Ranked is humans only.`,
    ),
  );
}

export const HOWTO_PAGES: readonly HowtoPage[] = [
  { title: 'Controls', build: controls },
  { title: 'Balloons & Splashes', build: balloons },
  { title: 'Power-ups', build: powerups },
  { title: 'Kicking', build: kick },
  { title: 'Tide & Ducks', build: tide },
  { title: 'Ranked Tiers', build: tiers },
];
