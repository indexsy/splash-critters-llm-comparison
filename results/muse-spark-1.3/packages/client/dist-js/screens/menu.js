import { sfx, startMusic } from '../audio.js';
import { app } from '../state.js';
export function renderMenu(root, nav) {
    startMusic('menu');
    root.innerHTML = '';
    const d = document.createElement('div');
    const p = app.profile;
    d.innerHTML = `
    <h1 class="logo">SPLASH CRITTERS</h1>
    <div class="sub" data-profile>${p ? `${p.nickname}#${p.tag} · Lv${p.level}` : 'connecting…'}</div>
    <div class="card">
      <div class="row">
        <label>Nickname <input id="nick" maxlength="16" value="${p ? p.nickname : ''}" placeholder="3-16 chars"/></label>
        <button id="saveNick" class="secondary">Save</button>
      </div>
      <div class="small">Required before ranked queue. Losing your device token = losing the account (see Settings).</div>
    </div>
    <div class="card grid2">
      <button id="qDuel">⚔ Ranked Duel (1v1)</button>
      <button id="qFfa">🏆 Ranked FFA (4p)</button>
      <button id="browse">🔍 Casual: Browse Rooms</button>
      <button id="create">➕ Casual: Create Room</button>
      <button id="practice">🤖 Practice vs Bots</button>
      <button id="tut">🎓 Tutorial</button>
      <button id="board" class="secondary">📊 Leaderboard</button>
      <button id="locker" class="secondary">🎽 Locker</button>
      <button id="how" class="secondary">❓ How to Play</button>
      <button id="settings" class="secondary">⚙ Settings</button>
    </div>
    <div class="card small" id="howCard" style="display:none">
      <b>How to play:</b> Drop water balloons (Space/E) next to sandcastles. Splashes burst in a cross, blocked by boulders, washing the first castle per direction. Chain balloons for DOUBLE SPLASH! Grab power-ups (extra balloon, big splash, flippers, rare rubber boots to kick balloons). At 2:00 the Rising Tide floods the arena. Ranked: first to 3 round wins. Soaked players in casual ride revenge duckies and lob balloons!
    </div>`;
    root.appendChild(d);
    const click = (id, fn) => {
        d.querySelector(id).onclick = () => {
            sfx.click();
            fn();
        };
    };
    click('#saveNick', () => {
        const v = d.querySelector('#nick').value;
        import('../net.js').then(({ net }) => net.send({ kind: 'set_nickname', nickname: v }));
    });
    click('#qDuel', () => nav('#/queue?mode=duel'));
    click('#qFfa', () => nav('#/queue?mode=ffa'));
    click('#browse', () => nav('#/browser'));
    click('#create', () => nav('#/browser?create=1'));
    click('#practice', () => nav('#/browser?practice=1'));
    click('#tut', () => nav('#/tutorial'));
    click('#board', () => nav('#/leaderboard'));
    click('#locker', () => nav('#/locker'));
    click('#how', () => {
        const c = d.querySelector('#howCard');
        c.style.display = c.style.display === 'none' ? 'block' : 'none';
    });
    click('#settings', () => nav('#/settings'));
    return () => { };
}
