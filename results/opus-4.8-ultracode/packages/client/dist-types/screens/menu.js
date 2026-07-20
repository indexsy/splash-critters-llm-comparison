import { net } from '../net';
import { nav } from '../router';
import { store } from '../store';
import { btn, clearNode, h, screenEl, toast } from '../ui';
export function mount(root) {
    const el = screenEl();
    let panel = 'root';
    function render() {
        clearNode(el);
        el.append(header());
        if (panel === 'root')
            el.append(rootPanel());
        else if (panel === 'create')
            el.append(createPanel());
        else if (panel === 'join')
            el.append(joinPanel());
        else if (panel === 'practice')
            el.append(practicePanel());
    }
    function header() {
        const name = store.profile?.displayName ?? '';
        return h('div', { class: 'row between' }, [
            h('div', { class: 'title', style: 'font-size:26px', text: 'Main Menu' }),
            h('div', { class: 'row' }, [
                h('span', { class: 'chip', text: name }),
                btn('Back', { onclick: () => nav.go('title') }),
            ]),
        ]);
    }
    function rootPanel() {
        return h('div', { class: 'col' }, [
            nicknameRow(),
            h('label', { text: 'Ranked' }),
            h('div', { class: 'btn-grid' }, [
                btn('Ranked Duel (1v1)', { variant: 'primary', onclick: () => queue('duel') }),
                btn('Ranked Free-for-All', { variant: 'primary', onclick: () => queue('ffa') }),
            ]),
            h('label', { text: 'Casual' }),
            h('div', { class: 'btn-grid' }, [
                btn('Browse Rooms', { onclick: () => nav.go('browser') }),
                btn('Create Room', { onclick: () => setPanel('create') }),
                btn('Join by Code', { onclick: () => setPanel('join') }),
                btn('Practice vs Bots', { onclick: () => setPanel('practice') }),
            ]),
            h('div', { class: 'row', style: 'margin-top:6px' }, [
                btn('Leaderboard', { class: 'grow', onclick: () => nav.go('leaderboard') }),
                btn('Locker', { class: 'grow', onclick: () => nav.go('locker') }),
                btn('How to Play', { class: 'grow', onclick: () => nav.go('howto') }),
                btn('Settings', { class: 'grow', onclick: () => nav.go('settings') }),
            ]),
        ]);
    }
    function nicknameRow() {
        const input = h('input', {
            type: 'text',
            value: store.profile?.nickname ?? '',
            placeholder: 'Nickname (3-16)',
            maxLength: 16,
            class: 'grow',
        });
        return h('div', { class: 'row' }, [
            h('label', { text: 'Name' }),
            input,
            btn('Save', {
                onclick: () => {
                    const v = input.value.trim();
                    if (v.length < 3)
                        return toast('Nickname too short', true);
                    net.send({ type: 'set_nickname', name: v });
                    toast('Nickname saved');
                },
            }),
        ]);
    }
    function queue(mode) {
        net.send({ type: 'queue_join', mode });
        store.queue = { mode, elapsed: 0, searchRange: 100, size: 1 };
        nav.go('queue');
    }
    function setPanel(p) {
        panel = p;
        render();
    }
    function createPanel() {
        const state = {
            name: `${store.profile?.nickname ?? 'Splash'}'s Room`,
            mode: 'ffa',
            isPublic: true,
            theme: 'random',
            roundsToWin: 3,
            botFill: true,
        };
        const nameInput = h('input', { type: 'text', value: state.name, maxLength: 24, class: 'grow' });
        return h('div', { class: 'col' }, [
            h('div', { class: 'title', style: 'font-size:20px', text: 'Create Room' }),
            row('Room name', nameInput),
            row('Size', pick(['ffa', 'duel'], ['4-Player', '2-Player'], state.mode, (v) => (state.mode = v))),
            row('Visibility', pick(['true', 'false'], ['Public', 'Private'], String(state.isPublic), (v) => (state.isPublic = v === 'true'))),
            row('Theme', pick(['random', 'backyard', 'beach', 'pool'], ['Random', 'Backyard', 'Beach', 'Pool Party'], state.theme, (v) => (state.theme = v))),
            row('Rounds to win', pick(['2', '3', '5'], ['2', '3', '5'], String(state.roundsToWin), (v) => (state.roundsToWin = Number(v)))),
            row('Fill empty with bots', pick(['true', 'false'], ['Yes', 'No'], String(state.botFill), (v) => (state.botFill = v === 'true'))),
            h('div', { class: 'row' }, [
                btn('Create', {
                    variant: 'primary grow',
                    onclick: () => {
                        const opts = {
                            name: nameInput.value.trim() || 'Splash Room',
                            mode: state.mode,
                            isPublic: state.isPublic,
                            theme: state.theme,
                            roundsToWin: state.roundsToWin,
                            botFill: state.botFill,
                        };
                        net.send({ type: 'create_room', opts });
                    },
                }),
                btn('Back', { onclick: () => setPanel('root') }),
            ]),
        ]);
    }
    function joinPanel() {
        const codeInput = h('input', { type: 'text', placeholder: 'ROOM CODE', maxLength: 6, class: 'grow', style: 'text-transform:uppercase' });
        return h('div', { class: 'col' }, [
            h('div', { class: 'title', style: 'font-size:20px', text: 'Join by Code' }),
            row('Code', codeInput),
            h('div', { class: 'row' }, [
                btn('Join', {
                    variant: 'primary grow',
                    onclick: () => {
                        const code = codeInput.value.trim().toUpperCase();
                        if (code.length < 4)
                            return toast('Enter a room code', true);
                        net.send({ type: 'join_room', code });
                    },
                }),
                btn('Back', { onclick: () => setPanel('root') }),
            ]),
        ]);
    }
    function practicePanel() {
        const state = { mode: 'ffa', diff: 'medium' };
        return h('div', { class: 'col' }, [
            h('div', { class: 'title', style: 'font-size:20px', text: 'Practice vs Bots' }),
            row('Size', pick(['ffa', 'duel'], ['4-Player', '2-Player'], state.mode, (v) => (state.mode = v))),
            row('Bot difficulty', pick(['easy', 'medium', 'hard'], ['Easy', 'Medium', 'Hard'], state.diff, (v) => (state.diff = v))),
            h('div', { class: 'row' }, [
                btn('Start', {
                    variant: 'primary grow',
                    onclick: () => {
                        const count = state.mode === 'duel' ? 1 : 3;
                        net.send({ type: 'practice', mode: state.mode, bots: Array(count).fill(state.diff) });
                    },
                }),
                btn('Back', { onclick: () => setPanel('root') }),
            ]),
        ]);
    }
    const unsub = store.subscribe(() => {
        if (panel === 'root')
            render();
    });
    render();
    root.append(el);
    return {
        unmount() {
            unsub();
            el.remove();
        },
    };
}
function row(label, control) {
    return h('div', { class: 'row' }, [h('label', { style: 'min-width:130px', text: label }), control]);
}
function pick(values, labels, current, onPick) {
    const wrap = h('div', { class: 'row grow' });
    const buttons = [];
    values.forEach((v, i) => {
        const b = btn(labels[i], {
            variant: v === current ? 'primary' : 'ghost',
            onclick: () => {
                onPick(v);
                buttons.forEach((bb, j) => (bb.className = `btn ${values[j] === v ? 'primary' : 'ghost'}`));
            },
        });
        buttons.push(b);
        wrap.append(b);
    });
    return wrap;
}
//# sourceMappingURL=menu.js.map