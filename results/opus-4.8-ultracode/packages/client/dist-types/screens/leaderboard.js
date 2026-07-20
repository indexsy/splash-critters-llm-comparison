import { fetchLeaderboard, net } from '../net';
import { nav } from '../router';
import { store } from '../store';
import { btn, clearNode, h, screenEl } from '../ui';
export function mount(root) {
    void net;
    const el = screenEl();
    let mode = 'duel';
    void fetchLeaderboard(mode);
    function render() {
        clearNode(el);
        const lb = store.leaderboard;
        const rows = lb && lb.mode === mode ? lb.entries : [];
        el.append(h('div', { class: 'row between' }, [
            h('div', { class: 'title', style: 'font-size:26px', text: 'Leaderboard' }),
            btn('Back', { onclick: () => nav.go('menu') }),
        ]), h('div', { class: 'row' }, [
            tab('Duel', mode === 'duel', () => switchMode('duel')),
            tab('Free-for-All', mode === 'ffa', () => switchMode('ffa')),
        ]), rows.length
            ? table(rows)
            : h('div', { class: 'subtitle', text: lb ? 'No ranked games played yet — be the first!' : 'Loading…' }));
    }
    function switchMode(m) {
        mode = m;
        render();
        void fetchLeaderboard(m);
    }
    const unsub = store.subscribe(render);
    render();
    root.append(el);
    return {
        unmount() {
            unsub();
            el.remove();
        },
    };
}
function tab(label, active, onclick) {
    return btn(label, { variant: active ? 'primary' : 'ghost', onclick });
}
function table(rows) {
    const t = h('table');
    t.append(h('tr', {}, [th('#'), th('Critter'), th('Tier'), th('Rating'), th('W/L'), th('Win%')]));
    for (const r of rows) {
        t.append(h('tr', {}, [
            td(String(r.rank)),
            td(r.displayName),
            tdColor(r.tierName, tierColor(r.tier)),
            td(String(r.rating)),
            td(`${r.wins}/${r.games - r.wins}`),
            td(`${r.winrate}%`),
        ]));
    }
    return t;
}
function th(t) {
    return h('th', { text: t });
}
function td(t) {
    return h('td', { text: t });
}
function tdColor(t, color) {
    return h('td', { text: t, style: `color:${color};font-weight:700` });
}
function tierColor(tier) {
    return ({ puddle: '#9fb4e6', pond: '#4ee66a', river: '#34d1ff', lake: '#7c8cff', ocean: '#c58cff', tsunami: '#ffd23f' }[tier] ?? '#eaf2ff');
}
//# sourceMappingURL=leaderboard.js.map