// The single source of colour for all procedural art: an NES-ish limited palette of named
// colours, the 4 player-identity (slot) colours with a colour-vision-deficiency-safe
// alternative, splash water palettes (normal + colourblind) and the per-theme tile palettes.
import type { Theme } from '@splash/shared';

/** Named palette. Every sprite, tile, glyph and HUD colour comes from here. */
export const PAL = {
  // neutrals
  ink: '#141020',
  shadow: '#2c2440',
  greyDark: '#4c4c5c',
  grey: '#7c7c8c',
  greyLight: '#b4b4c0',
  cloud: '#dcdce8',
  white: '#fcfcfc',
  // warm
  redDark: '#8c1c2c',
  red: '#e03c3c',
  pink: '#f47ca4',
  pinkLight: '#fcc0d0',
  orangeDark: '#b0501c',
  orange: '#f88c24',
  gold: '#d09c14',
  yellow: '#fcd83c',
  yellowLight: '#fcf0a0',
  cream: '#fcecc8',
  // greens
  greenDeep: '#1c4c24',
  greenDark: '#2c7c2c',
  green: '#50b43c',
  greenLight: '#94dc54',
  lime: '#c4f07c',
  teal: '#1c9c8c',
  aqua: '#64d4b4',
  // blues
  navy: '#141c5c',
  slate: '#34406c',
  blueDark: '#1c3c9c',
  blue: '#2c74dc',
  sky: '#5cb4f4',
  skyLight: '#a4dcfc',
  foam: '#e4f8fc',
  // purples
  purpleDark: '#4c2484',
  purple: '#8c4cdc',
  lilac: '#c4a4f4',
  // browns & earth
  brownDark: '#4c2c18',
  brown: '#845430',
  brownLight: '#c08c58',
  tan: '#e4bc84',
  sand: '#f4dca4',
  sandDark: '#d4b474',
  stoneDark: '#5c5850',
  stone: '#948c80',
  stoneLight: '#c4bcac',
} as const;

/** A slot's identity colours: main tone, a lighter highlight and a darker shade. */
export interface SlotColor {
  main: string;
  light: string;
  dark: string;
  /** Short display name for accessibility text. */
  name: string;
}

/** Player identity colours by slot (scarf, balloon tint, HUD chip). */
export const SLOT_COLORS: readonly SlotColor[] = [
  { main: PAL.red, light: PAL.pinkLight, dark: PAL.redDark, name: 'Red' },
  { main: PAL.blue, light: PAL.skyLight, dark: PAL.blueDark, name: 'Blue' },
  { main: PAL.yellow, light: PAL.yellowLight, dark: PAL.gold, name: 'Yellow' },
  { main: PAL.purple, light: PAL.lilac, dark: PAL.purpleDark, name: 'Purple' },
];

/**
 * Colour-vision-deficiency-safe slot colours (Okabe-Ito derived). The four main tones have
 * clearly separated luminance (0.17 / 0.41 / 0.74 / 0.29) so they stay distinct under
 * protanopia, deuteranopia and tritanopia; sprites also add a per-slot pattern (see
 * SLOT_PATTERNS) so identity never relies on hue alone.
 */
export const SLOT_COLORS_CB: readonly SlotColor[] = [
  { main: '#d55e00', light: '#f4a468', dark: '#7c3400', name: 'Vermillion' },
  { main: '#56b4e9', light: '#b8e2f8', dark: '#1c6c9c', name: 'Sky' },
  { main: '#f0e442', light: '#fcf8b4', dark: '#9c9018', name: 'Yellow' },
  { main: '#cc79a7', light: '#ecc4dc', dark: '#7c3c64', name: 'Mauve' },
];

/**
 * Per-slot 1-D pattern used on slot-coloured cloth in colourblind mode:
 * 0 solid, 1 fine light stripes, 2 wide light stripes, 3 fine dark stripes.
 */
export const SLOT_PATTERNS: readonly number[] = [0, 1, 2, 3];

export function slotColor(slot: number, colorblind: boolean): SlotColor {
  const set = colorblind ? SLOT_COLORS_CB : SLOT_COLORS;
  return set[((slot % set.length) + set.length) % set.length];
}

/** Colours of splash water, from the outline inwards. */
export interface SplashPalette {
  edge: string;
  body: string;
  light: string;
  core: string;
  /** Droplet particle colours (random pick per particle). */
  droplets: readonly string[];
}

export const SPLASH: SplashPalette = {
  edge: PAL.blueDark,
  body: PAL.sky,
  light: PAL.skyLight,
  core: PAL.foam,
  droplets: [PAL.sky, PAL.skyLight, PAL.foam, PAL.blue],
};

