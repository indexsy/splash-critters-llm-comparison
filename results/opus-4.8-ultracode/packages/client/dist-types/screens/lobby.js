import { net } from '../net';
import { nav } from '../router';
import { slotColor } from '../theme';
import { store } from '../store';
import { btn, clearNode, h, screenEl } from '../ui';
export function mount(root) {
    const el = screenEl();
    function render() {
        clearNode(el);
        const lobby = store.lobby;
        if (!lobby) {
            el.append(h('div', { class: 'subtitle', text: 'No lobby.' }), btn('Back', { onclick: () => nav.go('menu') }));
            return;
        }
        const isHost = lobby.hostId === store.profile?.id;
        const me = lobby.slots.find((s) => s.playerId === store.profile?.id);
        el.append(h('div', { class: 'row between' }, [
            h('div', {}, [
                h('div', { class: 'title', style: 'font-size:24px', text: lobby.name }),
                h('div', { class: 'small muted', text: `Code ${lobby.code} · ${lobby.mode === 'duel' ? '2P Duel' : '4P FFA'} · first to ${lobby.roundsToWin} · ${lobby.ranked ? 'Ranked' : lobby.practice ? 'Practice' : 'Casual'}` }),
            ]),
            btn('Leave', { variant: 'danger', onclick: () => { net.send({ type: 'leave_room' }); nav.go('menu'); } }),
        ]), h('div', { class: 'row', style: 'flex-wrap:wrap' }, lobby.slots.map((s) => slotCard(s, isHost))), h('div', { class: 'row', style: 'margin-top:8px' }, [
            me && !lobby.practice
                ? btn(me.ready ? 'Ready ✓' : 'Ready?', { variant: me.ready ? 'accent' : 'ghost', onclick: () => net.send({ type: 'set_ready', ready: !me.ready }) })
                : h('span', {}),
            h('div', { class: 'spacer' }),
            isHost ? btn('Start Match', { variant: 'primary big', onclick: () => net.send({ type: 'start_match' }) }) : h('span', { class: 'chip', text: 'Waiting for host…' }),
        ]), lobby.isPublic ? h('div', { class: 'small muted', text: 'Public room — others can join from the browser.' }) : h('div', { class: 'small muted', text: `Private — share code ${lobby.code}` }));
    }
    function slotCard(s, isHost) {
        const label = s.kind === 'human' ? s.name ?? 'Player' : s.kind === 'bot' ? `${s.name ?? 'CPU'}` : s.kind === 'closed' ? 'Closed' : 'Open';
        const controls = [];
        if (isHost && s.kind !== 'human') {
            const diffSel = h('select', {
                onchange: (e) => net.send({ type: 'set_slot', slot: s.index, kind: 'bot', difficulty: e.target.value }),
            });
            for (const d of ['easy', 'medium', 'hard']) {
                const o = h('option', { value: d, text: d[0].toUpperCase() + d.slice(1) });
                if (s.difficulty === d)
                    o.selected = true;
                diffSel.append(o);
            }
            controls.push(h('div', { class: 'row', style: 'gap:4px' }, [
                btn('Bot', { class: 'small', variant: s.kind === 'bot' ? 'primary' : 'ghost', onclick: () => net.send({ type: 'set_slot', slot: s.index, kind: 'bot', difficulty: s.difficulty ?? 'medium' }) }),
                btn('Open', { class: 'small', variant: s.kind === 'empty' ? 'primary' : 'ghost', onclick: () => net.send({ type: 'set_slot', slot: s.index, kind: 'open' }) }),
                btn('X', { class: 'small', variant: s.kind === 'closed' ? 'primary' : 'ghost', onclick: () => net.send({ type: 'set_slot', slot: s.index, kind: 'closed' }) }),
            ]));
            if (s.kind === 'bot')
                controls.push(diffSel);
        }
        return h('div', { class: 'slot', style: `flex:1;min-width:150px;border-color:${slotColor(s.index, store.settings.colorblind)}` }, [
            h('span', { class: 'swatch', style: `background:${slotColor(s.index, store.settings.colorblind)}` }),
            h('div', { class: 'col', style: 'gap:4px;flex:1' }, [
                h('div', { style: 'font-weight:700', text: label }),
                s.kind === 'human' ? h('div', { class: 'small muted', text: s.ready ? 'ready' : s.isHost ? 'host' : 'not ready' }) : h('div', { class: 'small muted', text: s.kind === 'bot' ? (s.difficulty ?? 'medium') : '' }),
                ...controls,
            ]),
        ]);
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
//# sourceMappingURL=lobby.js.map