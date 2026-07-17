import { audio } from '../audio.js';
import { saveSettings, settings } from '../settings.js';
import { el, showApp } from './common.js';

export function renderSettings(root: HTMLElement, go: (screen: string) => void): void {
  showApp();
  const panel = el('div', { class: 'panel col', style: 'min-width:380px;' });
  panel.append(el('h2', {}, ['SETTINGS']));

  const mkSlider = (label: string, value: number, onChange: (v: number) => void): HTMLElement => {
    const input = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(value * 100)) }) as HTMLInputElement;
    input.oninput = () => onChange(parseInt(input.value, 10) / 100);
    return el('div', { class: 'row' }, [el('span', { style: 'width:130px;font-size:12px;' }, [label]), input]);
  };

  panel.append(
    mkSlider('SFX volume', settings.sfxVolume, (v) => {
      settings.sfxVolume = v;
      saveSettings(settings);
      audio.applyVolumes();
    }),
    mkSlider('Music volume', settings.musicVolume, (v) => {
      settings.musicVolume = v;
      saveSettings(settings);
      audio.applyVolumes();
    }),
  );

  const mkToggle = (label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement => {
    const b = el('button', { class: 'secondary', style: 'padding:4px 10px;font-size:11px;' }, [value ? 'ON' : 'OFF']);
    b.onclick = () => {
      const nv = b.textContent !== 'ON';
      b.textContent = nv ? 'ON' : 'OFF';
      onChange(nv);
    };
    return el('div', { class: 'row' }, [el('span', { style: 'width:130px;font-size:12px;' }, [label]), b]);
  };

  panel.append(
    mkToggle('Mute (M)', settings.muted, (v) => {
      settings.muted = v;
      saveSettings(settings);
      audio.applyVolumes();
    }),
    mkToggle('Colorblind palette', settings.colorblind, (v) => {
      settings.colorblind = v;
      saveSettings(settings);
    }),
    mkToggle('Reduced shake', settings.reducedShake, (v) => {
      settings.reducedShake = v;
      saveSettings(settings);
    }),
  );

  panel.append(el('div', { class: 'small dim', style: 'margin-top:6px;' }, ['KEYBINDS (click to remap)']));
  const keyLabels: Record<string, string> = { up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right', balloon: 'Drop balloon' };
  for (const action of ['up', 'down', 'left', 'right', 'balloon'] as const) {
    const b = el('button', { class: 'secondary', style: 'font-size:11px;padding:4px 10px;' }, [settings.keys[action]]);
    b.onclick = () => {
      b.textContent = 'press key...';
      const handler = (e: KeyboardEvent): void => {
        e.preventDefault();
        settings.keys[action] = e.key === ' ' ? 'Space' : e.key;
        saveSettings(settings);
        b.textContent = settings.keys[action];
        window.removeEventListener('keydown', handler, true);
      };
      window.addEventListener('keydown', handler, true);
    };
    panel.append(el('div', { class: 'row' }, [el('span', { style: 'width:130px;font-size:12px;' }, [keyLabels[action]!]), b]));
  }

  panel.append(
    el('div', { class: 'small warn', style: 'margin-top:10px;' }, [
      'Account is tied to this device token — no passwords. Losing browser data = losing your account forever.',
    ]),
  );

  const wipe = el('button', { class: 'danger', style: 'font-size:10px;padding:4px 8px;' }, ['RESET LOCAL TOKEN']);
  wipe.onclick = () => {
    if (confirm('Delete local token? Your account will be unrecoverable!')) {
      localStorage.removeItem('splash-token');
      location.reload();
    }
  };
  panel.append(wipe);

  const back = el('button', { class: 'secondary' }, ['BACK']);
  back.onclick = () => go('menu');
  panel.append(back);
  root.append(panel);
}
