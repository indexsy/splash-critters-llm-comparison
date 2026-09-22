import type { App } from '../app.js';

export function mountMenu(root: HTMLElement, app: App): () => void {
  const name = app.profile ? `${app.profile.nickname}#${app.profile.tag}` : 'Guest';
  root.innerHTML = `
    <div class="shell">
      <div class="topbar"><h1>Splash Critters</h1><div class="nameplate">${name} · Lv ${app.profile?.level ?? 1}</div></div>
      <div class="grid cards">
        <div class="card"><strong>Ranked</strong><p class="muted">Humans only. Separate Elo for duel and free-for-all.</p>
          <div class="row"><button data-q="duel">Duel</button><button data-q="ffa">Free-for-All</button></div></div>
        <div class="card"><strong>Casual</strong><p class="muted">Public rooms, private codes, bots welcome.</p>
          <div class="row"><button data-go="browser">Browse</button><button data-go="create">Create</button></div>
          <div class="row" style="margin-top:8px"><input id="code" maxlength="6" placeholder="CODE" /><button id="join">Join</button></div></div>
        <div class="card"><strong>Practice</strong><p class="muted">Solo room with bots. Still online, still soggy.</p><button id="practice">Vs Bots</button></div>
        <div class="card"><strong>More</strong>
          <div class="row"><button data-go="leaderboard">Leaderboard</button><button data-go="locker">Locker</button><button data-go="howto">How to Play</button><button data-go="settings">Settings</button><button data-go="tutorial">Tutorial</button></div></div>
      </div>
    </div>`;
  const go = (name: string) => {
    app.audio.play('ui');
    app.goto(name);
  };
  root.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go!));
  root.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) => {
    b.onclick = () => {
      if (!app.profile?.nicknameSet) {
        nickModal(app, () => app.net.send({ t: 'queue_join', mode: b.dataset.q as 'duel' | 'ffa' }));
        return;
      }
      app.net.send({ t: 'queue_join', mode: b.dataset.q as 'duel' | 'ffa' });
      app.goto('queue');
    };
  });
  root.querySelector('#join')!.addEventListener('click', () => {
    const code = (root.querySelector('#code') as HTMLInputElement).value.trim().toUpperCase();
    if (code.length < 4) return;
    app.net.send({ t: 'join_room', code });
  });
  root.querySelector('#practice')!.addEventListener('click', () => app.net.send({ t: 'practice_start' }));
  return () => {};
}

export function nickModal(app: App, after: () => void): void {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<div class="panel"><h2>Pick a nickname</h2><p class="muted">3–16 letters, numbers, underscores. Ranked requires one. Your #tag is assigned for you.</p><div class="row"><input id="nick" maxlength="16" placeholder="SoggyOtter" /><button id="save">Save</button></div></div>`;
  document.body.appendChild(modal);
  const input = modal.querySelector('#nick') as HTMLInputElement;
  modal.querySelector('#save')!.addEventListener('click', () => {
    const nickname = input.value.trim();
    app.net.send({ t: 'set_nickname', nickname });
    const off = app.net.on((msg) => {
      if (msg.t === 'profile' && msg.profile.nicknameSet) {
        off();
        modal.remove();
        after();
        app.goto('queue');
      }
      if (msg.t === 'error') app.toast(msg.msg);
    });
  });
}
