// Settings tab 1: SFX / music volume, mute (with its current key), colourblind-safe splash
// palette, reduced screen shake and the ping readout. Controls stay in sync when settings change
// elsewhere (e.g. the mute key pressed while this tab is open).
import { Dir } from '@splash/shared';
import { ctx2d } from '../../render/pixelart';
import { getBalloon, getSplash } from '../../render/sprites';
import { getFloorTile, TILE } from '../../render/tiles';
import { settings, type Settings } from '../../settings';
import { h, keyLabel, slider, toggle, type Control } from '../../ui';
import type { Scope } from './scope';
import { sectionLabel } from './shell';
import { pixelCanvas } from './sprite';

const PREVIEW_TILES = 5;

/** A strip of backyard floor with a splash and the four player balloons in the active palette. */
function paintPalettePreview(cv: HTMLCanvasElement, colorblind: boolean): void {
  const ctx = ctx2d(cv);
  for (let x = 0; x < PREVIEW_TILES; x++) {
    for (let y = 0; y < 2; y++) ctx.drawImage(getFloorTile('backyard', x + y, (x + y) & 1, false), x * TILE, y * TILE);
  }
  ctx.drawImage(getSplash('end', Dir.Left, 1, colorblind), 0, 0);
  ctx.drawImage(getSplash('arm', Dir.Left, 1, colorblind), TILE, 0);
  ctx.drawImage(getSplash('center', Dir.None, 1, colorblind), 2 * TILE, 0);
  ctx.drawImage(getSplash('arm', Dir.Right, 1, colorblind), 3 * TILE, 0);
  ctx.drawImage(getSplash('end', Dir.Right, 1, colorblind), 4 * TILE, 0);
  for (let slot = 0; slot < 4; slot++) ctx.drawImage(getBalloon(2, slot, colorblind, false), (slot + 0.5) * TILE, TILE);
}

function muteLabel(s: Readonly<Settings>): string {
  const key = s.keybinds.mute[0];
  return key ? `Mute all sound (${keyLabel(key)})` : 'Mute all sound';
}

export function generalSettings(scope: Scope): HTMLElement {
  const s = settings.get();
  const sfx = slider({ label: 'Sound effects', value: s.sfxVolume, onChange: (v) => settings.set({ sfxVolume: v }) });
  const music = slider({ label: 'Music', value: s.musicVolume, onChange: (v) => settings.set({ musicVolume: v }) });
  const mute = toggle(muteLabel(s), s.muted, (on) => settings.set({ muted: on }));
  const colorblind = toggle('Colorblind-safe splashes', s.colorblind, (on) => settings.set({ colorblind: on }));
  const shake = toggle('Reduce screen shake', s.reducedShake, (on) => settings.set({ reducedShake: on }));
  const ping = toggle('Show ping', s.showPing, (on) => settings.set({ showPing: on }));
  const preview = pixelCanvas(PREVIEW_TILES * TILE, 2 * TILE, 1, 'settings-preview');
  paintPalettePreview(preview, s.colorblind);
  const toggles: [Control<boolean>, keyof Settings][] = [
    [mute, 'muted'],
    [colorblind, 'colorblind'],
    [shake, 'reducedShake'],
    [ping, 'showPing'],
  ];

  scope.add(
    settings.subscribe((next, prev) => {
      if (next.colorblind !== prev.colorblind) paintPalettePreview(preview, next.colorblind);
      sfx.set(next.sfxVolume);
      music.set(next.musicVolume);
      for (const [ctl, key] of toggles) ctl.set(next[key] as boolean);
      const label = mute.el.querySelector('.toggle-label');
      if (label) label.textContent = muteLabel(next);
    }),
  );

  return h(
    'div',
    { class: 'settings-general' },
    h('div', { class: 'settings-col' }, sectionLabel('Audio'), sfx.el, music.el, mute.el, sectionLabel('Display'), shake.el, ping.el),
    h(
      'div',
      { class: 'settings-col' },
      sectionLabel('Colors'),
      colorblind.el,
      h('p', { class: 'muted-note' }, 'High-contrast splash water and player colors that stay distinct for every type of color blindness.'),
      h('div', { class: 'settings-preview-wrap' }, preview),
    ),
  );
}
