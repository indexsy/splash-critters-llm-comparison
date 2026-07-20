import { net } from '../net';
import { nav } from '../router';
import { store } from '../store';
import { btn, clearNode, h, screenEl } from '../ui';
const CARDS = [
    { icon: '🐸', title: 'Welcome!', body: 'You are a cute critter in a water-balloon arena. Move with WASD or the Arrow keys.' },
    { icon: '💦', title: 'Drop a balloon', body: 'Press Space or E to drop a water balloon. After 3 seconds it bursts into a cross-shaped splash. Get clear before it pops — it can soak YOU too!' },
    { icon: '🏰', title: 'Wash sandcastles', body: 'Splashes wash away the first sandcastle they touch. Break them to open the arena and reveal hidden power-ups.' },
    { icon: '⚡', title: 'Chain reactions', body: 'A splash that reaches another balloon sets it off instantly. Line up balloons for DOUBLE and TRIPLE SPLASH combos!' },
    { icon: '🎁', title: 'Power-ups', body: 'Grab Extra Balloon, Big Splash, Flippers and Rubber Boots to get stronger each round.' },
    { icon: '🏆', title: 'Last one dry wins', body: "Soak your opponent to win the round. Ready to try it against an Easy bot?" },
];
export function mount(root) {
    store.markTutorialSeen();
    const el = screenEl(true);
    let i = 0;
    function render() {
        clearNode(el);
        const c = CARDS[i];
        el.append(h('div', { class: 'row between' }, [
            h('div', { class: 'title', style: 'font-size:20px', text: `Tutorial ${i + 1}/${CARDS.length}` }),
            btn('Skip', { variant: 'ghost', onclick: () => nav.go('menu') }),
        ]), h('div', { class: 'panel col', style: 'align-items:center;text-align:center;gap:10px;min-height:170px;justify-content:center' }, [
            h('div', { style: 'font-size:56px', text: c.icon }),
            h('div', { class: 'tier', style: 'color:var(--accent);font-size:18px', text: c.title }),
            h('div', { class: 'muted', text: c.body }),
        ]), h('div', { class: 'row' }, [
            i > 0 ? btn('Back', { onclick: () => { i--; render(); } }) : h('span', { class: 'spacer' }),
            h('div', { class: 'spacer' }),
            i < CARDS.length - 1
                ? btn('Next', { variant: 'primary', onclick: () => { i++; render(); } })
                : btn('Try it! (vs Easy bot)', { variant: 'accent big', onclick: startPractice }),
        ]));
    }
    function startPractice() {
        net.send({ type: 'tutorial_done' });
        net.send({ type: 'practice', mode: 'duel', bots: ['easy'] });
    }
    render();
    root.append(el);
    return {
        unmount() {
            el.remove();
        },
    };
}
//# sourceMappingURL=tutorial.js.map