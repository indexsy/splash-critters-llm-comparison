import type { GameEvent, MatchConfig, Snapshot } from '@splash/shared';
import { CONFIG } from '@splash/shared';
import {
  PAL,
  drawAnimal,
  drawBalloon,
  drawBoulder,
  drawCastle,
  drawDuck,
  drawPowerup,
  drawSplashTile,
  themeColors,
} from '../render/sprites.js';
import { drawHud } from '../render/hud.js';
import type { ParticleSystem } from '../render/particles.js';
import type { Prediction } from '../prediction.js';
import { W, H, text } from './common.js';

export type GameView = {
  config: MatchConfig;
  grid: number[];
  width: number;
  height: number;
  theme: import('@splash/shared').MapTheme;
  snap: Snapshot | null;
  scores: Record<string, number>;
  countdown: string | number | null;
  announcer: string | null;
  killFeed: string[];
  shake: number;
  colorblind: boolean;
  reducedShake: boolean;
  hitstop: number;
};

export function drawGame(
  ctx: CanvasRenderingContext2D,
  view: GameView,
  pred: Prediction,
  localId: string | null,
  particles: ParticleSystem,
  tick: number,
  ping: number,
): void {
  const { width, height, theme, grid } = view;
  const tile = Math.floor(Math.min((W - 8) / width, (H - 24) / height));
  const ox = Math.floor((W - width * tile) / 2);
  const oy = 18 + Math.floor((H - 18 - height * tile) / 2);

  let shakeX = 0;
  let shakeY = 0;
  if (view.shake > 0 && !view.reducedShake) {
    shakeX = (Math.random() - 0.5) * view.shake;
    shakeY = (Math.random() - 0.5) * view.shake;
  }

  ctx.save();
  ctx.translate(shakeX, shakeY);

  const tc = themeColors(theme);
  // Floor
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = ox + x * tile;
      const py = oy + y * tile;
      ctx.fillStyle = (x + y) % 2 === 0 ? tc.floor : tc.floorAlt;
      ctx.fillRect(px, py, tile, tile);

      const t = grid[y * width + x] ?? 0;
      if (t === 1) drawBoulder(ctx, px, py, tile, theme);
      else if (t === 2) drawCastle(ctx, px, py, tile);
    }
  }

  // Tide
  const tideRing = view.snap?.tideRing ?? pred.state?.tideRing ?? 0;
  if (tideRing > 0) {
    ctx.fillStyle = '#1a5a9a99';
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < tideRing || y < tideRing || x >= width - tideRing || y >= height - tideRing) {
          const shimmer = Math.sin(tick * 0.2 + x + y) * 0.1 + 0.5;
          ctx.globalAlpha = 0.45 + shimmer * 0.2;
          ctx.fillRect(ox + x * tile, oy + y * tile, tile, tile);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  const simTick = view.snap?.tick ?? pred.state?.tick ?? 0;

  // Powerups
  const powerups = view.snap?.powerups ?? pred.state?.powerups ?? [];
  for (const pu of powerups) {
    drawPowerup(ctx, ox + pu.x * tile + tile / 2, oy + pu.y * tile + tile / 2, pu.type, simTick);
  }

  // Balloons
  const balloons = view.snap?.balloons ?? pred.state?.balloons ?? [];
  for (const b of balloons) {
    drawBalloon(ctx, ox + b.x * tile + tile / 2, oy + b.y * tile + tile / 2, simTick, b.placeTick, b.fuseTicks);
  }

  // Splashes
  const splashes = view.snap?.splashes ?? pred.state?.splashes ?? [];
  for (const s of splashes) {
    const age = simTick - s.startTick;
    for (const t of s.tiles) {
      drawSplashTile(ctx, ox + t.x * tile, oy + t.y * tile, tile, age, view.colorblind);
    }
  }

  // Players
  const players = view.snap?.players ?? pred.state?.players ?? [];
  for (const p of players) {
    let px = p.x;
    let py = p.y;
    let dir = p.dir;
    let moving = p.moving;

    if (p.id === localId && pred.state) {
      const lp = pred.state.players.find((x) => x.id === localId);
      if (lp) {
        px = lp.x;
        py = lp.y;
        dir = lp.dir;
        moving = lp.moving;
      }
    } else {
      const interp = pred.getRemotePos(p.id);
      if (interp) {
        px = interp.x;
        py = interp.y;
        dir = interp.dir;
        moving = interp.moving;
      }
    }

    const sx = ox + px * tile;
    const sy = oy + py * tile;
    const frame = moving ? Math.floor(simTick / 6) % 2 : 0;

    if (p.revenge) {
      drawDuck(ctx, sx, sy);
      drawAnimal(ctx, sx, sy - 4, p.animal, p.hat, dir, frame, 0.7);
    } else if (p.soaked && !p.alive) {
      ctx.globalAlpha = 0.35;
      drawAnimal(ctx, sx, sy, p.animal, p.hat, dir, 0);
      ctx.globalAlpha = 1;
      // Dramatic cat soak
      if (p.animal === 'cat') {
        text(ctx, 'HISS!', sx, sy - 10, '#e53935', 5, 'center');
      }
    } else {
      drawAnimal(ctx, sx, sy, p.animal, p.hat, dir, frame);
      if (p.hasBoots) {
        ctx.fillStyle = '#ef5350';
        ctx.fillRect(sx - 3, sy + 5, 6, 2);
      }
    }
  }

  particles.draw(ctx);
  ctx.restore();

  drawHud(ctx, view.config, view.snap, view.scores, localId, ping, view.announcer, view.killFeed, W, H);

  // Countdown overlay
  if (view.countdown !== null) {
    ctx.fillStyle = '#00000066';
    ctx.fillRect(0, 0, W, H);
    text(ctx, String(view.countdown), W / 2, H / 2, '#fff59d', 24, 'center');
  }
}

