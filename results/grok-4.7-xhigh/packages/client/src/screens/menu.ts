import { audio } from '../audio.js';
import { app, mount, tierClass } from '../app.js';
import { net } from '../net.js';

export function showMenu(nav: {
  ranked: (mode: 'duel' | 'ffa') => void;
  browser: () => void;
  create: () => void;
  practice: () => void;
  leaderboard: () => void;
  locker: () => void;
  howto: () => void;
  settings: () => void;
  tutorial: () => void;
}) {
  audio.setMusic('menu');
  const p = app.profile;
  const duel = p?.ratings.duel;
  const ffa = p?.ratings.ffa;
  const root = mount(`
    <div class="shell">
      <div class="panel">
        <div class="row" style="justify-content:space-between">
          <div>
            <h1>SPLASH CRITTERS</h1>
            <p class="who">${p ? `${p.nickname}#${p.tag}` : ''} · Lv ${p?.level ?? 1}</p>
          </div>
          <button class="btn-ghost" id="settings">Settings</button>
        </div>
        <div class="menu-grid" style="margin-top:16px">
          <div class="grid">
            <div class="card">
              <h3>Ranked</h3>
              <p class="sub">Humans only. Separate puddles of Elo.</p>
              <div class="row">
                <button class="btn" id="duel">Duel 1v1 <span class="badge ${tierClass(duel?.tier ?? 'Puddle')}">${duel?.tier ?? 'Puddle'} ${Math.round(duel?.rating ?? 1000)}</span></button>
                <button class="btn" id="ffa">Free-for-All <span class="badge ${tierClass(ffa?.tier ?? 'Puddle')}">${ffa?.tier ?? 'Puddle'} ${Math.round(ffa?.rating ?? 1000)}</span></button>
              </div>
            </div>
            <div class="card">
              <h3>Casual</h3>
              <div class="row">
                <button class="btn" id="browse">Browse Rooms</button>
                <button class="btn" id="create">Create Room</button>
                <button class="btn-leaf" id="practice">Practice vs Bots</button>
              </div>
            </div>
            <div class="row">
              <button class="btn-ghost" id="board">Leaderboard</button>
              <button class="btn-ghost" id="locker">Locker</button>
              <button class="btn-ghost" id="how">How to Play</button>
              <button class="btn-ghost" id="tut">Tutorial</button>
            </div>
          </div>
          <div class="card">
            <h3>Recent splashes</h3>
            ${(p?.recent.length ? p.recent : []).slice(0, 5).map((m) => `<div class="sub">${m.ranked ? 'Ranked' : 'Casual'} ${m.mode} · #${m.placement} · +${m.xp} xp</div>`).join('') || '<p class="sub">No matches yet. The tide is patient.</p>'}
            ${p && !p.nickSet ? '<p class="sub">Set a nickname before ranked. Guests can still splash casually.</p><button class="btn small" id="nick">Set nickname</button>' : ''}
          </div>
        </div>
      </div>
    </div>`);
  const click = (id: string, fn: () => void) => root.querySelector(id)?.addEventListener('click', fn);
  click('#duel', () => nav.ranked('duel'));
  click('#ffa', () => nav.ranked('ffa'));
  click('#browse', nav.browser);
  click('#create', nav.create);
  click('#practice', nav.practice);
  click('#board', nav.leaderboard);
  click('#locker', nav.locker);
  click('#how', nav.howto);
  click('#tut', nav.tutorial);
  click('#settings', nav.settings);
  click('#nick', nav.settings);
  let raf = 0;
  const loop = () => { audio.tick(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  const off = net.on((msg) => {
    if (msg.t === 'profile') showMenu(nav);
  });
  return () => { cancelAnimationFrame(raf); off(); };
}
