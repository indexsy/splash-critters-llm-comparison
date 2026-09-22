import type { SnapshotPlayer } from '@splash/shared';

export function hudHtml(players: SnapshotPlayer[], myId: string, roundWins: number): string {
  return players
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const pips = Array.from({ length: roundWins }, (_, i) => `<i class="pip${i < p.roundWins ? ' on' : ''}"></i>`).join('');
      const me = p.id === myId ? ' style="border-color:#3ec6e0"' : '';
      return `<div class="card"${me}>
        <strong>${escape(p.name)}</strong>
        <div class="sub" style="margin:4px 0">${p.alive ? 'dry' : p.ducking ? 'duck duty' : 'soaked'} · ${p.ping ?? 0}ms</div>
        <div>${pips}</div>
        <div class="sub" style="margin:6px 0 0">B${p.balloonCount} · S${p.splashRange} · ${p.speed.toFixed(1)}${p.hasKick ? ' · kick' : ''}</div>
      </div>`;
    })
    .join('');
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}
