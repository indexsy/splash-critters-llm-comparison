import type { Screen } from './types.js';
import { loadSettings, saveSettings } from '../main.js';
import { PALETTE } from '../render/sprites.js';

let settings = loadSettings();
let rebinding: string | null = null;

const keyLabels: Record<string, string> = {
  up: 'Move Up',
  down: 'Move Down',
  left: 'Move Left',
  right: 'Move Right',
  balloon: 'Drop Balloon',
  emote1: 'Emote 1',
  emote2: 'Emote 2',
  emote3: 'Emote 3',
  emote4: 'Emote 4',
  mute: 'Mute Toggle',
  menu: 'Menu / Back',
};

export const settingsScreen: Screen = {
  enter(_data?: unknown) {
    settings = loadSettings();
  },
  update(_dt: number) {
    /* nothing */
  },
  render(ctx: CanvasRenderingContext2D) {
    const width = 256;
    ctx.fillStyle = PALETTE.darkBlue;
    ctx.fillRect(0, 0, width, 224);

    ctx.fillStyle = PALETTE.white;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Settings', width / 2, 12);

    let y = 28;
    const lineH = 16;

    // SFX Volume
    ctx.fillStyle = PALETTE.lightGray;
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('SFX Volume', 10, y + 8);
    ctx.fillStyle = PALETTE.darkGray;
    ctx.fillRect(100, y, 100, 10);
    ctx.fillStyle = PALETTE.blue;
    ctx.fillRect(100, y, 100 * settings.sfxVolume, 10);
    ctx.fillStyle = PALETTE.white;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(settings.sfxVolume * 100)}`, 210, y + 8);
    y += lineH;

    // Music Volume
    ctx.textAlign = 'left';
    ctx.fillStyle = PALETTE.lightGray;
    ctx.fillText('Music Volume', 10, y + 8);
    ctx.fillStyle = PALETTE.darkGray;
    ctx.fillRect(100, y, 100, 10);
    ctx.fillStyle = PALETTE.blue;
    ctx.fillRect(100, y, 100 * settings.musicVolume, 10);
    ctx.fillStyle = PALETTE.white;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(settings.musicVolume * 100)}`, 210, y + 8);
    y += lineH + 4;

    // Toggles
    ctx.textAlign = 'left';
    ctx.fillStyle = settings.colorblindMode ? PALETTE.green : PALETTE.darkGray;
    ctx.fillRect(10, y, 10, 10);
    ctx.fillStyle = PALETTE.lightGray;
    ctx.fillText('Colorblind-safe palette', 24, y + 8);
    y += lineH;

    ctx.fillStyle = settings.reducedShake ? PALETTE.green : PALETTE.darkGray;
    ctx.fillRect(10, y, 10, 10);
    ctx.fillStyle = PALETTE.lightGray;
    ctx.fillText('Reduced screen shake', 24, y + 8);
    y += lineH + 4;

    // Keybinds
    ctx.fillStyle = PALETTE.yellow;
    ctx.font = '8px monospace';
    ctx.fillText('Keybinds (click to rebind):', 10, y + 8);
    y += lineH;

    for (const [key, label] of Object.entries(keyLabels)) {
      const value = settings.keybinds[key as keyof typeof settings.keybinds];
      const isRebinding = rebinding === key;
      ctx.fillStyle = isRebinding ? PALETTE.red : PALETTE.darkGray;
      ctx.fillRect(10, y, 110, 12);
      ctx.fillStyle = PALETTE.white;
      ctx.font = '6px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, 14, y + 9);
      ctx.textAlign = 'right';
      ctx.fillText(isRebinding ? '...' : value, 116, y + 9);
      y += 14;
    }

    // Delete account note
    y = 180;
    ctx.fillStyle = PALETTE.red;
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Warning: Losing your token means losing your account.', width / 2, y);
    ctx.fillText('Token stored in localStorage.', width / 2, y + 8);

    // Back button
    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(4, 206, 40, 14);
    ctx.fillStyle = PALETTE.white;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Back', 24, 216);
  },
  exit() {
    saveSettings(settings);
    rebinding = null;
  },
};
