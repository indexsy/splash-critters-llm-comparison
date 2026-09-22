import { COSMETICS } from '@splash/shared';
import type { App } from '../app.js';
import { animalSprite } from '../render/sprites.js';

export function mountLocker(root: HTMLElement, app: App): () => void {
  const profile = app.profile;
  if (!profile) return () => {};
  let animal = profile.animal;
  let hat = profile.hat;
  root.innerHTML = `
    <div class="shell">
      <div class="topbar"><h1>Locker</h1><button id="back">Back</button></div>
      <div class="row">
        <canvas class="preview" width="64" height="64"></canvas>
        <div><strong id="label"></strong><p class="muted" id="blurb"></p><p>Level ${profile.level}</p></div>
      </div>
      <h2>Animals</h2><div class="locker-grid" id="animals"></div>
      <h2>Hats</h2><div class="locker-grid" id="hats"></div>
    </div>`;
  const canvas = root.querySelector('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const paint = () => {
    const a = COSMETICS.find((c) => c.id === animal);
    const h = COSMETICS.find((c) => c.id === hat);
    (root.querySelector('#label') as HTMLElement).textContent = `${a?.name ?? animal} · ${h?.name ?? hat}`;
    (root.querySelector('#blurb') as HTMLElement).textContent = a?.blurb ?? '';
    root.querySelector('#animals')!.innerHTML = COSMETICS.filter((c) => c.type === 'animal')
      .map((c) => {
        const owned = profile.unlocks.includes(c.id);
        return `<button class="pick ${c.id === animal ? 'on' : ''}" data-a="${c.id}" ${owned ? '' : 'disabled'}>${c.name}${owned ? '' : ` · Lv ${c.level}`}</button>`;
      })
      .join('');
    root.querySelector('#hats')!.innerHTML = COSMETICS.filter((c) => c.type === 'hat')
      .map((c) => {
        const owned = profile.unlocks.includes(c.id);
        return `<button class="pick ${c.id === hat ? 'on' : ''}" data-h="${c.id}" ${owned ? '' : 'disabled'}>${c.name}${owned ? '' : ` · Lv ${c.level}`}</button>`;
      })
      .join('');
    root.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => {
      b.onclick = () => {
        animal = b.dataset.a!;
        app.net.send({ t: 'select_cosmetic', animal });
        paint();
      };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-h]').forEach((b) => {
      b.onclick = () => {
        hat = b.dataset.h!;
        app.net.send({ t: 'select_cosmetic', hat });
        paint();
      };
    });
  };
  let raf = 0;
  const draw = (now: number) => {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#16324a';
    ctx.fillRect(0, 0, 64, 64);
    ctx.drawImage(animalSprite(animal, Math.floor(now / 180) % 2, hat), 8, 12, 48, 48);
    raf = requestAnimationFrame(draw);
  };
  paint();
  raf = requestAnimationFrame(draw);
  root.querySelector('#back')!.addEventListener('click', () => app.goto('menu'));
  return () => cancelAnimationFrame(raf);
}