export function processGameEvents(
  events: GameEvent[],
  particles: ParticleSystem,
  view: GameView,
  tile: number,
  ox: number,
  oy: number,
  sfx: typeof import('../audio.js').sfx,
): void {
  for (const e of events) {
    if (e.type === 'castle_washed') {
      particles.castle(ox + e.x * tile + tile / 2, oy + e.y * tile + tile / 2);
      if (view.grid[e.y * view.width + e.x] !== undefined) {
        view.grid[e.y * view.width + e.x] = 0;
      }
    }
    if (e.type === 'balloon_burst') {
      particles.burst(ox + e.x * tile + tile / 2, oy + e.y * tile + tile / 2, '#7ec8f0', 10);
      view.shake = view.reducedShake ? 0 : 3;
      sfx.burst();
    }
    if (e.type === 'chain_burst') {
      if (e.count === 2) {
        view.announcer = 'DOUBLE SPLASH!';
        sfx.chain(2);
      } else {
        view.announcer = 'TRIPLE SPLASH!+';
        sfx.chain(e.count);
      }
    }
    if (e.type === 'player_soaked') {
      sfx.soak();
      view.hitstop = 2;
      const victim = view.config.players.find((p) => p.id === e.playerId);
      const killer = e.byPlayerId ? view.config.players.find((p) => p.id === e.byPlayerId) : null;
      if (victim) {
        const vname = victim.nickname.split('#')[0];
        const kname = killer?.nickname.split('#')[0] ?? 'Tide';
        view.killFeed.push(`${kname} soaked ${vname}!`);
        if (view.killFeed.length > 6) view.killFeed.shift();
      }
    }
    if (e.type === 'powerup_collected') sfx.pickup();
    if (e.type === 'balloon_placed') sfx.drop();
    if (e.type === 'tide_advance') {
      sfx.tide();
      view.announcer = 'RISING TIDE!';
    }
  }
}
