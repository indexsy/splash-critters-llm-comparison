import type { App } from '../app.js';
import { button, clear, el, panel } from '../ui.js';

/** Volume, accessibility and keybind settings. */
export class SettingsScreen {
  private app: App | null = null;

  show(app: App): void {
    this.app = app;
    clear(app.overlay);
    const settings = app.state.settings;

    const sfx = el('input', { type: 'range', min: '0', max: '1', step: '0.05' });
    sfx.value = String(settings.sfxVolume);
    sfx.addEventListener('input', () => {
      app.updateSettings({ sfxVolume: Number(sfx.value) });
    });

    const music = el('input', { type: 'range', min: '0', max: '1', step: '0.05' });
    music.value = String(settings.musicVolume);
    music.addEventListener('input', () => {
      app.updateSettings({ musicVolume: Number(music.value) });
    });

    const muted = el('input', { type: 'checkbox' });
    muted.checked = settings.muted;
    muted.addEventListener('change', () => app.updateSettings({ muted: muted.checked }));

    const shake = el('input', { type: 'checkbox' });
    shake.checked = settings.reducedShake;
    shake.addEventListener('change', () => app.updateSettings({ reducedShake: shake.checked }));

    const colorblind = el('input', { type: 'checkbox' });
    colorblind.checked = settings.colorblindPalette;
    colorblind.addEventListener('change', () =>
      app.updateSettings({ colorblindPalette: colorblind.checked }),
    );

    const latency = el('input', { type: 'range', min: '0', max: '300', step: '10' });
    latency.value = String(settings.latency);
    latency.addEventListener('change', () => {
      const value = Number(latency.value);
      app.updateSettings({ latency: value });
      app.toast(`artificial latency ${value}ms - reload to apply`);
    });

    const bindRows: HTMLElement[] = [];
    let listeningFor: string | null = null;
    const bindLabels: Record<string, string> = {
      up: 'Move up',
      down: 'Move down',
      left: 'Move left',
      right: 'Move right',
      drop: 'Drop balloon',
      dropAlt: 'Drop balloon (alt)',
      emote1: 'Emote 1',
      emote2: 'Emote 2',
      emote3: 'Emote 3',
      emote4: 'Emote 4',
    };
    for (const key of Object.keys(bindLabels)) {
      const value = el('span', { class: 'kbd' }, [
        settings.keybinds[key as keyof typeof settings.keybinds],
      ]);
      const row = el('div', { class: 'spread' }, [
        el('span', { class: 'hint' }, [bindLabels[key]]),
        value,
      ]);
      row.addEventListener('click', () => {
        listeningFor = key;
        value.textContent = 'PRESS A KEY';
        value.style.color = '#f4a261';
      });
      bindRows.push(row);
    }
    const rebind = el('p', { class: 'hint' }, ['Click a binding and press the new key.']);
    const keyHandler = (event: KeyboardEvent): void => {
      if (!listeningFor) return;
      event.preventDefault();
      if (event.code !== 'Escape') {
        const next = { ...app.state.settings.keybinds };
        next[listeningFor as keyof typeof next] = event.code;
        app.updateSettings({ keybinds: next });
        app.toast(`${bindLabels[listeningFor]} -> ${event.code}`);
      }
      listeningFor = null;
      window.removeEventListener('keydown', keyHandler, true);
    };
    window.addEventListener('keydown', keyHandler, true);

    const root = panel(
      'Settings',
      el('h2', {}, ['Audio']),
      el('div', { class: 'col' }, [
        el('label', {}, ['Sound effects']),
        sfx,
        el('label', {}, ['Music']),
        music,
        el('label', {}, [muted, ' Mute everything (M)']),
      ]),
      el('h2', {}, ['Accessibility']),
      el('div', { class: 'col' }, [
        el('label', {}, [colorblind, ' Colour blind safe splash colours']),
        el('label', {}, [shake, ' Reduced screen shake']),
      ]),
      el('h2', {}, ['Controls']),
      el('div', { class: 'col' }, bindRows),
      rebind,
      el('h2', {}, ['Developer']),
      el('div', { class: 'col' }, [
        el('label', {}, ['Artificial latency (ms) - reload to apply']),
        latency,
      ]),
      el('h2', {}, ['Account']),
      el('p', { class: 'hint' }, [
        'This game has no passwords. Your account lives in this browser only - if you clear the browser data or lose the device token, the account and its ratings are gone forever.',
      ]),
      el('div', { class: 'row' }, [button('Back', () => app.go('menu'))]),
    );
    app.overlay.appendChild(root);
  }

  hide(): void {
    if (this.app) clear(this.app.overlay);
  }

  update(): void {
    /* static */
  }
}
