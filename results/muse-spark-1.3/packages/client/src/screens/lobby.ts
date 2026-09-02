import { net } from '../net.js';
import { sfx } from '../audio.js';
import { app } from '../state.js';
import { session } from '../session.js';
import type { BotDifficulty, ServerMsg } from '@splash/shared';

export function renderLobby(root: HTMLElement, nav: (h: string) => void, code: string): () => void {
  root.innerHTML = '';
  const d = document.createElement('div');
  d.innerHTML = `
    <div class="card">
      <div class="row"><button id="back" class="secondary">← Leave</button><b id="rname">Room</b><span id="rcode" class="small"></span></div>
      <div class="small" id="share"></div>
      <div id="slots"></div>
      <div class="row" style="margin-top:8px">
        <button id="ready">Ready ✓</button>
        <button id="start">Start match</button>
        <button id="rematch" class="secondary">Rematch vote</button>
      </div>
      <div class="small">Host assigns empty slots to bots with difficulty. Casual disconnects become Medium bots after 15s. Post-match rematch needs majority.</div>
    </div>`;
  root.appendChild(d);
  (d.querySelector('#back') as HTMLButtonElement).onclick = () => {
    net.send({ kind: 'leave_room' });
    session.room = null;
    session.code = null;
    nav('#/menu');
  };
  let ready = false;
  (d.querySelector('#ready') as HTMLButtonElement).onclick = (e) => {
    ready = !ready;
    (e.target as HTMLButtonElement).textContent = ready ? 'Unready' : 'Ready ✓';
    net.send({ kind: 'set_ready', ready });
  };
  (d.querySelector('#start') as HTMLButtonElement).onclick = () => net.send({ kind: 'start_match' });
  (d.querySelector('#rematch') as HTMLButtonElement).onclick = () => net.send({ kind: 'rematch_vote', yes: true });

  const render = (): void => {
    const room = session.room;
    if (!room) return;
    (d.querySelector('#rname') as HTMLElement).textContent = room.name;
    (d.querySelector('#rcode') as HTMLElement).textContent = `code ${room.code} · ${room.maxPlayers === 2 ? '2p' : '4p'} · ${room.theme} · first to ${room.roundsToWin}`;
    (d.querySelector('#share') as HTMLElement).innerHTML =
      `Share: <a href="${location.origin}${location.pathname}#/room/${room.code}">${location.origin}${location.pathname}#/room/${room.code}</a>`;
    const box = d.querySelector('#slots') as HTMLElement;
    box.innerHTML = '';
    const isHost = room.hostId === app.profile?.playerId;
    room.slots.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'row';
      const label = s.kind === 'human' ? `🧍 ${s.nickname}${s.ready ? ' ✓' : ''}` : s.kind === 'bot' ? `🤖 ${s.nickname}` : '— empty —';
      row.innerHTML = `<b>Slot ${s.slot + 1}</b> <span>${label}</span> `;
      if (isHost && s.kind !== 'human') {
        const sel = document.createElement('select');
        sel.innerHTML = `<option value="empty">Empty</option><option value="easy">Easy bot</option><option value="medium">Medium bot</option><option value="hard">Hard bot</option>`;
        sel.value = s.kind === 'bot' ? s.difficulty ?? 'medium' : 'empty';
        sel.onchange = () => {
          sfx.click();
          if (sel.value === 'empty') net.send({ kind: 'set_slot', slot: s.slot, botKind: 'empty' });
          else net.send({ kind: 'set_slot', slot: s.slot, botKind: 'bot', difficulty: sel.value as BotDifficulty });
        };
        row.appendChild(sel);
      }
      box.appendChild(row);
    });
    // autobots for practice
    if (sessionStorage.getItem('sc_autobots') === '1' && isHost) {
      sessionStorage.removeItem('sc_autobots');
      room.slots.forEach((s) => {
        if (s.kind === 'empty') net.send({ kind: 'set_slot', slot: s.slot, botKind: 'bot', difficulty: 'medium' });
      });
      setTimeout(() => net.send({ kind: 'start_match' }), 800);
    }
  };

  const off = net.on((m: ServerMsg) => {
    if (m.kind === 'lobby_state') {
      session.room = m.room;
      session.code = m.room.code;
      render();
    } else if (m.kind === 'match_start') {
      nav('#/game');
    } else if (m.kind === 'error') {
      sfx.click();
    }
  });
  // request current state: rejoin to refresh (join is idempotent)
  if (code) net.send({ kind: 'join_room', code });
  render();
  return off;
}
