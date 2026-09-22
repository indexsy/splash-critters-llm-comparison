import type { App } from '../app.js';

export function mountLobby(root: HTMLElement, app: App): () => void {
  const paint = () => {
    const room = app.session.lobby?.room;
    if (!room) {
      root.innerHTML = `<div class="shell"><div class="panel">Joining room…</div></div>`;
      return;
    }
    const me = app.profile?.id;
    const host = room.hostId === me;
    root.innerHTML = `
      <div class="shell">
        <div class="topbar"><h1>${escapeHtml(room.name)}</h1><button id="leave">Leave</button></div>
        <p class="muted">${room.mode === 'duel' ? '2-player' : '4-player'} · ${room.public ? 'Public' : 'Private'} · ${room.theme} · first to ${room.roundsToWin}</p>
        <p>Code <strong>${room.code}</strong> · link <code>${location.origin}/#/room/${room.code}</code></p>
        <div class="grid cards">${room.slots
          .map((s) => {
            const label = s.kind === 'open' ? 'Open' : s.kind === 'bot' ? `Bot · ${s.difficulty}` : `${s.name ?? 'Player'}#${s.tag ?? ''}`;
            const controls =
              host && s.kind !== 'human'
                ? `<select data-slot="${s.index}"><option value="open" ${s.kind === 'open' ? 'selected' : ''}>Open</option><option value="easy" ${s.difficulty === 'easy' && s.kind === 'bot' ? 'selected' : ''}>Easy bot</option><option value="medium" ${s.difficulty === 'medium' && s.kind === 'bot' ? 'selected' : ''}>Medium bot</option><option value="hard" ${s.difficulty === 'hard' && s.kind === 'bot' ? 'selected' : ''}>Hard bot</option></select>`
                : '';
            return `<div class="card"><strong>Slot ${s.index + 1}${s.host ? ' · host' : ''}</strong><div>${escapeHtml(label)}</div><div class="muted">${s.kind === 'human' ? (s.ready ? 'Ready' : 'Not ready') : ''} ${s.ping ? s.ping + 'ms' : ''}</div>${controls}</div>`;
          })
          .join('')}</div>
        <div class="row" style="margin-top:12px">
          <button id="ready">Ready</button>
          ${host ? '<button id="start">Start</button>' : ''}
        </div>
      </div>`;
    root.querySelector('#leave')!.addEventListener('click', () => {
      app.net.send({ t: 'leave_room' });
      app.goto('menu');
    });
    root.querySelector('#ready')!.addEventListener('click', () => app.net.send({ t: 'set_ready', ready: true }));
    root.querySelector('#start')?.addEventListener('click', () => app.net.send({ t: 'start_match' }));
    root.querySelectorAll<HTMLSelectElement>('select[data-slot]').forEach((sel) => {
      sel.onchange = () => {
        const slot = Number(sel.dataset.slot);
        if (sel.value === 'open') app.net.send({ t: 'set_slot', slot, kind: 'open' });
        else app.net.send({ t: 'set_slot', slot, kind: 'bot', difficulty: sel.value as 'easy' | 'medium' | 'hard' });
      };
    });
  };
  const off = app.net.on((msg) => {
    if (msg.t === 'lobby_state') paint();
  });
  paint();
  return () => off();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