/**
 * Colourblind splash: extreme luminance contrast (near-white body with a near-black navy
 * rim) so the danger zone reads on grass, sand and pool floors alike, for every CVD type.
 */
export const SPLASH_CB: SplashPalette = {
  edge: '#081848',
  body: '#e8f0fc',
  light: '#fcfcfc',
  core: '#fcfcfc',
  droplets: ['#fcfcfc', '#e8f0fc', '#081848'],
};

export function splashPalette(colorblind: boolean): SplashPalette {
  return colorblind ? SPLASH_CB : SPLASH;
}

/** Tide (flood water) colours shared by every theme. */
export const TIDE = {
  deep: PAL.blueDark,
  body: PAL.blue,
  light: PAL.sky,
  sparkle: PAL.foam,
} as const;

/** Colours of one arena theme. Themes are pure reskins over identical logic. */
export interface ThemePalette {
  name: string;
  floorA: string;
  floorB: string;
  floorDetail: string;
  floorDetailLight: string;
  floorShade: string;
  accentA: string;
  accentB: string;
  borderLight: string;
  borderMid: string;
  borderDark: string;
  pillarLight: string;
  pillarMid: string;
  pillarDark: string;
  castleLight: string;
  castleMid: string;
  castleDark: string;
  castleFlag: string;
  /** Solid colour behind the arena (letterbox / HUD background tint). */
  backdrop: string;
}

export const THEME_PALETTES: Record<Theme, ThemePalette> = {
  backyard: {
    name: 'Backyard',
    floorA: '#5cbc40',
    floorB: '#54b03c',
    floorDetail: PAL.greenDark,
    floorDetailLight: PAL.greenLight,
    floorShade: '#3c8c30',
    accentA: PAL.yellow,
    accentB: PAL.white,
    borderLight: PAL.tan,
    borderMid: PAL.brownLight,
    borderDark: PAL.brown,
    pillarLight: PAL.stoneLight,
    pillarMid: PAL.stone,
    pillarDark: PAL.stoneDark,
    castleLight: PAL.sand,
    castleMid: PAL.tan,
    castleDark: PAL.sandDark,
    castleFlag: PAL.red,
    backdrop: PAL.greenDeep,
  },
  beach: {
    name: 'Beach',
    floorA: '#f4dca4',
    floorB: '#ecd298',
    floorDetail: PAL.sandDark,
    floorDetailLight: PAL.cream,
    floorShade: '#d4b87c',
    accentA: PAL.pinkLight,
    accentB: PAL.orange,
    borderLight: PAL.brownLight,
    borderMid: PAL.brown,
    borderDark: PAL.brownDark,
    pillarLight: PAL.greyLight,
    pillarMid: PAL.grey,
    pillarDark: PAL.greyDark,
    castleLight: PAL.cream,
    castleMid: PAL.sand,
    castleDark: PAL.sandDark,
    castleFlag: PAL.blue,
    backdrop: '#1c5c9c',
  },
  pool: {
    name: 'Pool Party',
    floorA: '#7cccf4',
    floorB: '#74c4ec',
    floorDetail: '#4ca4dc',
    floorDetailLight: PAL.foam,
    floorShade: '#5cacdc',
    accentA: PAL.pink,
    accentB: PAL.yellow,
    borderLight: PAL.white,
    borderMid: PAL.cloud,
    borderDark: PAL.greyLight,
    pillarLight: PAL.pinkLight,
    pillarMid: PAL.pink,
    pillarDark: PAL.redDark,
    castleLight: PAL.yellowLight,
    castleMid: PAL.yellow,
    castleDark: PAL.gold,
    castleFlag: PAL.red,
    backdrop: '#143c6c',
  },
};

/** Per-tier badge colours (rim, fill, emblem) used by the tier badge icons. */
export const TIER_COLORS = {
  puddle: { rim: PAL.greyDark, fill: PAL.greyLight, emblem: PAL.sky, glow: PAL.cloud },
  pond: { rim: PAL.greenDeep, fill: PAL.teal, emblem: PAL.greenLight, glow: PAL.lime },
  river: { rim: PAL.blueDark, fill: PAL.sky, emblem: PAL.foam, glow: PAL.skyLight },
  lake: { rim: PAL.navy, fill: PAL.blue, emblem: PAL.skyLight, glow: PAL.sky },
  ocean: { rim: PAL.navy, fill: PAL.blueDark, emblem: PAL.foam, glow: PAL.sky },
  tsunami: { rim: PAL.brownDark, fill: PAL.purpleDark, emblem: PAL.foam, glow: PAL.yellow },
} as const;
