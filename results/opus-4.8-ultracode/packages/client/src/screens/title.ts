import { audio } from '../audio';
import { nav, type ScreenInstance } from '../router';
import { store } from '../store';
import { btn, clearNode, h, screenEl } from '../ui';

export function mount(root: HTMLElement): ScreenInstance {
  audio.startMusic('menu');
  const el = screenEl(true);

  function render(): void {
    clearNode(el);
    const name = store.profile?.displayName ?? '...';
    el.append(
      h('div', { class: 'title big' }, ['SPLASH ', h('span', { class: 'drop', text: 'CRITTERS' })]),
      h('div', { class: 'subtitle', text: 'An 8-bit online water-balloon battler' }),
      h('div', { class: 'row center', style: 'margin-top:8px' }, [
        h('span', { class: 'chip', text: store.connected ? '● online' : '○ connecting…' }),
        h('span', { class: 'chip', text: name }),
      ]),
      h('div', { class: 'col', style: 'margin-top:16px' }, [
        btn('Play', { variant: 'primary big wide', onclick: () => nav.go('menu') }),
        store.tutorialSeen
          ? btn('How to Play', { variant: 'wide', onclick: () => nav.go('howto') })
          : btn('▶ Start Tutorial', { variant: 'accent wide', onclick: () => nav.go('tutorial') }),
        h('div', { class: 'row center' }, [
          btn('Leaderboard', { class: 'grow', onclick: () => nav.go('leaderboard') }),
          btn('Locker', { class: 'grow', onclick: () => nav.go('locker') }),
          btn('Settings', { class: 'grow', onclick: () => nav.go('settings') }),
        ]),
      ]),
      h('div', { class: 'subtitle small', text: 'Last critter dry wins. Drop balloons, dodge splashes, chain the chaos.' }),
    );
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
