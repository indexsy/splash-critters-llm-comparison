import { audio } from '../audio';
import { input } from '../input';
import { nav } from '../router';
import { store } from '../store';
import { btn, clearNode, h, screenEl, toast } from '../ui';
const BIND_LABELS = {
    up: 'Move Up',
    down: 'Move Down',
    left: 'Move Left',
    right: 'Move Right',
    balloon: 'Drop Balloon',
};
export function mount(root) {
    const el = screenEl();
    let capturing = null;
    function apply() {
        audio.setVolumes(store.settings.sfx, store.settings.music, store.settings.muted);
        store.saveSettings();
    }
    function render() {
        clearNode(el);
        const s = store.settings;
        el.append(h('div', { class: 'row between' }, [
            h('div', { class: 'title', style: 'font-size:24px', text: 'Settings' }),
            btn('Back', { onclick: () => nav.go('title') }),
        ]), slider('SFX Volume', s.sfx, (v) => { s.sfx = v; apply(); }), slider('Music Volume', s.music, (v) => { s.music = v; apply(); }), toggle('Mute All (M)', s.muted, (v) => { s.muted = v; apply(); }), toggle('Reduce Screen Shake', s.reduceShake, (v) => { s.reduceShake = v; apply(); }), toggle('Colorblind-Safe Splashes', s.colorblind, (v) => { s.colorblind = v; apply(); }), h('label', { text: 'Keybindings (click, then press a key)' }), ...Object.keys(BIND_LABELS).map((a) => bindRow(a)), h('div', { class: 'panel', style: 'padding:10px;margin-top:8px' }, [
            h('div', { class: 'tier', style: 'color:var(--bad)', text: 'Account' }),
            h('div', { class: 'small muted', text: 'Your account lives on this device via a saved token. There are no passwords — clearing your browser storage or losing the token means losing this account and its unlocks.' }),
        ]));
    }
    function bindRow(action) {
        const keys = store.settings.binds[action].join(' / ');
        return h('div', { class: 'row between', style: 'border:2px solid var(--line);border-radius:6px;padding:6px 10px' }, [
            h('span', { text: BIND_LABELS[action] }),
            btn(capturing === action ? 'press a key…' : keys, {
                variant: capturing === action ? 'accent' : 'ghost',
                onclick: () => {
                    capturing = action;
                    render();
                    input.setCapture((code) => {
                        store.settings.binds[action] = [code];
                        capturing = null;
                        store.saveSettings();
                        toast(`${BIND_LABELS[action]} → ${code}`);
                        render();
                    });
                },
            }),
        ]);
    }
    const unsub = store.subscribe(() => {
        if (!capturing)
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
function slider(label, value, onchange) {
    const input = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(value * 100)), class: 'grow' });
    input.addEventListener('input', () => onchange(Number(input.value) / 100));
    return h('div', { class: 'row' }, [h('label', { style: 'min-width:130px', text: label }), input]);
}
function toggle(label, value, onchange) {
    return h('div', { class: 'row between', style: 'border:2px solid var(--line);border-radius:6px;padding:6px 10px' }, [
        h('span', { text: label }),
        btn(value ? 'ON' : 'OFF', { variant: value ? 'primary' : 'ghost', onclick: () => onchange(!value) }),
    ]);
}
//# sourceMappingURL=settings.js.map