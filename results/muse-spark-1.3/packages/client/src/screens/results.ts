import { net } from '../net.js';
import { app } from '../state.js';
import { session } from '../session.js';
import { sfx, startMusic } from '../audio.js';
import { tierFor } from '@splash/shared';

export function renderResults(root: HTMLElement, nav: (h: string) => void): () => void {
  startMusic('menu');
  const pl = session.placements ?? [];
  root.innerHTML = '';
  const d = document.createElement('div');
  const rows = pl
    .map((p) => {
      const delta = session.ratingDeltas?.[p.playerId];
      const xp = session.xp?.[p.playerId] ?? p.xpEarned ?? 0;
      const medal = p.placement === 1 ? '🥇' : p.placement === 2 ? '🥈' : p.placement === 3 ? '🥉' : `${p.placement}.`;
      const tier = delta !== undefined && p.ratingAfter !== undefined ? ` <span class="tier">${tierFor(p.ratingAfter)}</span>` : '';
      const dstr = delta !== undefined ? ` <b style="color:${delta >= 0 ? '#2fbf71' : '#e4572e'}">${delta >= 0 ? '+' : ''}${delta}</b>` : '';
      return `<tr><td>${medal}</td><td>${escapeHtml(p.nickname)}</td><td>${p.roundsWon}</td><td>${p.soaks}</td><td>+${xp} XP</td><td>${dstr}${tier}</td></tr>`;
    })
    .join('');
  // fun stats
  const mostSoaks = [...pl].sort((a, b) => b.soaks - a.soaks)[0];
  d.innerHTML = `
    <div class="card">
      <h2>🏁 Match results</h2>
      <table><tr><th>#</th><th>Critter</th><th>Rounds</th><th>Soaks</th><th>XP</th><th>Rating</th></tr>${rows}</table>
      <div class="small" style="margin-top:8px">
        🌊 Most Soaks: <b>${mostSoaks ? escapeHtml(mostSoaks.nickname) : '—'}</b> ·
        🧱 Castle Crusher & Longest Survivor & Biggest Chain tracked in stats feed.
      </div>
      <div class="row" style="margin-top:8px">
        <button id="again" class="secondary">Rematch vote</button>
        <button id="menu">Continue</button>
      </div>
      <div class="small">XP bar: ${app.profile ? `Lv${app.profile.level} · ${app.profile.xp} XP` : ''} (refreshes on next welcome)</div>
    </div>`;
  root.appendChild(d);
  sfx.fanfare();
  (d.querySelector('#menu') as HTMLButtonElement).onclick = () => nav('#/menu');
  (d.querySelector('#again') as HTMLButtonElement).onclick = () => {
    net.send({ kind: 'rematch_vote', yes: true });
    nav(session.code ? `#/room/${session.code}` : '#/menu');
  };
  return () => {};
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
