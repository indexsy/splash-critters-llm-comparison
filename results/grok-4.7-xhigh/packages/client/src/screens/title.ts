import { audio } from '../audio.js';
import { app, mount } from '../app.js';
import { drawAnimal, drawBalloon } from '../render/sprites.js';

export function showTitle(onDone: () => void) {
  audio.setMusic('title');
  const root = mount(`
    <div class="shell">
      <canvas class="title-art" id="art" width="256" height="120"></canvas>
      <div class="panel" style="margin-top:16px;text-align:center">
        <h1>SPLASH CRITTERS</h1>
        <p class="sub">Last critter dry wins. Drop water balloons. Wash the sandcastles. Don't get soaked.</p>
        <p class="who">${app.profile ? `${app.profile.nickname}#${app.profile.tag}` : 'connecting…'}</p>
        <div class="row" style="justify-content:center;margin-top:12px">
          <button class="btn" id="go">Press Enter</button>
        </div>
      </div>
    </div>`);
  const canvas = root.querySelector('#art') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  let frame = 0;
  let raf = 0;
  const loop = () => {
    frame++;
    ctx.fillStyle = '#102033';
    ctx.fillRect(0, 0, 256, 120);
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 ? '#1d6fbf' : '#2a86d4';
      ctx.fillRect(i * 16, 96, 16, 24);
    }
    drawAnimal(ctx, 'frog', 36, 70 + Math.sin(frame / 8) * 2, frame / 8, null, 2);
    drawAnimal(ctx, 'duck', 92, 68, frame / 8, 'bucket', 2);
    drawAnimal(ctx, 'otter', 150, 70, frame / 8, 'snorkel', 4);
    drawAnimal(ctx, 'capybara', 200, 66, frame / 8, 'crown', 4);
    drawBalloon(ctx, 70, 28 + Math.sin(frame / 10) * 3, 40, frame);
    drawBalloon(ctx, 170, 20, 10, frame);
    audio.tick();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  const go = () => {
    audio.ensure();
    onDone();
  };
  root.querySelector('#go')!.addEventListener('click', go);
  const key = (e: KeyboardEvent) => {
    if (e.code === 'Enter' || e.code === 'Space') go();
  };
  window.addEventListener('keydown', key);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', key);
  };
}
