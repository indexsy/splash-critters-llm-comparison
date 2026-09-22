export function hudCards(
  players: { id: string; name: string; tag: string; tier: string; rating: number; bot: boolean; difficulty?: string }[],
  live: { id: string; roundWins: number; splashRange: number; balloonMax: number; ping: number; alive: boolean }[],
  me: string,
  roundsToWin: number,
  ranked: boolean,
): string {
  return players
    .map((card) => {
      const row = live.find((p) => p.id === card.id);
      const wins = row?.roundWins ?? 0;
      const dots = Array.from({ length: roundsToWin }, (_, i) => (i < wins ? '●' : '○')).join('');
      return `<div class="card ${card.id === me ? 'me' : ''} ${row && !row.alive ? 'dead' : ''}">
        <strong>${escapeHtml(card.name)}#${card.tag}</strong>
        <div class="muted">${card.bot ? card.difficulty ?? 'bot' : card.tier} ${ranked ? card.rating : ''}</div>
        <div>${dots}</div>
        <div class="muted">Splash ${row?.splashRange ?? 2} · Balloons ${row?.balloonMax ?? 1} · ${row?.ping ?? 0}ms</div>
      </div>`;
    })
    .join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
