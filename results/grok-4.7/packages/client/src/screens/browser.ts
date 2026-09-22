import type { App } from '../app.js';
import type { RoomSummary } from '@splash/shared';

export function mountBrowser(root: HTMLElement, app: App): () => void {
  let filter: 'any' | 'duel' | 'ffa' = 'any';
  root.innerHTML = `
    <div class="shell">
      <div class="topbar"><h1>Rooms</h1><button data-go="menu">Back</button></div>
      <div class="row"><button data-f="any">All</button><button data-f="duel">2-player</button><button data-f="ffa">4-player</button><button id="refresh">Refresh</button><button data-go="create">Create</button></div>
      <div id="list" class="grid" style="margin-top:12px"></div>
      <div class="panel" id="create" style="margin-top:12px;display:none"></div>
    </div>`;
  const list = root.querySelector('#list') as HTMLElement;
  const create = root.querySelector('#create') as HTMLElement;
  const paint = (rooms: RoomSummary[]) => {
    list.innerHTML = rooms.length
      ? rooms
          .map(
            (r) => `<div class="card"><strong>${escapeHtml(r.name)}</strong><div class="muted">${r.mode === 'duel' ? '2-player' : '4-player'} · ${r.players}/${r.max} · ${r.theme}</div><div class="muted">Host ${escapeHtml(r.host)}</div><button data-code="${r.code}">Join</button></div>`,
          )
          .join('')
      : `<div class="panel muted">No open rooms. Create one.</div>`;
    list.querySelectorAll<HTMLButtonElement>('[data-code]').forEach((b) => {
      b.onclick = () => app.net.send({ t: 'join_room', code: b.dataset.code! });
    });
  };
  const refresh = () => app.net.send({ t: 'room_list_request', mode: filter });
  const off = app.net.on((msg) => {
    if (msg.t === 'room_list') paint(msg.rooms);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => {
    b.onclick = () => {
      filter = b.dataset.f as typeof filter;
      refresh();
    };
  });
  root.querySelector('#refresh')!.addEventListener('click', refresh);
  root.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.go === 'create') {
        create.style.display = 'block';
        create.innerHTML = `
          <h2>Create room</h2>
          <div class="grid">
            <label>Name <input id="rname" maxlength="24" value="Puddle Party" /></label>
            <label>Size <select id="rmode"><option value="ffa">4-player</option><option value="duel">2-player</option></select></label>
            <label>Theme <select id="rtheme"><option value="random">Random</option><option value="backyard">Backyard</option><option value="beach">Beach</option><option value="pool">Pool Party</option></select></label>
            <label>Rounds <select id="rrounds"><option value="3">First to 3</option><option value="2">First to 2</option><option value="5">First to 5</option></select></label>
            <label><input id="rpublic" type="checkbox" checked /> Public</label>
            <label><input id="rfill" type="checkbox" checked /> Fill empty slots with bots</label>
            <button id="make">Create</button>
          </div>`;
        create.querySelector('#make')!.addEventListener('click', () => {
          app.net.send({
            t: 'create_room',
            opts: {
              name: (create.querySelector('#rname') as HTMLInputElement).value,
              mode: (create.querySelector('#rmode') as HTMLSelectElement).value as 'duel' | 'ffa',
              theme: (create.querySelector('#rtheme') as HTMLSelectElement).value as 'random',
              roundsToWin: Number((create.querySelector('#rrounds') as HTMLSelectElement).value) as 2 | 3 | 5,
              public: (create.querySelector('#rpublic') as HTMLInputElement).checked,
              botFill: (create.querySelector('#rfill') as HTMLInputElement).checked,
            },
          });
        });
      } else app.goto(b.dataset.go!);
    };
  });
  const timer = window.setInterval(refresh, 2000);
  refresh();
  return () => {
    off();
    window.clearInterval(timer);
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
