import type { AnimalId, HatId } from '@splash/shared';
import { net } from '../net';
import { drawCritter } from '../render/sprites';
import { nav, type ScreenInstance } from '../router';
import { store } from '../store';
import { btn, clearNode, h, screenEl } from '../ui';

const ANIMALS: { id: AnimalId; name: string; lvl: number }[] = [
  { id: 'frog', name: 'Frog', lvl: 1 },
  { id: 'duck', name: 'Duck', lvl: 1 },
  { id: 'otter', name: 'Otter', lvl: 2 },
  { id: 'penguin', name: 'Penguin', lvl: 4 },
  { id: 'cat', name: 'Cat', lvl: 7 },
  { id: 'raccoon', name: 'Raccoon', lvl: 11 },
  { id: 'turtle', name: 'Turtle', lvl: 15 },
  { id: 'capybara', name: 'Capybara', lvl: 20 },
];
const HATS: { id: HatId; name: string; lvl: number }[] = [
  { id: 'none', name: 'None', lvl: 1 },
  { id: 'snorkel', name: 'Snorkel', lvl: 3 },
  { id: 'bucket', name: 'Bucket', lvl: 5 },
  { id: 'bandana', name: 'Bandana', lvl: 9 },
  { id: 'propeller', name: 'Propeller', lvl: 13 },
  { id: 'crown', name: 'Crown', lvl: 18 },
];

export function mount(root: HTMLElement): ScreenInstance {
  const el = screenEl();
  const preview = h('canvas', { width: '96', height: '96', style: 'image-rendering:pixelated;width:192px;height:192px;background:#0a1130;border:3px solid var(--line);border-radius:6px' }) as HTMLCanvasElement;
  const pctx = preview.getContext('2d')!;
  let sel: AnimalId = store.profile?.selectedAnimal ?? 'frog';
  let selHat: HatId = store.profile?.selectedHat ?? 'none';
  let facingI = 0;

  function unlocked(): string[] {
    return store.profile?.unlocks ?? ['frog', 'duck', 'none'];
  }

  function render(): void {
    clearNode(el);
    const un = unlocked();
    el.append(
      h('div', { class: 'row between' }, [
        h('div', { class: 'title', style: 'font-size:24px', text: 'Locker' }),
        btn('Back', { onclick: () => nav.go('menu') }),
      ]),
      h('div', { class: 'row', style: 'align-items:flex-start;gap:16px' }, [
        h('div', { class: 'col', style: 'align-items:center' }, [preview, h('div', { class: 'small muted', text: `Level ${store.profile?.level ?? 1}` })]),
        h('div', { class: 'col grow' }, [
          h('label', { text: 'Critter' }),
          grid(ANIMALS.map((a) => item(a.name, a.lvl, un.includes(a.id), sel === a.id, () => { sel = a.id; save(); }))),
          h('label', { text: 'Hat' }),
          grid(HATS.map((ht) => item(ht.name, ht.lvl, un.includes(ht.id), selHat === ht.id, () => { selHat = ht.id; save(); }))),
        ]),
      ]),
    );
  }

  function save(): void {
    net.send({ type: 'set_loadout', animal: sel, hat: selHat });
    render();
  }

  const dirs = ['down', 'right', 'up', 'left'] as const;
  const unsub = store.subscribe(() => {
    sel = store.profile?.selectedAnimal ?? sel;
    selHat = store.profile?.selectedHat ?? selHat;
    render();
  });
  render();
  root.append(el);

  return {
    unmount() {
      unsub();
      el.remove();
    },
    onFrame(_dt, now) {
      pctx.imageSmoothingEnabled = false;
      pctx.clearRect(0, 0, 96, 96);
      facingI = Math.floor(now / 900) % 4;
      const frame: 0 | 1 = Math.floor(now / 160) % 2 === 0 ? 0 : 1;
      drawCritter(pctx, {
        animal: sel,
        hat: selHat,
        cx: 48,
        cy: 52,
        size: 44,
        facing: dirs[facingI],
        frame,
        moving: true,
        ownerSlot: 1,
        colorblind: store.settings.colorblind,
      });
    },
  };
}

function grid(items: HTMLElement[]): HTMLElement {
  return h('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px' }, items);
}

function item(name: string, lvl: number, unlocked: boolean, selected: boolean, onclick: () => void): HTMLElement {
  return h('button', {
    class: `btn ${selected ? 'primary' : 'ghost'}`,
    disabled: !unlocked,
    onclick: unlocked ? onclick : undefined,
    style: 'flex-direction:column;padding:8px;gap:2px',
  }, [
    h('div', { text: name, style: 'font-size:12px' }),
    h('div', { class: 'small', style: 'opacity:.7', text: unlocked ? '' : `Lv.${lvl}` }),
  ]);
}
