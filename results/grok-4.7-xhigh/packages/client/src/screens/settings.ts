import { app, loadSettings, mount, qs, saveSettings, toast } from '../app.js';
import { net } from '../net.js';

export function showSettings(nav: { back: () => void }) {
  const s = app.settings;
  const root = mount(`
    <div class="shell"><div class="panel" style="max-width:640px">
      <div class="row" style="justify-content:space-between"><h2>Settings</h2><button class="btn-ghost" id="back">Back</button></div>
      <div class="field"><label>Nickname ${app.profile?.nickSet ? '(set)' : '(required for ranked)'}</label>
        <div class="row"><input id="nick" maxlength="16" value="${app.profile?.nickname ?? ''}"/><button class="btn" id="saveNick">Save</button></div>
      </div>
      <div class="field"><label>SFX volume</label><input id="sfx" type="range" min="0" max="1" step="0.05" value="${s.sfx}"/></div>
      <div class="field"><label>Music volume</label><input id="music" type="range" min="0" max="1" step="0.05" value="${s.music}"/></div>
      <label><input id="mute" type="checkbox" style="width:auto" ${s.mute ? 'checked' : ''}/> Mute (M)</label>
      <label><input id="cb" type="checkbox" style="width:auto" ${s.colorblind ? 'checked' : ''}/> Colorblind-safe splash palette</label>
      <label><input id="shake" type="checkbox" style="width:auto" ${s.shake ? 'checked' : ''}/> Screen shake</label>
      <div class="field" style="margin-top:12px"><label>Artificial latency ms (dev, or ?lag=150)</label><input id="lag" type="number" min="0" max="500" value="${s.lag}"/></div>
      <h3>Keybinds</h3>
      <div class="grid two" id="binds"></div>
      <div class="card" style="margin-top:16px">
        <h3>This browser is the account</h3>
        <p class="sub">Your guest token lives in localStorage. Clearing site data or losing this browser loses the account. There are no passwords in v1.</p>
        <button class="btn-coral" id="del">Delete account</button>
      </div>
    </div></div>`);
  const bindIds = ['up', 'down', 'left', 'right', 'balloon', 'mute'] as const;
  qs('#binds').innerHTML = bindIds.map((k) => `<div class="field"><label>${k}</label><button class="btn-ghost small" data-bind="${k}">${s.binds[k].join(' / ')}</button></div>`).join('');
  let capturing: typeof bindIds[number] | null = null;
  qs('#binds').querySelectorAll('[data-bind]').forEach((b) => b.addEventListener('click', () => {
    capturing = (b as HTMLElement).dataset.bind as typeof bindIds[number];
    (b as HTMLElement).textContent = 'press a key…';
  }));
  const onKey = (e: KeyboardEvent) => {
    if (!capturing) return;
    e.preventDefault();
    app.settings.binds[capturing] = [e.code];
    saveSettings(app.settings);
    capturing = null;
    showSettings(nav);
  };
  window.addEventListener('keydown', onKey);
  const save = () => {
    app.settings.sfx = Number(qs<HTMLInputElement>('#sfx').value);
    app.settings.music = Number(qs<HTMLInputElement>('#music').value);
    app.settings.mute = qs<HTMLInputElement>('#mute').checked;
    app.settings.colorblind = qs<HTMLInputElement>('#cb').checked;
    app.settings.shake = qs<HTMLInputElement>('#shake').checked;
    app.settings.lag = Number(qs<HTMLInputElement>('#lag').value) || 0;
    saveSettings(app.settings);
  };
  root.querySelectorAll('input').forEach((el) => el.addEventListener('change', save));
  qs('#saveNick').onclick = () => net.send({ t: 'set_nickname', nickname: qs<HTMLInputElement>('#nick').value });
  qs('#del').onclick = () => {
    if (!confirm('Delete this critter account on this browser?')) return;
    net.send({ t: 'delete_account' });
    localStorage.removeItem('splash_token');
    toast('Account deleted');
    setTimeout(() => location.reload(), 300);
  };
  qs('#back').onclick = () => { save(); nav.back(); };
  const off = net.on(() => {});
  return () => { window.removeEventListener('keydown', onKey); off(); };
}

export function currentSettings() {
  return loadSettings();
}
