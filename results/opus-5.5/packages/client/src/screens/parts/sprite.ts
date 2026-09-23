// DOM helpers for pixel art: sprite getters return shared cached canvases, which must never be
// inserted into the DOM themselves (a node lives in one place only), so these make crisp copies
// sized in backbuffer pixels (CSS --w/--h times --u).
import type { AnimalId, HatId, TierId } from '@splash/shared';
import { textToCanvas, type FontId } from '../../render/font';
import { PAL } from '../../render/palette';
import { ctx2d, makeCanvas } from '../../render/pixelart';
import { getPortrait, getTierBadge, type BadgeSize } from '../../render/sprites';
import { settings } from '../../settings';
import './styles/base.css';

/** Copy of `src` displayed at `scale` backbuffer pixels per sprite pixel. */
export function spriteEl(src: HTMLCanvasElement, scale = 1, className = ''): HTMLCanvasElement {
  const cv = makeCanvas(src.width, src.height);
  ctx2d(cv).drawImage(src, 0, 0);
  cv.className = ['sprite', className].filter(Boolean).join(' ');
  cv.style.setProperty('--w', String(src.width * scale));
  cv.style.setProperty('--h', String(src.height * scale));
  cv.setAttribute('aria-hidden', 'true');
  return cv;
}

/** A blank crisp canvas of w x h backbuffer pixels (for live previews drawn every frame). */
export function pixelCanvas(w: number, h: number, scale = 1, className = ''): HTMLCanvasElement {
  const cv = makeCanvas(w, h);
  cv.className = ['sprite', className].filter(Boolean).join(' ');
  cv.style.setProperty('--w', String(w * scale));
  cv.style.setProperty('--h', String(h * scale));
  cv.setAttribute('aria-hidden', 'true');
  return cv;
}

export interface PixelLabelOptions {
  font?: FontId;
  color?: string;
  shadow?: string;
  scale?: number;
}

/** Bitmap-font text as a crisp DOM canvas (for numbers and tags that must look 8-bit). */
export function pixelLabel(text: string, opts: PixelLabelOptions = {}): HTMLCanvasElement {
  const src = textToCanvas(text, { font: opts.font ?? 'big', color: opts.color ?? PAL.white, shadow: opts.shadow });
  const el = spriteEl(src, opts.scale ?? 1, 'pixel-label');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', text);
  el.removeAttribute('aria-hidden');
  return el;
}

/** Framed critter head for a player (slot colours the frame; colourblind setting respected). */
export function portraitEl(animal: AnimalId, hat: HatId, slot: number, scale = 1): HTMLCanvasElement {
  return spriteEl(getPortrait(animal, hat, slot, settings.get().colorblind), scale, 'portrait');
}

export function tierBadgeEl(tier: TierId, size: BadgeSize = 'small', scale = 1): HTMLCanvasElement {
  const el = spriteEl(getTierBadge(tier, size), scale, 'tier-badge');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${tier} tier`);
  el.removeAttribute('aria-hidden');
  return el;
}
