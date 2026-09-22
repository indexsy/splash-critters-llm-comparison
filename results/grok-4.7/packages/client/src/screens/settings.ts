import type { App } from '../app.js';

export function mountSettings(root: HTMLElement, app: App): () => void {
  const s = app.settings;
  root.innerHTML = `
    <div class="shell">
      <div class="topbar"><h1>Settings</h1><button id="back">Back</button></div>
      <div class="panel grid">
        <label>SFX <input id="sfx" type="range" min="0" max="100" value="${Math.round(s.sfx * 100)}" /></label>
        <label>Music <input id="music" type="range" min="0" max="100" value="${Math.round(s.music * 100)}" /></label>
        <label><input id="mute" type="checkbox" ${s.mute ? 'checked' : ''}/> Mute (M)</label>
        <label><input id="shake" type="checkbox" ${s.shake ? 'checked' : ''}/> Screen shake</label>
        <label><input id="cb" type="checkbox" ${s.colorblind ? 'checked' : ''}/> Colorblind-safe splash</label>
        <div class="row" id="keys"></div>
        <p class="muted">Your account is a device token in this browser. Clearing site data loses the account. There is no password.</p>
        <button class="warn" id="forget">Forget this device</button>
      </div>
    </div>`;
  const bind = (id: string, apply: (v: boolean | number) => void, check = false) => {
    const el = root.querySelector(id) as HTMLInputElement;
    el.onchange = () => {
      apply(check ? el.checked : Number(el.value) / 100);
      app.saveSettings();
    };
  };
  bind('#sfx', (v) => (s.sfx = Number(v)));
  bind('#music', (v) => (s.music = Number(v)));
  bind('#mute', (v) => (s.mute = Boolean(v)), true);
  bind('#shake', (v) => (s.shake = Boolean(v)), true);
  bind('#cb', (v) => (s.colorblind = Boolean(v)), true);
  const keys = root.querySelector('#keys') as HTMLElement;
  const fields: [string, string][] = [
    ['up', 'Up'],
    ['down', 'Down'],
    ['left', 'Left'],
    ['right', 'Right'],
    ['balloon', 'Balloon'],
    ['balloon2', 'Balloon 2'],
  ];
  keys.innerHTML = fields
    .map(([k, label]) => `<button data-k="${k}">${label}: ${s.keys[k as 'up']}</button>`)
    .join('');
  keys.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => {
    b.onclick = () => {
      b.textContent = 'Press a key…';
      const once = (e: KeyboardEvent) => {
        const key = b.dataset.k as 'up';
        s.keys[key] = e.code;
        app.saveSettings();
        b.textContent = `${fields.find((f) => f[0] === key)?.[1]}: ${e.code}`;
        window.removeEventListener('keydown', once);
      };
      window.addEventListener('keydown', once);
    };
  });
  root.querySelector('#forget')!.addEventListener('click', () => {
    localStorage.removeItem('splash.token');
    app.toast('Token cleared. Reload to start a new guest.');
  });
  root.querySelector('#back')!.addEventListener('click', () => app.goto('menu'));
  return () => {};
}
