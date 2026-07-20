/**
 * Client palette + per-theme tileset colours. Small, pure, no DOM.
 */
// per-slot player colours (matches CSS --p0..--p3) + colourblind-safe alternates
const SLOT_COLORS = ['#ff5d73', '#34d1ff', '#4ee66a', '#ffd23f'];
const SLOT_COLORS_CB = ['#e66100', '#3b82f6', '#ffffff', '#9d4edd']; // orange/blue/white/purple
export function slotColor(slot, colorblind = false) {
    const arr = colorblind ? SLOT_COLORS_CB : SLOT_COLORS;
    return arr[((slot % 4) + 4) % 4] ?? '#ffffff';
}
export function splashColor(slot, colorblind) {
    if (slot < 0)
        return colorblind ? '#bcd7ff' : '#7fd4ff'; // tide / neutral
    return slotColor(slot, colorblind);
}
export const THEME_PALETTES = {
    backyard: {
        floorA: '#4c9a3a',
        floorB: '#438a34',
        boulder: '#7d5a3c',
        boulderShade: '#5c3f28',
        boulderLight: '#9a7150',
        castle: '#d9b36a',
        castleShade: '#a9813f',
        castleLight: '#f0d79a',
        water: '#2f7fd6',
        waterLight: '#5fb0f2',
        accent: '#86e05a',
    },
    beach: {
        floorA: '#e6cf8f',
        floorB: '#d8be79',
        boulder: '#8a8f9c',
        boulderShade: '#5f636e',
        boulderLight: '#b3b8c4',
        castle: '#c79a5b',
        castleShade: '#976f34',
        castleLight: '#ecc784',
        water: '#22afd0',
        waterLight: '#63d8ee',
        accent: '#ffe9a8',
    },
    pool: {
        floorA: '#39c3d6',
        floorB: '#2ea6bd',
        boulder: '#d7e6ef',
        boulderShade: '#9fb6c6',
        boulderLight: '#ffffff',
        castle: '#ff9ec4',
        castleShade: '#d76699',
        castleLight: '#ffc9e0',
        water: '#1f7fe0',
        waterLight: '#57b4ff',
        accent: '#c6f6ff',
    },
};
export const POWERUP_COLORS = {
    extraBalloon: { body: '#ff6f91', edge: '#ffd0dc' },
    bigSplash: { body: '#34d1ff', edge: '#c6f3ff' },
    flippers: { body: '#4ee66a', edge: '#cff7d5' },
    rubberBoots: { body: '#ffd23f', edge: '#fff0b8' },
};
export const EMOTE_TEXT = {
    1: 'quack!',
    2: 'ribbit!',
    3: 'squeak!',
    4: 'honk!',
};
//# sourceMappingURL=theme.js.map