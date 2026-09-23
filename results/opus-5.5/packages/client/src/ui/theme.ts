// DOM colour tokens, taken from the one canonical palette (render/palette.ts) so menus and the
// canvas art share exact colours. styles.css only ever references these custom properties.
import { PAL } from '../render/palette';

const TOKENS: Record<string, string> = {
  '--c-letterbox': PAL.ink,
  '--c-ink': PAL.ink,
  '--c-bg': PAL.navy,
  '--c-panel': PAL.navy,
  '--c-panel-hi': PAL.slate,
  '--c-panel-edge': PAL.skyLight,
  '--c-text': PAL.white,
  '--c-muted': PAL.greyLight,
  '--c-dim': PAL.grey,
  '--c-aqua': PAL.aqua,
  '--c-teal': PAL.teal,
  '--c-teal-dark': PAL.greenDeep,
  '--c-sky': PAL.sky,
  '--c-water': PAL.blue,
  '--c-water-dark': PAL.blueDark,
  '--c-sand': PAL.sand,
  '--c-sand-dark': PAL.sandDark,
  '--c-coral': PAL.red,
  '--c-coral-light': PAL.pink,
  '--c-coral-dark': PAL.redDark,
  '--c-grey-dark': PAL.greyDark,
  '--c-focus': PAL.yellow,
  '--c-success': PAL.green,
  '--c-warn': PAL.yellow,
  '--c-error': PAL.red,
};

/** Publish the palette as CSS custom properties on <html>. Call once before rendering UI. */
export function applyThemeTokens(): void {
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(TOKENS)) root.setProperty(name, value);
}

/** Canvas clear colour behind menu screens (matches --c-bg). */
export const MENU_BACKDROP = PAL.navy;
