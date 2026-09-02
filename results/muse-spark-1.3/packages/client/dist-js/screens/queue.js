import { net } from '../net.js';
import { sfx, startMusic } from '../audio.js';
import { session } from '../session.js';
export function renderQueue(root, nav, mode) {
    startMusic('menu');
    session.mode = mode;
    root.innerHTML = '';
    const d = document.createElement('div');
    d.innerHTML = `
    <div class="card" style="text-align:center">
      <b>Ranked ${mode === 'duel' ? 'Duel (1v1)' : 'Free-for-All (4p)'} queue</b>
      <div id="st" class="small">Joining…</div>
      <div class="row" style="justify-content:center"><button id="cancel" class="warn">Cancel</button></div>
      <div class="small">Humans only — never bots. ±100 rating, +50/10s, cap ±400. Disconnect = forfeit after 15s.</div>
    </div>`;
    root.appendChild(d);
    net.send({ kind: 'queue_join', mode });
    d.querySelector('#cancel').onclick = () => {
        net.send({ kind: 'queue_leave' });
        nav('#/menu');
    };
    const off = net.on((m) => {
        if (m.kind === 'queue_status') {
            session.queue = { mode: m.mode, elapsedS: m.elapsedS, searchRange: m.searchRange };
            d.querySelector('#st').textContent =
                `Searching… ${m.elapsedS}s · range ±${m.searchRange} · ETA ~${m.etaS}s`;
        }
        else if (m.kind === 'match_found') {
            sfx.fanfare();
            session.code = m.code;
            nav('#/game');
        }
        else if (m.kind === 'error' && m.code === 'need_nick') {
            d.querySelector('#st').innerHTML =
                `⚠ Set a nickname first (menu), then queue. <button id="go">Back</button>`;
            d.querySelector('#go').onclick = () => nav('#/menu');
        }
    });
    return () => {
        off();
    };
}
