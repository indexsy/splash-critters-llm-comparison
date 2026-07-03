import type { Screen } from './types.js';
import { audioEngine } from '../main.js';
import { PALETTE } from '../render/sprites.js';
import { SpriteRenderer } from '../render/sprites.js';
import { ParticleSystem } from '../render/particles.js';
import { HUD } from '../render/hud.js';
import {
  simulateTick,
  getInitialPlayerState,
} from '@shared/sim.js';
import { CONFIG } from '@shared/config.js';
import type { InputFrame, Direction } from '@shared/types.js';
import type { RoundState } from '@shared/sim.js';
import { currentInput } from '../main.js';

const TUTORIAL_STEPS = [
  'Move with WASD or Arrow Keys!',
  'Press SPACE to drop a balloon!',
  'Dodge the blast!',
  'Grab the power-up!',
  'Chain two balloons!',
  'Soak the bot!',
];

let step = 0;
let state: RoundState | null = null;
let sprites: SpriteRenderer | null = null;
let particles: ParticleSystem | null = null;
let hud: HUD | null = null;
let completed = false;
let xpAwarded = false;
let tick = 0;

function createTutorialState(): RoundState {
  const grid = Array.from({ length: 7 }, (_, y) =>
    Array.from({ length: 7 }, (_, x) => {
      if (x === 0 || x === 6 || y === 0 || y === 6) return 'boulder';
      if (x === 2 && y === 2) return 'boulder';
      if (x === 4 && y === 4) return 'boulder';
      if (x === 2 && y === 4) return 'sandcastle';
      if (x === 4 && y === 2) return 'sandcastle';
      if (x === 3 && y === 3) return 'powerup';
      return 'empty';
    })
  );

  const players = [
    getInitialPlayerState('player1', 'You', 'frog', { x: 1, y: 1 }),
    getInitialPlayerState('bot1', 'Bot', 'duck', { x: 5, y: 5 }),
  ];

  const config = { mode: 'duel' as const, roundsToWin: 1, mapTheme: 'backyard' as const, enableKick: true, enableRevengeDucks: false, botFill: false };

  return {
    tick: 0,
    map: {
      width: 7,
      height: 7,
      grid,
      theme: 'backyard',
      spawnPoints: [{ x: 1, y: 1 }, { x: 5, y: 5 }],
      hiddenPowerUps: new Map([['3,3', 'extraBalloon']]),
    },
    players,
    balloons: [],
    splashes: [],
    exposedPowerUps: new Map(),
    tideRing: 0,
    events: [],
    matchConfig: config,
    roundNo: 1,
    winner: null,
    ended: false,
  };
}

function botInput(botState: RoundState): InputFrame {
  const bot = botState.players.find((p) => p.playerId === 'bot1');
  if (!bot || !bot.alive) return { dir: null, balloonPressed: false };
  const dirs: Direction[] = ['up', 'down', 'left', 'right'];
  const dir = dirs[Math.floor(Math.random() * dirs.length)];
  const balloonPressed = Math.random() < 0.02;
  return { dir: Math.random() < 0.7 ? dir : null, balloonPressed };
}

function getPlayerInput(): InputFrame {
  return { dir: currentInput.dir, balloonPressed: currentInput.balloonPressed };
}

