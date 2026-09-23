// Arena placement on the 256x224 backbuffer (ARCHITECTURE section 7), sub-unit -> pixel
// conversion, and the screen shake applied to the arena layer (the HUD never shakes).
import { CONFIG } from '@splash/shared';
import { TILE } from './tiles';

export const SCREEN_W = 256;
export const SCREEN_H = 224;
/** HUD strip height when the arena fills the screen (FFA 240x208). */
const COMPACT_HUD_H = 16;

export interface ArenaLayout {
  /** Arena top-left and size in backbuffer pixels. */
  ax: number;
  ay: number;
  aw: number;
  ah: number;
  /** 'compact': one 16 px strip (FFA); 'roomy': taller strips above and below (Duel, tutorial). */
  hud: 'compact' | 'roomy';
  /** Height of the HUD strip above the arena. */
  topH: number;
  /** Strip below the arena (kill feed in roomy layouts). */
  bottomY: number;
  bottomH: number;
}

/**
 * FFA (15x13 = 240x208) sits under a 16 px HUD strip; smaller arenas (Duel 13x11 = 208x176,
 * the 11x9 tutorial) are centred with roomier strips above and below.
 */
export function arenaLayout(w: number, h: number): ArenaLayout {
  const aw = w * TILE;
  const ah = h * TILE;
  const ax = Math.floor((SCREEN_W - aw) / 2);
  if (ah + COMPACT_HUD_H >= SCREEN_H) {
    const ay = SCREEN_H - ah;
    return { ax, ay, aw, ah, hud: 'compact', topH: ay, bottomY: SCREEN_H, bottomH: 0 };
  }
  const ay = Math.floor((SCREEN_H - ah) / 2);
  return { ax, ay, aw, ah, hud: 'roomy', topH: ay, bottomY: ay + ah, bottomH: SCREEN_H - ay - ah };
}

/** Sub-units -> arena pixels (rounded to whole pixels). */
export function subToPx(sub: number): number {
  return Math.round((sub * TILE) / CONFIG.SUB);
}

/** Pixel center of a tile, relative to the arena origin. */
export function tilePx(t: number): number {
  return t * TILE + TILE / 2;
}

/** Stereo pan (-1..1) for a sound at arena tile column `tx`. */
export function panForTile(tx: number, w: number): number {
  return w > 1 ? Math.max(-1, Math.min(1, (tx / (w - 1)) * 2 - 1)) * 0.7 : 0;
}

const SHAKE_MS = 260;

/** Decaying screen shake; the strongest active kick wins. */
export class Shake {
  private amp = 0;
  private start = 0;

  kick(px: number, nowMs: number): void {
    if (px >= this.current(nowMs)) {
      this.amp = px;
      this.start = nowMs;
    }
  }

  private current(nowMs: number): number {
    const t = (nowMs - this.start) / SHAKE_MS;
    return t >= 1 ? 0 : this.amp * (1 - t);
  }

  /** Whole-pixel offset for this frame (zero when shake is turned off in settings). */
  offset(nowMs: number, disabled: boolean): { x: number; y: number } {
    const a = disabled ? 0 : this.current(nowMs);
    if (a < 0.5) return { x: 0, y: 0 };
    const phase = nowMs / 16;
    return { x: Math.round(Math.sin(phase * 2.3) * a), y: Math.round(Math.cos(phase * 1.7) * a) };
  }
}
