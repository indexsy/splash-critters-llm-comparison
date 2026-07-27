/**
 * Layout constants and the limited palette everything on the canvas draws from.
 * Keeping the colour list short is what makes the game read as 8-bit.
 */

import { CONFIG, type MapTheme } from '@splash/shared';
import { getSettings } from '../settings';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage';

export const TILE = 16;
export const HUD_HEIGHT = 16;

export interface ArenaLayout {
  tile: number;
  originX: number;
  originY: number;
  pixelWidth: number;
  pixelHeight: number;
}

/** Centres the arena under the HUD strip. Both arena sizes fit exactly. */
export function arenaLayout(width: number, height: number): ArenaLayout {
  const pixelWidth = width * TILE;
  const pixelHeight = height * TILE;
  return {
    tile: TILE,
    originX: Math.floor((STAGE_WIDTH - pixelWidth) / 2),
    originY: HUD_HEIGHT + Math.floor((STAGE_HEIGHT - HUD_HEIGHT - pixelHeight) / 2),
    pixelWidth,
    pixelHeight,
  };
}

export function tileToScreen(layout: ArenaLayout, x: number, y: number): { sx: number; sy: number } {
  return { sx: layout.originX + x * layout.tile, sy: layout.originY + y * layout.tile };
}

/** Distinct player colours, ordered by slot. Chosen to stay apart when soaked. */
export const SLOT_COLORS = ['#ff5d5d', '#4fc3ff', '#8ce65a', '#ffd24a'];
export const SLOT_DARK = ['#8b1f1f', '#1b5c86', '#3a7a22', '#8a6a12'];

export const UI = {
  bg: '#0d1020',
  bgAlt: '#151a30',
  panel: '#232a44',
  panelEdge: '#3d4870',
  ink: '#f2f6ff',
  inkDim: '#8f9bc4',
  gold: '#ffd24a',
  danger: '#ff5d5d',
  good: '#8ce65a',
  water: '#2b6fd6',
  waterLight: '#4fa9f0',
  shadow: '#05060f',
};

/** Splash colours flip to a yellow ramp when the colourblind toggle is on. */
export function splashColors(): string[] {
  return getSettings().colorblindSplash ? CONFIG.SPLASH_COLORS_CB : CONFIG.SPLASH_COLORS;
}

export interface ThemePalette {
  floorA: string;
  floorB: string;
  boulder: string;
  boulderShade: string;
  castle: string;
  castleShade: string;
}

export function themePalette(theme: MapTheme): ThemePalette {
  const def = CONFIG.THEMES.find((t) => t.id === theme) ?? CONFIG.THEMES[0];
  const [floorA, floorB, boulder, boulderShade, castle, castleShade] = def.palette;
  return { floorA, floorB, boulder, boulderShade, castle, castleShade };
}

/** Darkens a hex colour toward black by `amount` (0..1). Used for shading. */
export function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const r = Math.round(((value >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((value >> 8) & 0xff) * (1 - amount));
  const b = Math.round((value & 0xff) * (1 - amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Lightens a hex colour toward white by `amount` (0..1). */
export function tint(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const mix = (channel: number): number => Math.round(channel + (255 - channel) * amount);
  const r = mix((value >> 16) & 0xff);
  const g = mix((value >> 8) & 0xff);
  const b = mix(value & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
