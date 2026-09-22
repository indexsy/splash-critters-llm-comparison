import { tierFor, xpProgress } from '@splash/shared';
import { app, mount, qs, tierClass } from '../app.js';
import { audio } from '../audio.js';
import { net } from '../net.js';

export function showResults(nav: { menu: () => void }) {
  audio.setMusic('title');
  audio.fanfare();
  const msg = app.result;
  if (!msg) {
    nav.menu();
    return () => {};
  }
  const me = msg.placements.find((p) => p.playerId === app.profile?.id);
  const funName = (id: string) => msg.placements.find((p) => p.playerId === id)?.name ?? '—';
  const root = mount(`
    <div class="shell"><div class="panel">
      <h1>${me ? (me.placement === 1 ? 'YOU STAYED DRY' : `PLACE ${me.placement}`) : 'MATCH OVER'}</h1>
      <p class="sub">${msg.ranked ? 'Ranked' : 'Casual'} ${msg.mode === 'duel' ? 'duel' : 'free-for-all'}</p>
      <table><thead><tr><th>#</th><th>Critter</th><th>Rounds</th><th>Soaks</th><th>Castles</th><th>XP</th><th>Rating</th></tr></thead>
      <tbody>${msg.placements.map((p) => `<tr><td>${p.placement}</td><td>${p.name}${p.isBot ? ' (bot)' : ''}</td><td>${p.roundsWon}</td><td>${p.soaks}</td><td>${p.castles}</td><td>${p.isBot ? '—' : '+' + p.xp}</td><td>${p.ratingAfter != null ? `${Math.round(p.ratingBefore ?? 0)} → ${Math.round(p.ratingAfter)}` : '—'}</td></tr>`).join('')}</tbody></table>
      <div class="grid two" style="margin-top:14px">
        <div class="card"><h3>Fun stats</h3>
          <p class="sub">Most Soaks: ${funName(msg.fun.mostSoaks)}</p>
          <p class="sub">Castle Crusher: ${funName(msg.fun.castleCrusher)}</p>
          <p class="sub">Longest Survivor: ${funName(msg.fun.longestSurvivor)}</p>
          <p class="sub">Biggest Chain: ${funName(msg.fun.biggestChain)}</p>
        </div>
        <div class="card"><h3>Progress</h3>
          <div id="xp"></div>
          <div id="rank"></div>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        ${msg.rematch ? '<button class="btn" id="yes">Rematch</button><button class="btn-ghost" id="no">No thanks</button>' : ''}
        <button class="btn-ghost" id="menu">Continue</button>
        <span class="sub" id="vote"></span>
      </div>
    </div></div>`);
  if (me && !me.isBot) {
    const from = app.xpAtStart;
    const to = from + me.xp;
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = '<span id="xfill"></span>';
    const label = document.createElement('p');
    label.className = 'sub';
    qs('#xp').append(label, bar);
    const t0 = performance.now();
    const anim = (now: number) => {
      const u = Math.min(1, (now - t0) / 900);
      const xp = from + (to - from) * u;
      const prog = xpProgress(xp);
      label.textContent = `Level ${prog.level} · ${prog.into}/${prog.need} xp`;
      (qs('#xfill') as HTMLElement).style.width = `${(prog.into / prog.need) * 100}%`;
      if (u < 1) requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
    if (me.ratingAfter != null && me.ratingBefore != null) {
      const after = tierFor(me.ratingAfter);
      const before = tierFor(me.ratingBefore);
      qs('#rank').innerHTML = `<p class="sub"><span class="badge ${tierClass(before.name)}">${before.name}</span> → <span class="badge ${tierClass(after.name)}">${after.name}</span> ${me.ratingAfter >= me.ratingBefore ? '+' : ''}${Math.round(me.ratingAfter - me.ratingBefore)}</p>`;
    }
  }
  qs('#menu').onclick = () => { net.send({ t: 'leave_room' }); nav.menu(); };
  root.querySelector('#yes')?.addEventListener('click', () => net.send({ t: 'rematch_vote', yes: true }));
  root.querySelector('#no')?.addEventListener('click', () => net.send({ t: 'rematch_vote', yes: false }));
  const off = net.on((msg) => {
    if (msg.t === 'rematch_update') qs('#vote').textContent = `${msg.yes}/${msg.need} ready to splash again`;
  });
  return () => off();
}
