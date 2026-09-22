import { ANIMALS, HATS, type AnimalId, type HatId } from '@splash/shared';
import { app, mount, qs } from '../app.js';
import { net } from '../net.js';
import { drawAnimal } from '../render/sprites.js';

export function showLocker(nav: { back: () => void }) {
  const root = mount(`
    <div class="shell"><div class="panel">
      <div class="row" style="justify-content:space-between"><h2>Locker</h2><button class="btn-ghost" id="back">Back</button></div>
      <div class="menu-grid">
        <canvas class="locker-preview" id="prev" width="96" height="96"></canvas>
        <div>
          <h3>Critters</h3><div class="row" id="animals"></div>
          <h3 style="margin-top:12px">Hats</h3><div class="row" id="hats"></div>
        </div>
      </div>
    </div></div>`);
  const canvas = qs<HTMLCanvasElement>('#prev');
  const ctx = canvas.getContext('2d')!;
  let animal: AnimalId = app.profile?.animal ?? 'frog';
  let hat: HatId | null = app.profile?.hat ?? null;
  let frame = 0;
  const unlocked = new Set(app.profile?.unlocks ?? []);
  const paint = () => {
    qs('#animals').innerHTML = ANIMALS.map((a) => {
      const ok = unlocked.has(`animal:${a.id}`) || a.level <= 1;
      return `<button class="btn small ${ok ? '' : 'locked'}" data-a="${a.id}" ${ok ? '' : 'disabled'}>${a.name}${ok ? '' : ` lv${a.level}`}</button>`;
    }).join('');
    qs('#hats').innerHTML = `<button class="btn small" data-h="">None</button>` + HATS.map((h) => {
      const ok = unlocked.has(`hat:${h.id}`);
      return `<button class="btn small ${ok ? '' : 'locked'}" data-h="${h.id}" ${ok ? '' : 'disabled'}>${h.name}${ok ? '' : ` lv${h.level}`}</button>`;
    }).join('');
    qs('#animals').querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
      animal = (b as HTMLElement).dataset.a as AnimalId;
      net.send({ t: 'set_cosmetic', animal });
    }));
    qs('#hats').querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => {
      const v = (b as HTMLElement).dataset.h;
      hat = v ? v as HatId : null;
      net.send({ t: 'set_cosmetic', hat });
    }));
  };
  paint();
  let raf = 0;
  const loop = () => {
    frame++;
    ctx.fillStyle = '#0d1b2c';
    ctx.fillRect(0, 0, 96, 96);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.scale(4, 4);
    drawAnimal(ctx, animal, 4, 4, Math.floor(frame / 10), hat, frame % 80 < 40 ? 2 : 4);
    ctx.restore();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  qs('#back').onclick = nav.back;
  const off = net.on((msg) => { if (msg.t === 'profile') { animal = msg.profile.animal; hat = msg.profile.hat; } });
  return () => { cancelAnimationFrame(raf); off(); };
}
