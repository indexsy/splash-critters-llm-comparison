import { app, saveSettings } from '../state.js';
import { sfx, toggleMute } from '../audio.js';

export function renderSettings(root: HTMLElement, nav: (h: string) => void): () => void {
  root.innerHTML = '';
  const d = document.createElement('div');
  const s = app.settings;
  d.innerHTML = `
    <div class="card">
      <div class="row"><button id="back" class="secondary">← Menu</button><b>Settings</b></div>
      <div class="row"><label>SFX <input id="sfx" type="range" min="0" max="100" value="${Math.round(s.sfx * 100)}"/></label>
      <label>Music <input id="mus" type="range" min="0" max="100" value="${Math.round(s.music * 100)}"/></label></div>
      <div class="row">
        <label><input type="checkbox" id="mute" ${s.muted ? 'checked' : ''}/> Mute (M)</label>
        <label><input type="checkbox" id="cb" ${s.colorblind ? 'checked' : ''}/> Colorblind-safe splash palette</label>
        <label><input type="checkbox" id="shake" ${s.shake ? 'checked' : ''}/> Screen shake</label>
      </div>
      <div class="row"><label>Up <input id="kUp" value="${s.keys.up}" size="8"/></label>
      <label>Down <input id="kDown" value="${s.keys.down}" size="8"/></label>
      <label>Left <input id="kLeft" value="${s.keys.left}" size="8"/></label>
      <label>Right <input id="kRight" value="${s.keys.right}" size="8"/></label>
      <label>Balloon <input id="kB" value="${s.keys.balloon}" size="8"/></label></div>
      <div class="small">Click a keybind field, then press a key. Key codes shown (e.g. KeyW, Space).</div>
      <div class="card small">⚠ Account: guest token stored in this browser (localStorage <b>sc_token</b>). Losing the token = losing the account. There is no password recovery in v1. Copy your token:<br/><code id="tok"></code></div>
      <div class="row"><button id="save">Save</button><button id="muteBtn" class="secondary">Toggle mute</button></div>
    </div>`;
  root.appendChild(d);
  (d.querySelector('#tok') as HTMLElement).textContent = localStorage.getItem('sc_token') ?? '(none yet)';
  (d.querySelector('#back') as HTMLButtonElement).onclick = () => nav('#/menu');
  const bindCapture = (id: string): void => {
    const inp = d.querySelector(id) as HTMLInputElement;
    inp.addEventListener('keydown', (e) => {
      e.preventDefault();
      inp.value = e.code;
    });
  };
  bindCapture('#kUp');
  bindCapture('#kDown');
  bindCapture('#kLeft');
  bindCapture('#kRight');
  bindCapture('#kB');
  (d.querySelector('#save') as HTMLButtonElement).onclick = () => {
    s.muted = (d.querySelector('#mute') as HTMLInputElement).checked;
    s.colorblind = (d.querySelector('#cb') as HTMLInputElement).checked;
    s.shake = (d.querySelector('#shake') as HTMLInputElement).checked;
    s.sfx = Number((d.querySelector('#sfx') as HTMLInputElement).value) / 100;
    s.music = Number((d.querySelector('#mus') as HTMLInputElement).value) / 100;
    s.keys = {
      up: (d.querySelector('#kUp') as HTMLInputElement).value || 'KeyW',
      down: (d.querySelector('#kDown') as HTMLInputElement).value || 'KeyS',
      left: (d.querySelector('#kLeft') as HTMLInputElement).value || 'KeyA',
      right: (d.querySelector('#kRight') as HTMLInputElement).value || 'KeyD',
      balloon: (d.querySelector('#kB') as HTMLInputElement).value || 'Space',
    };
    saveSettings(s);
    sfx.click();
    nav('#/menu');
  };
  (d.querySelector('#muteBtn') as HTMLButtonElement).onclick = () => {
    toggleMute();
    saveSettings(s);
  };
  return () => {};
}
