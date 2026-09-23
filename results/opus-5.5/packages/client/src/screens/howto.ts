// How to Play: six short illustrated pages flipped with Left / Right (or the Prev / Next buttons
// and page dots); Escape returns to the menu and Next on the last page finishes.
import { navigate } from '../app';
import { audio } from '../audio';
import { button, h, isTypingTarget } from '../ui';
import type { Screen } from './index';
import { focusInitial, installArrowNav } from './parts/arrowNav';
import { runMenuBackdrop } from './parts/backdrop';
import { HOWTO_PAGES } from './parts/howtoPages';
import { Scope } from './parts/scope';
import { screenShell } from './parts/shell';
import './parts/styles/howto.css';

let scope: Scope | null = null;

export const screen: Screen = {
  mount(root) {
    const s = new Scope();
    scope = s;
    audio.music('menu');
    runMenuBackdrop(s);
    let index = 0;
    let pageScope: Scope | null = null;
    s.add(() => pageScope?.dispose());

    const heading = h('div', { class: 'howto-heading' });
    const page = h('div', { class: 'howto-page' });
    const dots = h('div', { class: 'howto-dots', role: 'tablist', 'aria-label': 'Pages' });
    const prev = button('Prev', () => go(index - 1), { small: true, variant: 'ghost', sound: null });
    const next = button('Next', () => (index === HOWTO_PAGES.length - 1 ? navigate('/menu') : go(index + 1)), { small: true, variant: 'primary', sound: null });
    next.dataset.autofocus = '';

    function go(target: number, silent = false): void {
      if (target < 0 || target >= HOWTO_PAGES.length) return;
      const dir = target >= index ? 'next' : 'prev';
      index = target;
      pageScope?.dispose();
      pageScope = new Scope();
      const def = HOWTO_PAGES[index];
      heading.replaceChildren(h('span', { class: 'howto-num' }, `${index + 1}/${HOWTO_PAGES.length}`), h('span', null, def.title));
      page.replaceChildren(h('div', { class: `howto-body slide-${dir}` }, def.build(pageScope)));
      dots.replaceChildren(
        ...HOWTO_PAGES.map((p, i) =>
          h('button', {
            type: 'button',
            class: `howto-dot${i === index ? ' is-on' : ''}`,
            role: 'tab',
            'aria-selected': String(i === index),
            'aria-label': p.title,
            tabIndex: -1,
            onClick: () => go(i),
          }),
        ),
      );
      prev.disabled = index === 0;
      next.querySelector('.btn-label')!.textContent = index === HOWTO_PAGES.length - 1 ? 'Done' : 'Next';
      if (!silent) audio.sfx('ui_move');
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector('.layer-modals .modal')) return;
      const step = e.code === 'ArrowRight' ? 1 : e.code === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      go(index + step);
    };
    window.addEventListener('keydown', onKey, true);
    s.add(() => window.removeEventListener('keydown', onKey, true));

    root.append(
      screenShell(
        { title: 'How to play', onBack: () => navigate('/menu') },
        heading,
        page,
        h('div', { class: 'howto-nav' }, prev, dots, next),
      ),
    );
    go(0, true);
    s.add(installArrowNav(root));
    focusInitial(root);
  },

  unmount() {
    scope?.dispose();
    scope = null;
  },
};
