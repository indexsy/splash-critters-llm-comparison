// 16x16 map-theme icons: the theme's own sandcastle tile, or a three-theme mix with a "?" for
// Random. Returned as crisp DOM canvases.
import type { Theme, ThemeChoice } from '@splash/shared';
import { drawText } from '../../render/font';
import { PAL } from '../../render/palette';
import { cached, ctx2d, makeCanvas } from '../../render/pixelart';
import { getCastleTile, getFloorTile } from '../../render/tiles';
import { spriteEl } from './sprite';

const THEMES: readonly Theme[] = ['backyard', 'beach', 'pool'];

function randomIcon(): HTMLCanvasElement {
  return cached('menu:theme-random', () => {
    const cv = makeCanvas(16, 16);
    const ctx = ctx2d(cv);
    THEMES.forEach((theme, i) => {
      const x = Math.round((i * 16) / 3);
      ctx.drawImage(getFloorTile(theme, 0, 0, false), x, 0, 6, 16, x, 0, 6, 16);
    });
    drawText(ctx, '?', 8, 4, { font: 'big', color: PAL.white, align: 'center', shadow: PAL.ink });
    return cv;
  });
}

/** The theme's floor with its sandcastle on top. */
function castleIcon(theme: Theme): HTMLCanvasElement {
  return cached(`menu:theme-${theme}`, () => {
    const cv = makeCanvas(16, 16);
    const ctx = ctx2d(cv);
    ctx.drawImage(getFloorTile(theme, 0, 0, false), 0, 0);
    ctx.drawImage(getCastleTile(theme), 0, 0);
    return cv;
  });
}

function iconCanvas(theme: ThemeChoice): HTMLCanvasElement {
  return theme === 'random' ? randomIcon() : castleIcon(theme);
}

export function themeIconEl(theme: ThemeChoice, scale = 1): HTMLCanvasElement {
  const el = spriteEl(iconCanvas(theme), scale, 'theme-icon');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${theme} map`);
  el.removeAttribute('aria-hidden');
  return el;
}
