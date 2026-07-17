import { AnimalId, CONFIG, HatId } from '@splash/shared';
import { net } from '../net.js';
import { animalSprite, drawSprite, hatSprite } from '../render/sprites.js';
import { el, showApp } from './common.js';

let animTimer: number | null = null;

export function renderLocker(root: HTMLElement, go: (screen: string) => void): void {
  showApp();
  if (animTimer !== null) {
    clearInterval(animTimer);
    animTimer = null;
  }
  const profile = net.profile;
  if (!profile) {
    root.append(el('div', { class: 'dim' }, ['Loading...']));
    return;
  }
  let animal = profile.selectedAnimal;
  let hat = profile.selectedHat;

  const title = el('h2', {}, ['LOCKER']);
  const preview = document.createElement('canvas');
  preview.width = 24;
  preview.height = 24;
  preview.className = 'preview-canvas';
  preview.style.cssText = 'width:120px;height:120px;image-rendering:pixelated;';

  const drawPreview = (frame: 0 | 1): void => {
    const ctx = preview.getContext('2d')!;
    ctx.clearRect(0, 0, 24, 24);
    ctx.save();
    ctx.scale(2, 2);
    const spr = animalSprite(animal, frame);
    const yOff = spr.rows.length - 12;
    drawSprite(ctx, spr.rows, spr.pal, 0, 1 - yOff);
    const h = hatSprite(hat);
    if (h) drawSprite(ctx, h.rows, h.pal, 0, 0);
    ctx.restore();
  };
  drawPreview(0);
  let frame: 0 | 1 = 0;
  animTimer = window.setInterval(() => {
    frame = frame === 0 ? 1 : 0;
    drawPreview(frame);
  }, 300);
  cleanup.push(() => {
    if (animTimer !== null) clearInterval(animTimer);
    animTimer = null;
  });

  const unlocks = new Set(profile.unlocks);

  const animalGrid = el('div', { class: 'row', style: 'flex-wrap:wrap;max-width:480px;' });
  for (const a of CONFIG.ANIMALS) {
    const unlocked = unlocks.has(`animal:${a}`);
    const lvl = CONFIG.ANIMAL_UNLOCK_LEVEL[a] ?? 0;
    const b = el('button', { class: `secondary${a === animal ? ' active' : ''}`, style: `font-size:10px;padding:6px 8px;${!unlocked ? 'opacity:.4;' : ''}` }, [
      unlocked ? a.toUpperCase() : `${a.toUpperCase()} (Lv${lvl})`,
    ]);
    if (unlocked) {
      b.onclick = () => {
        animal = a;
        drawPreview(0);
        selectRefresh();
      };
    }
    if (a === animal) b.style.border = '2px solid #73eff7';
    animalGrid.append(b);
  }

  const hatGrid = el('div', { class: 'row', style: 'flex-wrap:wrap;max-width:480px;' });
  for (const h of CONFIG.HATS) {
    const unlocked = unlocks.has(`hat:${h}`);
    const lvl = CONFIG.HAT_UNLOCK_LEVEL[h] ?? 0;
    const b = el('button', { class: 'secondary', style: `font-size:10px;padding:6px 8px;${!unlocked ? 'opacity:.4;' : ''}` }, [
      unlocked ? h.toUpperCase() : `${h.toUpperCase()} (Lv${lvl})`,
    ]);
    if (unlocked) {
      b.onclick = () => {
        hat = h;
        drawPreview(0);
        selectRefresh();
      };
    }
    if (h === hat) b.style.border = '2px solid #73eff7';
    hatGrid.append(b);
  }

  function selectRefresh(): void {
    root.innerHTML = '';
    renderLocker(root, go);
    net.send({ t: 'set_cosmetics', animal, hat });
  }

  const back = el('button', { class: 'secondary' }, ['BACK']);
  back.onclick = () => go('menu');
  root.append(
    title,
    el('div', { class: 'row' }, [preview, el('div', { class: 'col' }, [el('div', { class: 'small dim' }, ['Animals']), animalGrid, el('div', { class: 'small dim' }, ['Hats']), hatGrid])]),
    back,
  );
}

export const cleanup: (() => void)[] = [];
