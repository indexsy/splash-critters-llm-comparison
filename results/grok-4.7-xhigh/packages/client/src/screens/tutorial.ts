import {
  CONFIG,
  Dir,
  Tile,
  blankState,
  botAct,
  createBotMemory,
  createGameState,
  makePlayer,
  simulateTick,
  type GameState,
} from '@splash/shared';
import { app, mount, qs } from '../app.js';
import { audio } from '../audio.js';
import { net } from '../net.js';
import { drawAnimal, drawBalloon, drawPowerup, drawSplash, drawTile } from '../render/sprites.js';

const STEPS = [
  'Move with WASD. Waddle off your starting tile.',
  'Drop a balloon (Space) beside a sandcastle, then step away before it bursts.',
  'Walk over the power-up the castle reveals.',
  'Place two balloons so one splash chains the other. You have an extra balloon now.',
  'Soak the easy bot. Last critter dry wins the lesson.',
];

export function showTutorial(nav: { done: () => void }) {
  audio.setMusic('game');
  const state = buildTutorial();
  const mem = createBotMemory(7);
  let step = 0;
  let moved = false;
  let washed = false;
  let grabbed = false;
  let chained = false;
  const root = mount(`
    <div class="shell">
      <div class="stage"><canvas class="view" id="view" width="176" height="144"></canvas></div>
      <div class="panel" style="margin-top:12px;max-width:640px">
        <h2>Tutorial</h2>
        <p class="sub" id="hint"></p>
        <div class="row"><button class="btn-ghost" id="skip">Skip</button></div>
      </div>
    </div>`);
  const canvas = qs<HTMLCanvasElement>('#view');
  const ctx = canvas.getContext('2d')!;
  const scale = Math.max(2, Math.min(4, Math.floor((window.innerWidth - 40) / canvas.width)));
  canvas.style.width = `${canvas.width * scale}px`;
  canvas.style.height = `${canvas.height * scale}px`;
  const keys = new Set<string>();
  let balloonEdge = false;
  let acc = 0;
  let last = performance.now();
  let seq = 0;
  let raf = 0;
  let finished = false;

  function finish(skipped: boolean) {
    if (finished) return;
    finished = true;
    net.send({ t: 'tutorial_complete', skipped });
    localStorage.setItem('splash_tutorial', '1');
    nav.done();
  }

  const down = (e: KeyboardEvent) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyE') { balloonEdge = true; e.preventDefault(); }
  };
  const up = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  qs('#skip').onclick = () => finish(true);

  const loop = (t: number) => {
    const dt = Math.min(40, t - last);
    last = t;
    acc += dt;
    while (acc >= 1000 / 30 && !state.over) {
      acc -= 1000 / 30;
      let dir: Dir = Dir.None;
      if (keys.has('KeyW') || keys.has('ArrowUp')) dir = Dir.Up;
      else if (keys.has('KeyS') || keys.has('ArrowDown')) dir = Dir.Down;
      else if (keys.has('KeyA') || keys.has('ArrowLeft')) dir = Dir.Left;
      else if (keys.has('KeyD') || keys.has('ArrowRight')) dir = Dir.Right;
      seq++;
      const bot = botAct(state, 'tutor-bot', mem);
      bot.seq = seq;
      simulateTick(state, {
        you: { seq, tick: state.tick, dir, balloon: balloonEdge },
        'tutor-bot': bot,
      });
      balloonEdge = false;
      if (Math.abs(state.players[0].x - 1.5) > 0.4 || Math.abs(state.players[0].y - 1.5) > 0.4) moved = true;
      for (const ev of state.events) {
        if (ev.type === 'castle_washed' && ev.by === 'you') washed = true;
        if (ev.type === 'powerup_collected' && ev.playerId === 'you') grabbed = true;
        if (ev.type === 'chain_burst' && ev.by === 'you') chained = true;
        if (ev.type === 'player_soaked' && ev.playerId === 'tutor-bot' && ev.by === 'you') {
          step = 5;
        }
      }
    }
    if (step === 0 && moved) step = 1;
    else if (step === 1 && washed) step = 2;
    else if (step === 2 && grabbed) step = 3;
    else if (step === 3 && chained) step = 4;
    else if (step === 4 && !state.players[1].alive && state.players[1].soakedBy === 'you') step = 5;
    if (step >= 5) {
      qs('#hint').textContent = 'Lesson complete. You stayed drier than the bot.';
      setTimeout(() => finish(false), 700);
    } else qs('#hint').textContent = STEPS[step];

    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) drawTile(ctx, 'backyard', state.tiles[y * state.width + x], x, y, state.tick);
    }
    for (const u of state.powerups) drawPowerup(ctx, u.kind, u.x * 16, u.y * 16, state.tick);
    for (const b of state.balloons) drawBalloon(ctx, b.x * 16, b.y * 16, b.fuse, state.tick, b.sliding);
    for (const s of state.splashes) drawSplash(ctx, s.x * 16, s.y * 16, s.ttl, app.settings.colorblind);
    for (const p of state.players) {
      if (!p.alive) continue;
      drawAnimal(ctx, p.animal, p.x * 16 - 8, p.y * 16 - 10, Math.floor(state.tick / 6), p.hat, p.facing);
    }
    audio.tick();
    if (!finished) raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };
}

