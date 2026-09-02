import { sfx } from '../audio.js';
export function renderLeaderboard(root, nav) {
    root.innerHTML = '';
    const d = document.createElement('div');
    d.innerHTML = `
    <div class="card">
      <div class="row"><button id="back" class="secondary">← Menu</button><b>Leaderboard</b>
      <select id="mode"><option value="duel">Duel 1v1</option><option value="ffa">FFA 4p</option></select></div>
      <div id="rows" style="margin-top:8px">loading…</div>
    </div>`;
    root.appendChild(d);
    d.querySelector('#back').onclick = () => { sfx.click(); nav('#/menu'); };
    const load = async () => {
        const mode = d.querySelector('#mode').value;
        const box = d.querySelector('#rows');
        try {
            const r = await fetch(`/api/leaderboard?mode=${mode}`);
            const j = await r.json();
            box.innerHTML = `<table><tr><th>#</th><th>Critter</th><th>Tier</th><th>Rating</th><th>Games</th><th>Win%</th></tr>` +
                j.rows.map((x) => `<tr><td>${x.rank}</td><td>${escapeHtml(x.nickname)}#${escapeHtml(x.tag)}</td><td><span class="tier">${escapeHtml(x.tier)}</span></td><td>${x.rating}</td><td>${x.games}</td><td>${Math.round(x.winrate * 100)}%</td></tr>`).join('') + `</table>`;
        }
        catch {
            box.textContent = 'Failed to load.';
        }
    };
    d.querySelector('#mode').onchange = () => void load();
    void load();
    return () => { };
}
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
