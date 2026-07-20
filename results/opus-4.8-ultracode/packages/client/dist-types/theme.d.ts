/**
 * Client palette + per-theme tileset colours. Small, pure, no DOM.
 */
import type { MapTheme } from '@splash/shared';
export declare function slotColor(slot: number, colorblind?: boolean): string;
export declare function splashColor(slot: number, colorblind: boolean): string;
export interface ThemePalette {
    floorA: string;
    floorB: string;
    boulder: string;
    boulderShade: string;
    boulderLight: string;
    castle: string;
    castleShade: string;
    castleLight: string;
    water: string;
    waterLight: string;
    accent: string;
}
export declare const THEME_PALETTES: Record<MapTheme, ThemePalette>;
export declare const POWERUP_COLORS: {
    readonly extraBalloon: {
        readonly body: "#ff6f91";
        readonly edge: "#ffd0dc";
    };
    readonly bigSplash: {
        readonly body: "#34d1ff";
        readonly edge: "#c6f3ff";
    };
    readonly flippers: {
        readonly body: "#4ee66a";
        readonly edge: "#cff7d5";
    };
    readonly rubberBoots: {
        readonly body: "#ffd23f";
        readonly edge: "#fff0b8";
    };
};
export declare const EMOTE_TEXT: Record<number, string>;
//# sourceMappingURL=theme.d.ts.map