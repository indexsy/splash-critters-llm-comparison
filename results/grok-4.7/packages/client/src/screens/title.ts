import { animalSprite, balloonSprite } from '../render/sprites.js';
import type { App } from '../app.js';

export function mountTitle(root: HTMLElement, app: App): () => void {
  root.innerHTML = `<div class="shell"><div class="stage"><canvas class="play" width="256" height="224"></canvas></div><p class="muted" style="text-align:center">Click or press any key</p></div>`;
  const canvas = root.querySelector('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const scale = Math.max(2, Math.min(4, Math.floor((window.innerWidth - 40) / 256)));
  canvas.style.width = `${256 * scale}px`;
  canvas.style.height = `${224 * scale}px`;
  let raf = 0;
  const animals = ['frog', 'duck', 'otter', 'cat'];
  const draw = (now: number) => {
    ctx.fillStyle = '#16324a';
    ctx.fillRect(0, 0, 256, 224);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#1d4e78' : '#1a456c';
      ctx.fillRect(i * 32, 150, 32, 74);
    }
    animals.forEach((a, i) => {
      const x = 30 + i * 52 + Math.sin(now / 300 + i) * 4;
      const y = 120 + Math.abs(Math.sin(now / 180 + i)) * -6;
      ctx.drawImage(animalSprite(a, Math.floor(now / 160 + i) % 2, i === 3 ? 'crown' : 'none'), x, y, 32, 32);
    });
    ctx.drawImage(balloonSprite(Math.floor(now / 100) % 2), 112, 70 + Math.sin(now / 200) * 4, 24, 24);
    ctx.fillStyle = '#ffcd75';
    ctx.font = '16px monospace';
    ctx.fillText('SPLASH', 78, 48);
    ctx.fillText('CRITTERS', 62, 66);
    ctx.fillStyle = '#f4f4f4';
    ctx.font = '8px monospace';
    ctx.fillText(app.profile ? 'LAST CRITTER DRY WINS' : 'CONNECTING...', 62, 200);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  const go = () => {
    app.audio.unlock();
    app.audio.play('ui');
    if (!app.profile) return;
    if (!app.profile.tutorialDone) app.goto('tutorial');
    else app.goto('menu');
  };
  window.addEventListener('keydown', go);
  canvas.addEventListener('click', go);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', go);
    canvas.removeEventListener('click', go);
  };
}
