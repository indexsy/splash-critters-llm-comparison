import type { Mode, RoomSummary, ThemePick } from '@splash/shared';
import { mount, qs } from '../app.js';
import { net } from '../net.js';

export function showBrowser(nav: { back: () => void; create: () => void }) {
  let mode: Mode | 'all' = 'all';
  const root = mount(`
    <div class="shell"><div class="panel">
      <div class="row" style="justify-content:space-between">
        <h2>Room browser</h2>
        <div class="row">
          <button class="btn-ghost" id="back">Back</button>
          <button class="btn" id="create">Create</button>
        </div>
      </div>
      <div class="row" style="margin:12px 0">
        <button class="btn small" data-m="all">All</button>
        <button class="btn small" data-m="duel">2-player</button>
        <button class="btn small" data-m="ffa">4-player</button>
        <button class="btn-ghost small" id="refresh">Refresh</button>
      </div>
      <div class="field"><label>Join by code</label><div class="row"><input id="code" maxlength="6" placeholder="ABC123" style="max-width:160px"/><button class="btn" id="join">Join</button></div></div>
      <table><thead><tr><th>Room</th><th>Mode</th><th>Players</th><th>Theme</th><th>Host</th></tr></thead><tbody id="rows"></tbody></table>
    </div></div>`);
  const paint = (rooms: RoomSummary[]) => {
    qs('#rows').innerHTML = rooms.map((r) => `<tr class="click" data-code="${r.code}"><td>${r.name}</td><td>${r.mode === 'duel' ? '2p' : '4p'}</td><td>${r.players}/${r.max}</td><td>${r.theme}</td><td>${r.host}</td></tr>`).join('')
      || '<tr><td colspan="5">No open rooms. Create one.</td></tr>';
    qs('#rows').querySelectorAll('tr.click').forEach((tr) => {
      tr.addEventListener('click', () => net.send({ t: 'join_room', code: (tr as HTMLElement).dataset.code ?? '' }));
    });
  };
  const refresh = () => net.send({ t: 'room_list_request', mode });
  refresh();
  const timer = setInterval(refresh, 2000);
  root.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
    mode = (b as HTMLElement).dataset.m as Mode | 'all';
    refresh();
  }));
  qs('#back').onclick = nav.back;
  qs('#create').onclick = nav.create;
  qs('#refresh').onclick = refresh;
  qs<HTMLButtonElement>('#join').onclick = () => {
    const code = qs<HTMLInputElement>('#code').value.trim();
    if (code) net.send({ t: 'join_room', code });
  };
  const off = net.on((msg) => { if (msg.t === 'room_list') paint(msg.rooms); });
  return () => { clearInterval(timer); off(); };
}

export function showCreate(nav: { back: () => void }) {
  const root = mount(`
    <div class="shell"><div class="panel" style="max-width:560px">
      <h2>Create room</h2>
      <div class="field"><label>Name</label><input id="name" maxlength="24" value="Backyard Splash"/></div>
      <div class="grid two">
        <div class="field"><label>Size</label><select id="mode"><option value="duel">2-player duel</option><option value="ffa">4-player free-for-all</option></select></div>
        <div class="field"><label>Theme</label><select id="theme"><option value="backyard">Backyard</option><option value="beach">Beach</option><option value="pool">Pool Party</option><option value="random">Random</option></select></div>
        <div class="field"><label>Rounds to win</label><select id="rounds"><option value="2">2</option><option value="3" selected>3</option><option value="5">5</option></select></div>
        <div class="field"><label>Listing</label><select id="pub"><option value="1">Public</option><option value="0">Private</option></select></div>
      </div>
      <label><input type="checkbox" id="bots" style="width:auto"/> Fill empty slots with bots</label>
      <div class="row" style="margin-top:14px">
        <button class="btn" id="go">Create</button>
        <button class="btn-ghost" id="back">Back</button>
      </div>
    </div></div>`);
  qs('#back').onclick = nav.back;
  qs('#go').onclick = () => {
    net.send({
      t: 'create_room',
      opts: {
        name: qs<HTMLInputElement>('#name').value,
        mode: qs<HTMLSelectElement>('#mode').value as Mode,
        theme: qs<HTMLSelectElement>('#theme').value as ThemePick,
        roundsToWin: Number(qs<HTMLSelectElement>('#rounds').value) as 2 | 3 | 5,
        public: qs<HTMLSelectElement>('#pub').value === '1',
        botFill: qs<HTMLInputElement>('#bots').checked,
      },
    });
  };
  return () => {};
}
