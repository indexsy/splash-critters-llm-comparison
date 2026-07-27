/**
 * The Locker: pick an animal and a hat, with a live 8-bit walk-cycle preview.
 *
 * Selection is optimistic so the preview reacts instantly; the server confirms
 * with a profile_update, which is what the grids actually render from.
 */

import {
  CARDINALS,
  CONFIG,
  levelFromXp,
  type AnimalDef,
  type AnimalId,
  type DirValue,
  type HatDef,
  type HatId,
  type PlayerProfile,
} from '@splash/shared';
import { playSfx } from '../audio';
import { send } from '../net';
import { drawCritter, drawCritterIcon } from '../render/sprites';
import { UI } from '../render/palette';
import { navigate, type Screen } from '../router';
import { getState, subscribe } from '../store';
import { el, panel, screenShell } from '../ui/dom';

/** Preview canvas is 64x64 device pixels shown at 128 CSS pixels. */
const PREVIEW_PX = 64;
const PREVIEW_SCALE = 2;
/**
 * Critters are drawn centred on the point they are given, so the middle of the
 * 32x32 unit space the 2x transform creates puts the sprite dead centre.
 */
const PREVIEW_CENTER = PREVIEW_PX / PREVIEW_SCALE / 2;
const WALK_FRAME_MS = 200;
const TURN_MS = 1200;
/** drawCritterIcon paints an 8x8 portrait centred on the point it is given. */
const ICON_PX = 8;

/** Slot colour used for every preview and icon, so the locker reads consistently. */
const LOCKER_SLOT = 1;

function iconCanvas(animal: AnimalId, hat: HatId): HTMLCanvasElement {
  const canvas = el('canvas', {
    attrs: { 'aria-hidden': 'true' },
    style: { width: '24px', height: '24px', display: 'block', imageRendering: 'pixelated' },
  });
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    drawCritterIcon(ctx, { slot: LOCKER_SLOT, animal, hat }, ICON_PX / 2, ICON_PX / 2);
  }
  return canvas;
}

function gridHost(): HTMLDivElement {
  return el('div', {
    class: 'grid',
    style: { gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' },
  });
}

interface ItemOpts {
  /** Stable identity such as 'animal:otter', used to restore focus after a rebuild. */
  key: string;
  name: string;
  unlockLevel: number;
  level: number;
  selected: boolean;
  icon: HTMLCanvasElement;
  onPick: () => void;
}

function itemButton(opts: ItemOpts): HTMLButtonElement {
  const locked = opts.level < opts.unlockLevel;
  const control = el(
    'button',
    {
      class: `btn ${opts.selected ? 'btn-primary' : 'btn-secondary'}`,
      type: 'button',
      disabled: locked,
      dataset: { lockerKey: opts.key },
      title: locked ? `Unlocks at level ${opts.unlockLevel}` : opts.name,
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        padding: '10px 6px',
      },
      on: { click: opts.onPick },
    },
    opts.icon,
    el('span', { text: opts.name }),
    el('span', {
      class: 'field-hint',
      text: locked ? `Level ${opts.unlockLevel}` : opts.selected ? 'Equipped' : ' ',
    }),
  );
  control.setAttribute('aria-pressed', opts.selected ? 'true' : 'false');
  return control;
}

