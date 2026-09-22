import type { Difficulty } from '@splash/shared';
import { app, mount, qs } from '../app.js';
import { net } from '../net.js';

export function showLobby(nav: { back: () => void }) {
  const root = mount(`
    <div class="shell"><div class="panel">
      <div class="row" style="justify-content:space-between">
        <div><h2 id="title">Lobby</h2><p class="sub" id="meta"></p></div>
        <button class="btn-ghost" id="leave">Leave</button>
      </div>
      <div id="slots" class="grid"></div>
      <div class="row" style="margin-top:14px">
        <button class="btn" id="ready">Ready</button>
        <button class="btn-leaf" id="start">Start match</button>
        <button class="btn-ghost" id="copy">Copy link</button>
      </div>
    </div></div>`);
  let ready = false;
  const paint = () => {
    const room = app.lobby;
    if (!room) return;
    qs('#title').textContent = room.name;
    qs('#meta').textContent = `${room.code} · ${room.mode === 'duel' ? '2-player' : '4-player'} · ${room.theme} · first to ${room.roundsToWin} · ${room.public ? 'public' : 'private'}`;
    const me = app.profile?.id;
    const host = room.hostId === me;
    qs<HTMLButtonElement>('#start').style.display = host ? 'inline-block' : 'none';
    qs('#slots').innerHTML = room.slots.map((s) => {
      const botBtns = host && s.kind !== 'human'
        ? `<div class="row">${(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => `<button class="btn small" data-slot="${s.index}" data-diff="${d}">${d}</button>`).join('')}<button class="btn-ghost small" data-open="${s.index}">open</button></div>`
        : '';
      return `<div class="card"><strong>Slot ${s.index + 1}</strong> ${s.playerId === room.hostId ? '· host' : ''}<div class="sub">${s.kind === 'open' ? 'Empty' : `${s.name ?? 'Critter'} ${s.kind === 'bot' ? `(${s.difficulty} bot)` : s.ready ? '· ready' : ''}`}</div>${botBtns}</div>`;
    }).join('');
    qs('#slots').querySelectorAll('[data-diff]').forEach((b) => {
      b.addEventListener('click', () => {
        const el = b as HTMLElement;
        net.send({ t: 'set_slot', slot: Number(el.dataset.slot), kind: 'bot', difficulty: el.dataset.diff as Difficulty });
      });
    });
    qs('#slots').querySelectorAll('[data-open]').forEach((b) => {
      b.addEventListener('click', () => net.send({ t: 'set_slot', slot: Number((b as HTMLElement).dataset.open), kind: 'open' }));
    });
  };
  paint();
  qs('#leave').onclick = () => { net.send({ t: 'leave_room' }); nav.back(); };
  qs('#ready').onclick = () => { ready = !ready; net.send({ t: 'set_ready', ready }); };
  qs('#start').onclick = () => net.send({ t: 'start_match' });
  qs('#copy').onclick = () => {
    const link = `${location.origin}/#/room/${app.lobby?.code ?? ''}`;
    void navigator.clipboard?.writeText(link);
  };
  const off = net.on((msg) => { if (msg.t === 'lobby_state' || msg.t === 'room_created') paint(); });
  return () => off();
}
