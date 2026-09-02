import { net } from '../net.js';
import { sfx } from '../audio.js';
import type { ServerMsg, MapTheme } from '@splash/shared';

export function renderBrowser(root: HTMLElement, nav: (h: string) => void): () => void {
  root.innerHTML = '';
  const d = document.createElement('div');
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  d.innerHTML = `
    <div class="card">
      <div class="row"><button id="back" class="secondary">← Menu</button><b>Casual Rooms</b>
      <select id="filter"><option value="all">All</option><option value="2p">2-player</option><option value="4p">4-player</option></select>
      <button id="refresh" class="secondary">Refresh</button></div>
      <div id="list" style="margin-top:8px"></div>
      <div class="row" style="margin-top:8px">
        <input id="code" placeholder="Room code" maxlength="6" style="width:110px"/>
        <button id="joinCode" class="secondary">Join by code</button>
      </div>
    </div>
    <div class="card">
      <b>Create room</b>
      <div class="row">
        <input id="rname" placeholder="Room name" maxlength="32" value="Splash Room"/>
        <select id="rsize"><option value="2">2-player</option><option value="4" selected>4-player</option></select>
        <select id="rtheme"><option value="backyard">Backyard</option><option value="beach">Beach</option><option value="pool">Pool Party</option><option value="random" selected>Random</option></select>
        <select id="rrounds"><option value="2">2 wins</option><option value="3" selected>3 wins</option><option value="5">5 wins</option></select>
      </div>
      <div class="row">
        <label><input type="checkbox" id="rpub" checked/> Public</label>
        <button id="createBtn">Create</button>
        <button id="practiceBtn" class="secondary">Practice vs 3 bots</button>
      </div>
      <div class="small">Shareable link format: <span id="linkEx"></span></div>
    </div>`;
  root.appendChild(d);
  (d.querySelector('#linkEx') as HTMLElement).textContent = `${location.origin}${location.pathname}#/room/ABC123`;
  const list = d.querySelector('#list') as HTMLElement;

  const refresh = (): void => {
    const f = (d.querySelector('#filter') as HTMLSelectElement).value as 'all' | '2p' | '4p';
    net.send({ kind: 'room_list_request', mode: f });
  };
  (d.querySelector('#refresh') as HTMLButtonElement).onclick = () => { sfx.click(); refresh(); };
  (d.querySelector('#filter') as HTMLSelectElement).onchange = refresh;
  (d.querySelector('#back') as HTMLButtonElement).onclick = () => nav('#/menu');
  (d.querySelector('#joinCode') as HTMLButtonElement).onclick = () => {
    const c = (d.querySelector('#code') as HTMLInputElement).value.trim().toUpperCase();
    if (c) net.send({ kind: 'join_room', code: c });
  };
  (d.querySelector('#createBtn') as HTMLButtonElement).onclick = () => {
    net.send({
      kind: 'create_room',
      name: (d.querySelector('#rname') as HTMLInputElement).value || 'Splash Room',
      maxPlayers: (d.querySelector('#rsize') as HTMLSelectElement).value === '2' ? 2 : 4,
      isPublic: (d.querySelector('#rpub') as HTMLInputElement).checked,
      theme: (d.querySelector('#rtheme') as HTMLSelectElement).value as MapTheme,
      roundsToWin: Number((d.querySelector('#rrounds') as HTMLSelectElement).value) as 2 | 3 | 5,
      botFill: false,
    });
  };
  (d.querySelector('#practiceBtn') as HTMLButtonElement).onclick = () => {
    // create solo room; lobby screen will offer bot fill
    net.send({ kind: 'create_room', name: 'Practice', maxPlayers: 4, isPublic: false, theme: 'random', roundsToWin: 3, botFill: true });
    sessionStorage.setItem('sc_autobots', '1');
  };

  const off = net.on((m: ServerMsg) => {
    if (m.kind === 'room_list') {
      list.innerHTML = '';
      if (m.rooms.length === 0) list.innerHTML = '<div class="small">No open rooms — create one!</div>';
      for (const r of m.rooms) {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `<b>${escapeHtml(r.name)}</b> <span class="small">${r.mode} · ${r.players}/${r.maxPlayers} · ${escapeHtml(r.theme)} · host ${escapeHtml(r.host)}</span> `;
        const b = document.createElement('button');
        b.textContent = `Join ${r.code}`;
        b.onclick = () => net.send({ kind: 'join_room', code: r.code });
        row.appendChild(b);
        list.appendChild(row);
      }
    } else if (m.kind === 'room_created') {
      nav(`#/room/${m.code}`);
    } else if (m.kind === 'lobby_state') {
      nav(`#/room/${m.room.code}`);
    } else if (m.kind === 'error') {
      list.innerHTML = `<div class="small">⚠ ${escapeHtml(m.msg)}</div>` + list.innerHTML;
    }
  });
  refresh();
  if (q.get('create') === '1') {
    // focus create
  }
  if (q.get('practice') === '1') {
    (d.querySelector('#practiceBtn') as HTMLButtonElement).click();
  }
  return off;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
