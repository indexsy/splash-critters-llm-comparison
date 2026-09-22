import { xpIntoLevel } from '@splash/shared';
import type { App } from '../app.js';

export function mountResults(root: HTMLElement, app: App): () => void {
  const end = app.session.matchEnd;
  if (!end) {
    root.innerHTML = `<div class="shell"><div class="panel">No results.</div></div>`;
    return () => {};
  }
  app.audio.play('win');
  const me = app.profile?.id ?? '';
  const delta = end.ratingDeltas[me];
  const xp = end.xp[me] ?? 0;
  const prog = app.profile ? xpIntoLevel(app.profile.xp) : null;
  const stats = [
    ['Most Soaks', end.stats.mostSoaks],
    ['Castle Crusher', end.stats.castleCrusher],
    ['Longest Survivor', end.stats.longestSurvivor],
    ['Biggest Chain', end.stats.biggestChain],
  ] as const;
  root.innerHTML = `
    <div class="shell">
      <div class="panel">
        <h1>Results</h1>
        <table><thead><tr><th>#</th><th>Critter</th><th>Rounds</th><th>Soaks</th><th>Castles</th></tr></thead>
        <tbody>${end.placements
          .map(
            (p) =>
              `<tr><td>${p.placement}</td><td>${p.name}#${p.tag}${p.bot ? ' · bot' : ''}</td><td>${p.roundWins}</td><td>${p.soaks}</td><td>${p.castles}</td></tr>`,
          )
          .join('')}</tbody></table>
        <div class="grid cards" style="margin-top:12px">${stats
          .map(([label, stat]) => `<div class="card"><strong>${label}</strong><div>${stat ? `${stat.name} · ${stat.value}` : '—'}</div></div>`)
          .join('')}</div>
        <p>XP +${xp}</p>
        ${prog ? `<div class="bar"><span style="width:${Math.round((prog.into / prog.need) * 100)}%"></span></div><p class="muted">Level ${prog.level} · ${prog.into}/${prog.need}</p>` : ''}
        ${delta ? `<p>Rating ${delta.before} → ${delta.after} (${delta.delta >= 0 ? '+' : ''}${delta.delta}) · ${delta.tierBefore}${delta.tierAfter !== delta.tierBefore ? ' → ' + delta.tierAfter : ''}</p>` : ''}
        <div class="row">${end.casual ? '<button id="rematch">Rematch</button>' : ''}<button id="cont">Continue</button></div>
        <p id="votes" class="muted"></p>
      </div>
    </div>`;
  root.querySelector('#cont')!.addEventListener('click', () => app.goto('menu'));
  root.querySelector('#rematch')?.addEventListener('click', () => app.net.send({ t: 'rematch_vote', yes: true }));
  const off = app.net.on((msg) => {
    if (msg.t === 'rematch_status') {
      const el = root.querySelector('#votes');
      if (el) el.textContent = `Rematch votes ${msg.yes}/${msg.need}`;
    }
  });
  return () => off();
}