function buildTutorial(): GameState {
  const w = 11;
  const h = 9;
  const state = blankState(w, h);
  state.theme = 'backyard';
  state.revenge = false;
  state.warmup = 30;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1 && x % 2 === 0 && y % 2 === 0) state.tiles[y * w + x] = Tile.Boulder;
    }
  }
  const clear = (x: number, y: number) => { state.tiles[y * w + x] = Tile.Empty; };
  clear(1, 1); clear(2, 1); clear(3, 1); clear(1, 2); clear(1, 3);
  clear(9, 7); clear(8, 7); clear(7, 7); clear(9, 6); clear(9, 5);
  state.tiles[1 * w + 4] = Tile.Sandcastle;
  state.hidden[1 * w + 4] = 'extra_balloon';
  state.tiles[3 * w + 3] = Tile.Sandcastle;
  state.tiles[3 * w + 5] = Tile.Sandcastle;
  state.tiles[5 * w + 5] = Tile.Sandcastle;
  state.players = [
    makePlayer({ id: 'you', name: 'You', x: 1.5, y: 1.5, slot: 0, animal: 'frog', balloonCount: 1, speed: CONFIG.SPEED_BASE }),
    makePlayer({ id: 'tutor-bot', name: 'Puddle Pal', x: 9.5, y: 7.5, slot: 1, animal: 'duck', isBot: true, difficulty: 'easy', facing: Dir.Left }),
  ];
  return state;
}

export function showDebug(nav: { back: () => void }) {
  audio.setMusic('game');
  const state = createGameState({
    mode: 'duel',
    seed: 42,
    theme: 'backyard',
    revenge: false,
    roundsToWin: 1,
    players: [
      { id: 'you', name: 'You', slot: 0, animal: 'frog', hat: null, isBot: false },
      { id: 'bot', name: 'Hard Pal', slot: 1, animal: 'otter', hat: null, isBot: true, difficulty: 'hard' },
    ],
  });
  state.warmup = 45;
  const mem = createBotMemory(99);
  const root = mount(`
    <div class="shell">
      <div class="stage"><canvas class="view" id="view" width="${state.width * 16}" height="${state.height * 16}"></canvas></div>
      <p class="sub" id="hint">Local debug: you vs a Hard bot. WASD, Space to drop.</p>
      <button class="btn-ghost" id="back">Back</button>
    </div>`);
  const canvas = qs<HTMLCanvasElement>('#view');
  const ctx = canvas.getContext('2d')!;
  const scale = Math.max(1, Math.min(3, Math.floor((window.innerWidth - 80) / canvas.width)));
  canvas.style.width = `${canvas.width * scale}px`;
  canvas.style.height = `${canvas.height * scale}px`;
  const keys = new Set<string>();
  let balloonEdge = false;
  let acc = 0;
  let last = performance.now();
  let seq = 0;
  let raf = 0;
  const down = (e: KeyboardEvent) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyE') { balloonEdge = true; e.preventDefault(); }
  };
  const up = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  qs('#back').onclick = nav.back;
  const loop = (t: number) => {
    acc += Math.min(40, t - last);
    last = t;
    while (acc >= 1000 / 30 && !state.over) {
      acc -= 1000 / 30;
      let dir: Dir = Dir.None;
      if (keys.has('KeyW') || keys.has('ArrowUp')) dir = Dir.Up;
      else if (keys.has('KeyS') || keys.has('ArrowDown')) dir = Dir.Down;
      else if (keys.has('KeyA') || keys.has('ArrowLeft')) dir = Dir.Left;
      else if (keys.has('KeyD') || keys.has('ArrowRight')) dir = Dir.Right;
      seq++;
      const bot = botAct(state, 'bot', mem);
      bot.seq = seq;
      simulateTick(state, { you: { seq, tick: state.tick, dir, balloon: balloonEdge }, bot });
      balloonEdge = false;
    }
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) drawTile(ctx, 'backyard', state.tiles[y * state.width + x], x, y, state.tick);
    }
    for (const u of state.powerups) drawPowerup(ctx, u.kind, u.x * 16, u.y * 16, state.tick);
    for (const b of state.balloons) drawBalloon(ctx, b.x * 16, b.y * 16, b.fuse, state.tick, b.sliding);
    for (const s of state.splashes) drawSplash(ctx, s.x * 16, s.y * 16, s.ttl, app.settings.colorblind);
    for (const p of state.players) {
      if (!p.alive) continue;
      drawAnimal(ctx, p.animal, p.x * 16 - 8, p.y * 16 - 10, Math.floor(state.tick / 6), p.hat, p.facing);
    }
    qs('#hint').textContent = state.over
      ? (state.winnerId === 'you' ? 'You stayed dry.' : state.draw ? 'Draw.' : 'Soaked.')
      : 'Local debug: you vs a Hard bot. WASD, Space to drop.';
    audio.tick();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };
}