export const tutorialScreen: Screen = {
  enter(_data?: unknown) {
    step = 0;
    completed = false;
    xpAwarded = false;
    tick = 0;
    state = createTutorialState();
    sprites = new SpriteRenderer();
    sprites.setTheme('backyard');
    sprites.setTileSize(16);
    particles = new ParticleSystem();
    hud = new HUD();
    audioEngine.playMusic('game');
  },
  update(dt: number) {
    if (!state || !sprites || !particles || !hud) return;
    tick++;
    sprites.setTick(tick);
    particles.update(dt);
    hud.update(dt);

    if (state.ended) {
      completed = true;
      if (!xpAwarded) {
        xpAwarded = true;
        // Award XP animation would happen here
      }
      return;
    }

    const playerInput = getPlayerInput();
    const botInp = botInput(state);
    const inputs = new Map([
      ['player1', playerInput],
      ['bot1', botInp],
    ]);

    simulateTick(state, { tick, playerInputs: inputs }, CONFIG);

    // Check step progression
    if (step === 0 && playerInput.dir) step++;
    if (step === 1 && playerInput.balloonPressed) step++;
    if (step === 2 && state.balloons.length > 0) step++;
    if (step === 3 && state.exposedPowerUps.size > 0) step++;
    if (step === 4 && state.balloons.length >= 2) step++;
    if (step === 5 && state.players.some((_p) => _p.playerId === 'bot1' && !_p.alive)) step++;

    // Events → particles
    for (const ev of state.events) {
      if (ev.type === 'castle_washed') {
        particles.emit('castle_crumble', ev.x * 16 + 48, ev.y * 16 + 48);
      } else if (ev.type === 'powerup_collected') {
        particles.emit('powerup_glow', ev.x * 16 + 48, ev.y * 16 + 48);
      } else if (ev.type === 'player_soaked') {
        particles.emit('soak_sparkle', ev.x * 16 + 48, ev.y * 16 + 48);
      }
    }
  },
  render(ctx: CanvasRenderingContext2D) {
    if (!state || !sprites || !particles || !hud) return;

    const width = 256;
    const height = 224;
    const offsetX = (width - state.map.width * 16) / 2;
    const offsetY = (height - state.map.height * 16) / 2;

    // Background
    ctx.fillStyle = PALETTE.darkBlue;
    ctx.fillRect(0, 0, width, height);

    // Draw map
    sprites.drawMap(ctx, state.map, offsetX, offsetY);

    // Draw power-ups
    for (const [key, type] of state.exposedPowerUps) {
      const [x, y] = key.split(',').map(Number);
      sprites.drawPowerUp(ctx, x, y, type, offsetX, offsetY);
    }

    // Draw balloons
    for (const b of state.balloons) {
      sprites.drawBalloon(ctx, b, offsetX, offsetY, PALETTE.blue);
    }

    // Draw splashes
    for (const s of state.splashes) {
      sprites.drawSplash(ctx, s, offsetX, offsetY, PALETTE.blue);
    }

    // Draw players
    for (const p of state.players) {
      sprites.drawPlayer(ctx, p, offsetX, offsetY, false);
    }

    // Particles
    particles.draw(ctx);

    // HUD
    hud.drawHUD(ctx, state, 'player1', particles);

    // Step prompt
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(20, 190, 216, 22);
    ctx.fillStyle = PALETTE.yellow;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(TUTORIAL_STEPS[Math.min(step, TUTORIAL_STEPS.length - 1)], width / 2, 204);

    // Progress
    ctx.fillStyle = PALETTE.darkGray;
    ctx.fillRect(60, 216, 136, 4);
    ctx.fillStyle = PALETTE.green;
    const progress = Math.min(1, step / TUTORIAL_STEPS.length);
    ctx.fillRect(60, 216, 136 * progress, 4);

    // Skip button
    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(220, 4, 32, 12);
    ctx.fillStyle = PALETTE.white;
    ctx.font = '5px monospace';
    ctx.fillText('Skip', 236, 12);

    if (completed) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = PALETTE.yellow;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Tutorial Complete!', width / 2, 90);
      ctx.fillStyle = PALETTE.white;
      ctx.font = '8px monospace';
      ctx.fillText('+50 XP', width / 2, 110);
      ctx.fillStyle = PALETTE.green;
      ctx.fillRect(88, 130, 80, 16);
      ctx.fillStyle = PALETTE.white;
      ctx.fillText('Continue', 128, 141);
    }
  },
  exit() {
    state = null;
    sprites = null;
    particles = null;
    hud = null;
  },
};
