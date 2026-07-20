/**
 * Tiny DOM helpers for building the menu screens (no framework).
 */
export function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null)
            continue;
        if (k === 'class')
            el.className = String(v);
        else if (k === 'text')
            el.textContent = String(v);
        else if (k === 'html')
            el.innerHTML = String(v);
        else if (k === 'onclick')
            el.addEventListener('click', v);
        else if (k === 'oninput')
            el.addEventListener('input', v);
        else if (k === 'onchange')
            el.addEventListener('change', v);
        else if (k === 'disabled')
            el.disabled = Boolean(v);
        else if (k === 'value')
            el.value = String(v);
        else if (k === 'maxLength')
            el.maxLength = Number(v);
        else
            el.setAttribute(k, String(v));
    }
    for (const c of children)
        el.append(c);
    return el;
}
export function btn(label, opts = {}) {
    const cls = `btn ${opts.variant ?? ''} ${opts.class ?? ''}`.trim();
    return h('button', { ...opts, class: cls, text: label });
}
export function screenEl(narrow = false) {
    return h('div', { class: `screen panel ${narrow ? 'narrow' : ''}` });
}
export function clearNode(el) {
    el.replaceChildren();
}
let toastRoot = null;
export function toast(msg, bad = false) {
    if (!toastRoot)
        toastRoot = document.getElementById('toast');
    if (!toastRoot)
        return;
    const item = h('div', { class: `toast-item ${bad ? 'bad' : ''}`, text: msg });
    toastRoot.append(item);
    setTimeout(() => {
        item.style.opacity = '0';
        setTimeout(() => item.remove(), 300);
    }, 2200);
}
//# sourceMappingURL=ui.js.map