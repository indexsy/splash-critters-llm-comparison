import { pixelBg, text, W, H, panel } from './common.js';

export type SettingsState = {
  sfxVol: number;
  musicVol: number;
  muted: boolean;
  colorblind: boolean;
  reducedShake: boolean;
  keys: { up: string; down: string; left: string; right: string; balloon: string };
  rebinding: string | null;
};

export const defaultSettings = (): SettingsState => ({
  sfxVol: 0.35,
  musicVol: 0.12,
  muted: false,
  colorblind: false,
  reducedShake: false,
  keys: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', balloon: 'Space' },
  rebinding: null,
});

export function drawSettings(
  ctx: CanvasRenderingContext2D,
  tick: number,
  s: SettingsState,
  selected: number,
): void {
  pixelBg(ctx, tick);
  text(ctx, 'SETTINGS', W / 2, 16, '#4fc3f7', 10, 'center');
  panel(ctx, 24, 30, W - 48, 160);

  const lines = [
    `SFX Volume: ${Math.round(s.sfxVol * 100)}%`,
    `Music Volume: ${Math.round(s.musicVol * 100)}%`,
    `Muted: ${s.muted ? 'YES' : 'NO'} (M)`,
    `Colorblind splash: ${s.colorblind ? 'ON' : 'OFF'}`,
    `Reduced shake: ${s.reducedShake ? 'ON' : 'OFF'}`,
    `Rebind Up: ${s.keys.up}${s.rebinding === 'up' ? ' ...' : ''}`,
    `Rebind Down: ${s.keys.down}`,
    `Rebind Left: ${s.keys.left}`,
    `Rebind Right: ${s.keys.right}`,
    `Rebind Balloon: ${s.keys.balloon}`,
    'Back',
  ];

  lines.forEach((line, i) => {
    const y = 46 + i * 12;
    text(ctx, line, W / 2, y, i === selected ? '#fff59d' : '#ccc', 6, 'center');
  });

  text(ctx, 'Losing your device token loses this account.', W / 2, H - 14, '#e53935', 5, 'center');
  text(ctx, 'Token stored in localStorage only — no passwords.', W / 2, H - 6, '#666', 5, 'center');
}
