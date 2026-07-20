import { net } from '../net';
import { nav } from '../router';
import { store } from '../store';
import { btn, clearNode, h, screenEl } from '../ui';
export function mount(root) {
    const el = screenEl(true);
    function render() {
        clearNode(el);
        const q = store.queue;
        el.append(h('div', { class: 'title', style: 'font-size:26px', text: 'Finding a Match' }), h('div', { class: 'subtitle', text: q ? `${q.mode === 'duel' ? 'Ranked Duel' : 'Ranked Free-for-All'}` : 'Queuing…' }), h('div', { class: 'panel col', style: 'align-items:center;gap:6px' }, [
            h('div', { style: 'font-size:34px', text: spinner() }),
            h('div', { class: 'row center' }, [
                stat('Elapsed', q ? `${q.elapsed}s` : '0s'),
                stat('Search ±', q ? `${q.searchRange}` : '100'),
                stat('In queue', q ? `${q.size}` : '1'),
            ]),
        ]), btn('Cancel', {
            variant: 'danger wide',
            onclick: () => {
                net.send({ type: 'queue_leave' });
                store.queue = null;
                nav.go('menu');
            },
        }));
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
function stat(label, value) {
    return h('div', { class: 'col', style: 'align-items:center;min-width:80px' }, [
        h('div', { style: 'font-size:20px;font-weight:800', text: value }),
        h('label', { text: label }),
    ]);
}
let dots = 0;
function spinner() {
    dots = (dots + 1) % 4;
    return '💧'.repeat(dots + 1);
}
//# sourceMappingURL=queue.js.map