export function createLockerScreen(): Screen {
  let unsubscribe: (() => void) | null = null;
  let elapsed = 0;
  let animal: AnimalId = 'frog';
  let hat: HatId = 'none';
  let lastProfile: PlayerProfile | null = null;

  const preview = el('canvas', {
    style: {
      width: `${PREVIEW_PX * 2}px`,
      height: `${PREVIEW_PX * 2}px`,
      display: 'block',
      imageRendering: 'pixelated',
      border: '3px solid var(--panel-edge)',
    },
    attrs: { role: 'img', 'aria-label': 'Critter preview' },
  });
  preview.width = PREVIEW_PX;
  preview.height = PREVIEW_PX;
  const previewCtx = preview.getContext('2d');
  if (previewCtx) previewCtx.imageSmoothingEnabled = false;

  const previewLabel = el('div', { class: 'muted', text: '' });
  const header = el('div', { class: 'stack' });
  const animalHost = gridHost();
  const hatHost = gridHost();

  function equip(nextAnimal: AnimalId, nextHat: HatId): void {
    animal = nextAnimal;
    hat = nextHat;
    playSfx('ui');
    send({ t: 'set_cosmetics', animal, hat });
    render();
  }

  function renderHeader(profile: PlayerProfile | null): void {
    if (!profile) {
      header.replaceChildren(el('div', { class: 'muted', text: 'Waiting for your profile...' }));
      return;
    }
    const progress = levelFromXp(profile.xp);
    const capped = profile.level >= CONFIG.MAX_LEVEL;
    header.replaceChildren(
      el(
        'div',
        { class: 'spread' },
        el('span', { class: 'big-number', text: `LV ${profile.level}` }),
        el('span', { class: 'muted', text: `${profile.xp} XP total` }),
      ),
      el(
        'div',
        { class: 'xp-bar' },
        el('span', { style: { width: `${capped ? 100 : (progress.into / progress.needed) * 100}%` } }),
      ),
      el('span', {
        class: 'field-hint',
        text: capped
          ? 'Maximum level reached. Everything is unlocked.'
          : `${progress.into} / ${progress.needed} XP to level ${progress.level + 1}`,
      }),
    );
  }

  function render(): void {
    const profile = getState().profile;
    const level = profile?.level ?? 1;
    // Equipping rebuilds both grids (hat icons wear the new animal), so keep the
    // keyboard where the player left it.
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.lockerKey ?? null;
    const keyed = new Map<string, HTMLButtonElement>();
    renderHeader(profile);

    const build = (opts: ItemOpts): HTMLButtonElement => {
      const control = itemButton(opts);
      keyed.set(opts.key, control);
      return control;
    };

    animalHost.replaceChildren(
      ...CONFIG.ANIMALS.map((def: AnimalDef) =>
        build({
          key: `animal:${def.id}`,
          name: def.name,
          unlockLevel: def.unlockLevel,
          level,
          selected: def.id === animal,
          icon: iconCanvas(def.id, hat),
          onPick: () => equip(def.id, hat),
        }),
      ),
    );

    hatHost.replaceChildren(
      ...CONFIG.HATS.map((def: HatDef) =>
        build({
          key: `hat:${def.id}`,
          name: def.name,
          unlockLevel: def.unlockLevel,
          level,
          selected: def.id === hat,
          icon: iconCanvas(animal, def.id),
          onPick: () => equip(animal, def.id),
        }),
      ),
    );

    if (focusKey) keyed.get(focusKey)?.focus();

    const animalName = CONFIG.ANIMALS.find((a) => a.id === animal)?.name ?? animal;
    const hatName = CONFIG.HATS.find((h) => h.id === hat)?.name ?? hat;
    previewLabel.textContent = hat === 'none' ? animalName : `${animalName} + ${hatName}`;
  }

  /**
   * The server's profile is authoritative, so a rejected pick snaps back. Only a
   * new profile object rebuilds the grids: the store also ticks for pings and
   * toasts, and rebuilding on those would steal focus mid-click.
   */
  function syncFromProfile(): void {
    const profile = getState().profile;
    if (profile === lastProfile) return;
    lastProfile = profile;
    if (profile) {
      animal = profile.selectedAnimal;
      hat = profile.selectedHat;
    }
    render();
  }

  return {
    mount(host: HTMLElement): void {
      lastProfile = getState().profile;
      if (lastProfile) {
        animal = lastProfile.selectedAnimal;
        hat = lastProfile.selectedHat;
      }
      render();
      unsubscribe = subscribe(syncFromProfile);
      host.appendChild(
        screenShell(
          'Locker',
          () => navigate('/menu'),
          panel('Progress', header),
          panel(
            'Preview',
            el(
              'div',
              { class: 'row', style: { alignItems: 'center', gap: '16px' } },
              preview,
              el('div', { class: 'stack' }, previewLabel, el('span', {
                class: 'field-hint',
                text: 'Cosmetics are looks only. They never change how a critter plays.',
              })),
            ),
          ),
          panel('Critters', animalHost),
          panel('Hats', hatHost),
        ),
      );
    },

    unmount(): void {
      unsubscribe?.();
      unsubscribe = null;
    },

    frame(dtMs: number): void {
      if (!previewCtx) return;
      elapsed += dtMs;
      const walkFrame = Math.floor(elapsed / WALK_FRAME_MS) % 2;
      const facing: DirValue = CARDINALS[Math.floor(elapsed / TURN_MS) % CARDINALS.length];

      previewCtx.setTransform(1, 0, 0, 1, 0, 0);
      previewCtx.fillStyle = UI.bg;
      previewCtx.fillRect(0, 0, PREVIEW_PX, PREVIEW_PX);
      previewCtx.setTransform(PREVIEW_SCALE, 0, 0, PREVIEW_SCALE, 0, 0);
      drawCritter(
        previewCtx,
        { slot: LOCKER_SLOT, animal, hat },
        PREVIEW_CENTER,
        PREVIEW_CENTER,
        facing,
        walkFrame,
      );
      previewCtx.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
}
