import { CONFIG, Dir, GameEvent, GameState, InputFrame, TILE_FLOOR, createGame, simulateTick } from '@splash/shared';
import { audio } from '../audio.js';
import { net } from '../net.js';
import { ParticleSystem } from '../render/particles.js';
import { SPLASH_COLORS, THEMES } from '../render/sprites.js';
import { drawWorld, setPlayerMetaProvider, worldOrigin, TILE } from '../render/world.js';
import { settings } from '../settings.js';
import { el, fitGameCanvas, showApp, showGame } from './common.js';

const STEPS = [
  'Move with WASD or arrow keys',
  'Drop a balloon (SPACE) next to a sandcastle — then get clear!',
  'Grab the power-up that was hiding inside',
  'CHAIN REACTION: drop two balloons so one splash catches the other',
  'Soak the training bot!',
] as const;

export function renderTutorial(root: HTMLElement, go: (screen: string) => void): () => void {
  const state = createGame({ mode: 'duel', mapSeed: 7, playerCount: 2, roundsToWin: 3, enableRevengeDucks: false });
  const particles = new ParticleSystem();
  const profileAnimal = net.profile?.selectedAnimal ?? 'frog';
  const profileHat = net.profile?.selectedHat ?? 'none';
  setPlayerMetaProvider((slot) => (slot === 0 ? { animal: profileAnimal, hat: profileHat } : { animal: 'otter', hat: 'none' }));

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  showGame();
  fitGameCanvas();
  audio.playMusic('game');

  const hud = document.getElementById('hud')!;
  hud.innerHTML = '';
  const stepBox = el('div', {
    style:
      'position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(20,23,42,.9);border:2px solid #41a6f6;padding:8px 16px;font-size:13px;text-align:center;',
  });
  const skip = el('button', { class: 'secondary', style: 'position:absolute;top:8px;right:8px;padding:4px 10px;font-size:10px;pointer-events:auto;' }, ['SKIP →']);
  hud.append(stepBox, skip);

  let step = 0;
  let finished = false;
  const cleanupFns: (() => void)[] = [];
  const setStep = (n: number): void => {
    step = n;
    if (n < STEPS.length) {
      stepBox.innerHTML = '';
      stepBox.append(
        el('div', { class: 'small dim' }, [`STEP ${n + 1}/${STEPS.length}`]),
        el('div', {}, [STEPS[n] ?? '']),
      );
    }
    if (n === 2) {
      const me = state.players[0]!;
      const tx = Math.min(state.w - 2, Math.floor(me.x) + 2);
      const ty = Math.floor(me.y);
      if (state.tiles[ty * state.w + tx] === TILE_FLOOR && state.exposedPowerUps.length === 0) {
        state.exposedPowerUps.push({ id: 999, tx, ty, kind: 'balloon', revealedTick: state.tick, revealGroup: -1 });
      }
    }
    if (n === 4) {
      const me = state.players[0]!;
      const bot = state.players[1]!;
      for (let d = 3; d <= 6; d++) {
        const tx = Math.floor(me.x) + d;
        const ty = Math.floor(me.y);
        if (tx < state.w - 1 && state.tiles[ty * state.w + tx] === TILE_FLOOR) {
          bot.x = tx + 0.5;
          bot.y = ty + 0.5;
          break;
        }
      }
    }
  };
  setStep(0);

  skip.onclick = () => {
    finish(false);
  };

  const finish = (completed: boolean): void => {
    if (finished) return;
    finished = true;
    if (completed) {
      net.send({ t: 'tutorial_complete' });
      audio.fanfare();
    }
    cleanup();
    showApp();
    root.innerHTML = '';
    if (completed) {
      root.append(
        el('h2', {}, ['TUTORIAL COMPLETE!']),
        el('div', { class: 'good' }, ['+50 XP']),
        el('div', { class: 'dim' }, ['You are ready for the arena.']),
      );
      const b = el('button', {}, ['MAIN MENU']);
      b.onclick = () => go('menu');
      root.append(b);
    } else {
      go('menu');
    }
  };

  const keys = new Set<string>();
  let balloonHeld = false;
  const kd = (e: KeyboardEvent): void => {
    keys.add(e.key);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  };
  const ku = (e: KeyboardEvent): void => {
    keys.delete(e.key);
  };
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);

  let moveTicks = 0;
  let seq = 0;
  let dummyDir: Dir = 0;
  let dummyTimer = 0;

  const simTimer = window.setInterval(() => {
    if (finished) return;
    const kb = settings.keys;
    let dir: Dir = 0;
    if (keys.has(kb.up) || keys.has('w') || keys.has('W')) dir = 1;
    else if (keys.has(kb.right) || keys.has('d') || keys.has('D')) dir = 2;
    else if (keys.has(kb.down) || keys.has('s') || keys.has('S')) dir = 3;
    else if (keys.has(kb.left) || keys.has('a') || keys.has('A')) dir = 4;
    if (dir !== 0) moveTicks++;
    const balloonNow = keys.has(kb.balloon) || keys.has('e') || keys.has('E');
    const balloon = balloonNow && !balloonHeld;
    balloonHeld = balloonNow;

    dummyTimer++;
    if (dummyTimer > 25) {
      dummyTimer = 0;
      if (step >= 4) {
        const me = state.players[0]!;
        const bot = state.players[1]!;
        const dx = me.x - bot.x;
        const dy = me.y - bot.y;
        dummyDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 4) : dy > 0 ? 3 : 1;
      } else {
        dummyDir = (Math.floor(Math.random() * 5)) as Dir;
      }
    }

    const inputs = new Map<number, InputFrame>();
    inputs.set(0, { seq: ++seq, dir, balloon });
    inputs.set(1, { seq: 0, dir: dummyDir, balloon: false });
    simulateTick(state, inputs);
    for (const e of state.events) handleEvent(e);
  }, 1000 / CONFIG.TICK_RATE);

  function handleEvent(e: GameEvent): void {
    const splashColors = settings.colorblind ? SPLASH_COLORS.colorblind : SPLASH_COLORS.normal;
    switch (e.type) {
      case 'balloon_dropped':
        if (e.slot === 0) audio.drop();
        break;
      case 'balloon_burst': {
        const { ox, oy } = worldOrigin(state.w, state.h);
        particles.burst(ox + (e.tx + 0.5) * TILE, oy + (e.ty + 0.5) * TILE, splashColors, 14, 2);
        audio.burst();
        break;
      }
      case 'castle_washed':
        if (step === 1) setStep(2);
        break;
      case 'powerup_collected':
        audio.pickup();
        if (step === 2 && e.slot === 0) setStep(3);
        break;
      case 'chain_burst':
        audio.chainJingle(e.depth);
        if (step === 3) setStep(4);
        break;
      case 'player_soaked':
        audio.soak();
        if (e.slot === 1) finish(true);
        else if (e.slot === 0) {
          const me = state.players[0]!;
          me.alive = true;
          stepBox.innerHTML = '';
          stepBox.append(el('div', { class: 'warn' }, ['Careful! Splashes soak you too. Keep going!']));
        }
        break;
      default:
        break;
    }
  }

  let frameTick = 0;
  let raf = 0;
  const loop = (): void => {
    frameTick++;
    particles.update();
    ctx.clearRect(0, 0, 256, 224);
    drawWorld(
      ctx,
      state,
      {
        theme: 'backyard',
        colorblind: settings.colorblind,
        reducedShake: settings.reducedShake,
        shakeTicks: 0,
        hitStopTicks: 0,
        interp: () => null,
        estTick: () => state.tick,
        frameTick,
      },
      particles,
    );
    if (state.phase === 'countdown') {
      const n = Math.ceil((state.countdownUntilTick - state.tick) / CONFIG.TICK_RATE);
      ctx.fillStyle = '#f4f4f4';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(n > 0 ? String(n) : 'GO!', 128, 118);
      ctx.textAlign = 'left';
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  if (step === 0) {
    const check = window.setInterval(() => {
      if (moveTicks > 25) {
        clearInterval(check);
        if (step === 0) setStep(1);
      }
    }, 200);
    cleanupFns.push(() => clearInterval(check));
  }

  const cleanup = (): void => {
    window.clearInterval(simTimer);
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', kd);
    window.removeEventListener('keyup', ku);
    cleanupFns.forEach((f) => f());
    hud.innerHTML = '';
  };
  return cleanup;
}
