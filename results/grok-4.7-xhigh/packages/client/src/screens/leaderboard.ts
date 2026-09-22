import { mount, qs, tierClass } from '../app.js';

export function showLeaderboard(nav: { back: () => void }) {
  let mode: 'duel' | 'ffa' = 'duel';
  const root = mount(`
    <div class="shell"><div class="panel">
      <div class="row" style="justify-content:space-between"><h2>Leaderboard</h2><button class="btn-ghost" id="back">Back</button></div>
      <div class="row" style="margin:10px 0"><button class="btn small" id="duel">Duel</button><button class="btn small" id="ffa">Free-for-All</button></div>
      <table><thead><tr><th>#</th><th>Player</th><th>Rating</th><th>Tier</th><th>Games</th><th>Winrate</th></tr></thead><tbody id="rows"></tbody></table>
    </div></div>`);
  async function load() {
    const res = await fetch(`/api/leaderboard?mode=${mode}`);
    const data = await res.json() as { rows: { rank: number; name: string; rating: number; tier: string; games: number; winrate: number }[] };
    qs('#rows').innerHTML = data.rows.map((r) => `<tr><td>${r.rank}</td><td>${r.name}</td><td>${r.rating}</td><td><span class="badge ${tierClass(r.tier)}">${r.tier}</span></td><td>${r.games}</td><td>${r.winrate}%</td></tr>`).join('')
      || '<tr><td colspan="6">No ranked games yet.</td></tr>';
  }
  qs('#back').onclick = nav.back;
  qs('#duel').onclick = () => { mode = 'duel'; void load(); };
  qs('#ffa').onclick = () => { mode = 'ffa'; void load(); };
  void load();
  return () => {};
}
