import { startMusic, sfx } from '../audio.js';
import { app } from '../state.js';

export function renderTitle(root: HTMLElement, nav: (h: string) => void): () => void {
  startMusic('title');
  root.innerHTML = '';
  const d = document.createElement('div');
  d.innerHTML = `
    <h1 class="logo">💧 SPLASH CRITTERS 💧</h1>
    <div class="sub">8-bit water-balloon arena battler · last critter dry wins</div>
    <div class="card" style="text-align:center">
      <canvas id="titlePx" width="256" height="64" class="pixel" style="width:256px"></canvas>
      <div data-profile class="small">connecting…</div>
      <div class="row" style="justify-content:center;margin-top:8px">
        <button id="bPlay">▶ PLAY</button>
        <button id="bHow" class="secondary">How to Play</button>
      </div>
      <div class="small">WASD/arrows move · Space balloon · M mute · desktop web v1</div>
    </div>`;
  root.appendChild(d);
  // pixel critters banner
  const cv = d.querySelector('#titlePx') as HTMLCanvasElement;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0e1430';
  g.fillRect(0, 0, 256, 64);
  const cols = ['#3fd65f', '#ffd23f', '#f4a259', '#2a9d8f'];
  let t = 0;
  const iv = window.setInterval(() => {
    t++;
    g.fillStyle = '#0e1430';
    g.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 4; i++) {
      const x = 32 + i * 64;
      const y = 36 + (t % 2 === 0 ? 0 : -3);
      g.fillStyle = cols[i];
      g.fillRect(x - 10, y - 10, 20, 14);
      g.fillStyle = '#fff';
      g.fillRect(x - 6, y - 7, 4, 4);
      g.fillRect(x + 2, y - 7, 4, 4);
      g.fillStyle = '#000';
      g.fillRect(x - 5, y - 6, 2, 2);
      g.fillRect(x + 3, y - 6, 2, 2);
    }
  }, 300);
  const prof = app.profile;
  const pb = d.querySelector('[data-profile]');
  if (pb && prof) pb.textContent = `${prof.nickname}#${prof.tag} · Lv${prof.level}`;
  (d.querySelector('#bPlay') as HTMLButtonElement).onclick = () => {
    sfx.click();
    const done = localStorage.getItem('sc_tutorial') === '1';
    nav(done ? '#/menu' : '#/tutorial');
  };
  (d.querySelector('#bHow') as HTMLButtonElement).onclick = () => {
    sfx.click();
    nav('#/menu');
  };
  return () => clearInterval(iv);
}
