// Locker: pick an animal and a hat. A live 8-bit preview walks through every facing; locked
// items are greyed with their unlock level. Hovering or focusing a tile tries it on (preview and
// caption together, locked ones included); looking away shows the saved look again. Picking sends
// set_cosmetics right away (optimistic; the server's profile reply is the truth and a refusal
// snaps the choice back).
import { ANIMALS, Dir, HATS, type AnimalId, type CosmeticDef, type HatId, type Profile } from '@splash/shared';
import { navigate } from '../app';
import { audio } from '../audio';
import { net } from '../net';
import { getAnimalFrame, getCritter } from '../render/sprites';
import { settings } from '../settings';
import { store } from '../store';
import { h, spinner, toast } from '../ui';
import type { Screen } from './index';
import { focusInitial, installArrowNav } from './parts/arrowNav';
import { runMenuBackdrop } from './parts/backdrop';
import { cosmeticGrid, type CosmeticInspection } from './parts/cosmeticGrid';
import { critterPreview } from './parts/critterPreview';
import { nextUnlock } from './parts/progress';
import { Scope } from './parts/scope';
import { chip, progressBar, screenShell } from './parts/shell';
import './parts/styles/locker.css';

let scope: Scope | null = null;

function owns(profile: Profile, def: CosmeticDef<string>): boolean {
  return profile.unlocks.includes(def.id) || def.unlockLevel <= profile.level;
}

function levelPanel(profile: Profile): HTMLElement {
  const next = nextUnlock(profile.level);
  return h(
    'div',
    { class: 'locker-level' },
    h('div', { class: 'row' }, chip(`Lv ${profile.level}`, 'sand'), progressBar(profile.xpIntoLevel / Math.max(1, profile.xpForNext), 'xp', 'Experience').el),
    h('span', { class: 'locker-next' }, next ? `Next: ${next.name} at Lv ${next.level}` : 'Everything unlocked!'),
  );
}

function buildLocker(s: Scope, profile: Profile): HTMLElement {
  let animal: AnimalId = profile.animal;
  let hat: HatId = profile.hat;
  const cb = () => settings.get().colorblind;
  const preview = critterPreview(s, animal, hat);
  const title = h('div', { class: 'locker-name' });
  const blurb = h('p', { class: 'locker-blurb' });
  const describe = (name: string, text: string) => {
    title.textContent = name;
    blurb.textContent = text;
  };
  const describeCurrent = () => {
    const a = ANIMALS.find((d) => d.id === animal);
    const hd = HATS.find((d) => d.id === hat);
    describe(hat === 'none' ? (a?.name ?? animal) : `${a?.name ?? animal} + ${hd?.name ?? hat}`, a?.blurb ?? '');
  };
  const describeTile = (look: CosmeticInspection<string>) =>
    describe(look.def.name, look.locked ? `Unlocks at level ${look.def.unlockLevel}.` : look.def.blurb);
  /** Preview and caption always show the same thing: the tile being looked at, else the saved look. */
  const showLook = () => {
    const a = animals.inspected();
    const hd = hats.inspected();
    if (a && (a.hovered || !hd?.hovered)) {
      preview.show(a.def.id, hat);
      describeTile(a);
    } else if (hd) {
      preview.show(animal, hd.def.id);
      describeTile(hd);
    } else {
      preview.show(animal, hat);
      describeCurrent();
    }
  };

  const paint = () => {
    animals.render(animal);
    hats.render(hat);
    showLook();
  };
  const commit = () => {
    paint();
    if (!net.send({ type: 'set_cosmetics', animal, hat })) toast('Not connected. Your pick was not saved.', 'error');
  };
  /** Adopt the server's truth: a new profile, or the saved look after a refused (locked) pick. */
  const adopt = (p: Profile) => {
    animal = p.animal;
    hat = p.hat;
    paint();
  };
  const current = () => store.get().profile ?? profile;
  const animals = cosmeticGrid<AnimalId>({
    label: 'Critters',
    defs: ANIMALS,
    isOwned: (d) => owns(current(), d),
    selected: animal,
    sprite: (id) => getAnimalFrame(id, Dir.Down, 0, 0, cb()),
    className: 'cos-animals',
    onPick: (id) => {
      animal = id;
      commit();
    },
    onInspect: () => showLook(),
  });
  const hats = cosmeticGrid<HatId>({
    label: 'Hats',
    defs: HATS,
    isOwned: (d) => owns(current(), d),
    selected: hat,
    sprite: (id) => getCritter(animal, id, Dir.Down, 0, 0, cb()),
    className: 'cos-hats',
    onPick: (id) => {
      hat = id;
      commit();
    },
    onInspect: () => showLook(),
  });
  showLook();
  animals.el.querySelector<HTMLElement>('.cos-tile.is-selected')?.setAttribute('data-autofocus', '');

  const level = h('div', { class: 'locker-level-wrap' }, levelPanel(profile));
  s.add(
    store.subscribe((next, prev) => {
      if (next.profile && next.profile !== prev.profile) {
        adopt(next.profile);
        level.replaceChildren(levelPanel(next.profile));
      } else if (next.lastError !== prev.lastError && next.lastError?.code === 'locked_item') {
        adopt(next.profile ?? profile);
      }
    }),
  );

  return h(
    'div',
    { class: 'locker-body' },
    h('div', { class: 'locker-left' }, h('div', { class: 'locker-stage' }, preview.el), title, blurb, level),
    h('div', { class: 'locker-right' }, animals.el, hats.el),
  );
}

export const screen: Screen = {
  mount(root) {
    const s = new Scope();
    scope = s;
    audio.music('menu');
    runMenuBackdrop(s);
    const body = h('div', { class: 'locker-wrap' });
    root.append(screenShell({ title: 'Locker', onBack: () => navigate('/menu') }, body));
    s.add(installArrowNav(root));
    const mountBody = (profile: Profile) => {
      body.replaceChildren(buildLocker(s, profile));
      focusInitial(root);
    };
    const profile = store.get().profile;
    if (profile) {
      mountBody(profile);
      return;
    }
    body.append(h('div', { class: 'locker-wait' }, spinner('Connecting')));
    const unsub = store.subscribe((next) => {
      if (!next.profile) return;
      unsub();
      mountBody(next.profile);
    });
    s.add(unsub);
    focusInitial(root);
  },

  unmount() {
    scope?.dispose();
    scope = null;
  },
};
