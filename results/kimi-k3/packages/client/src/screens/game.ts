import type {
  AnimalId,
  GameEvent,
  HatId,
  PlayerJoinInfo,
  Snapshot,
  ThemeId,
} from '@splash/shared';
import { CONFIG, TILE_BOULDER, TILE_CASTLE, TILE_FLOOR, tileIndex, tileX, tileY } from '@splash/shared';
import { sfx, setShowdown, startMusic } from '../audio.js';
import { balloonPressed, dirFromKeys, emotePressed, loadBinds } from '../input.js';
import { net } from '../net.js';
import {
  applySnapshot,
  createPred,
  initRound,
  interpRemote,
  pushInput,
  type PredState,
} from '../prediction.js';
import { Particles } from '../render/particles.js';
import { drawHudCorners, type HudPlayer } from '../render/hud.js';
import {
  H,
  TILE,
  W,
  drawAnimal,
  drawBalloon,
  drawBoulder,
  drawCastle,
  drawDuck,
  drawFloor,
  drawPowerUp,
  drawSplash,
  drawText,
  drawTextCenter,
  drawWater,
  P,
} from '../render/sprites.js';
import type { Keys } from './common.js';

export interface GameScreenState {
  pred: PredState;
  tiles: number[];
  w: number;
  h: number;
  theme: ThemeId;
  players: PlayerJoinInfo[];
  localSlot: number;
  ranked: boolean;
  mode: string;
  roundsToWin: number;
  killFeed: { text: string; life: number }[];
  announcer: { text: string; life: number } | null;
  particles: Particles;
  shake: { x: number; y: number; life: number };
  colorblind: boolean;
  reducedShake: boolean;
  camX: number;
  camY: number;
  frame: number;
  inputAcc: number;
  lastSend: number;
  pendingBalloon: boolean;
  matchEnded: boolean;
  result: unknown | null;
  enableRevengeDucks: boolean;
  hitStop: number;
}

export function createGameScreen(): GameScreenState {
  return {
    pred: createPred(-1),
    tiles: [],
    w: 13,
    h: 11,
    theme: 'backyard',
    players: [],
    localSlot: -1,
    ranked: false,
    mode: 'duel',
    roundsToWin: 3,
    killFeed: [],
    announcer: null,
    particles: new Particles(),
    shake: { x: 0, y: 0, life: 0 },
    colorblind: localStorage.getItem('splash_cb') === '1',
    reducedShake: localStorage.getItem('splash_noshake') === '1',
    camX: 0,
    camY: 0,
    frame: 0,
    inputAcc: 0,
    lastSend: 0,
    pendingBalloon: false,
    matchEnded: false,
    result: null,
    enableRevengeDucks: true,
    hitStop: 0,
  };
}

export function gameOnMatchStart(
  g: GameScreenState,
  config: {
    mode: string;
    ranked: boolean;
    roundsToWin: number;
    theme: ThemeId;
    w: number;
    h: number;
    enableRevengeDucks: boolean;
  },
  players: PlayerJoinInfo[],
  localPlayerId: string,
): void {
  g.players = players;
  g.localSlot = players.findIndex((p) => p.playerId === localPlayerId);
  g.pred.localSlot = g.localSlot;
  g.ranked = config.ranked;
  g.mode = config.mode;
  g.roundsToWin = config.roundsToWin;
  g.theme = config.theme;
  g.w = config.w;
  g.h = config.h;
  g.enableRevengeDucks = config.enableRevengeDucks;
  g.matchEnded = false;
  g.result = null;
  g.killFeed = [];
  startMusic('battle');
  g.announcer = { text: '3-2-1-SPLASH!', life: 90 };
  sfx.countdown();
}

export function gameOnRoundStart(
  g: GameScreenState,
  roundNo: number,
  mapSeed: number,
  castleGrid: number[],
  theme: ThemeId,
  w: number,
  h: number,
): void {
  g.tiles = castleGrid.slice();
  g.theme = theme;
  g.w = w;
  g.h = h;
  initRound(
    g.pred,
    g.mode as 'duel' | 'ffa',
    mapSeed,
    g.players.length,
    g.roundsToWin,
    g.enableRevengeDucks,
    castleGrid,
    w,
    h,
  );
  g.announcer = { text: `ROUND ${roundNo}`, life: 60 };
  sfx.countdown();
}

export function gameOnSnapshot(g: GameScreenState, snap: Snapshot): void {
  applySnapshot(g.pred, snap);
  // showdown music
  const alive = snap.players.filter((p) => p.alive && !p.isDuck).length;
  if (alive === 2 && snap.phase === 'playing') setShowdown(true);
}

export function gameOnEvents(g: GameScreenState, events: GameEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case 'balloon_dropped':
        sfx.drop();
        break;
      case 'balloon_burst':
        sfx.burst();
        if (!g.reducedShake) {
          g.shake.life = 6;
        }
        {
          const px = e.tx * TILE + 8;
          const py = e.ty * TILE + 8;
          g.particles.burst(px, py, P.splash, 10);
        }
        break;
      case 'chain_burst':
        sfx.chain(e.depth);
        g.announcer = {
          text: e.depth >= 3 ? 'TRIPLE SPLASH!+' : 'DOUBLE SPLASH!',
          life: 50,
        };
        break;
      case 'castle_washed':
        if (g.tiles.length) {
          g.tiles[tileIndex(g.w, e.tx, e.ty)] = TILE_FLOOR;
        }
        g.particles.burst(e.tx * TILE + 8, e.ty * TILE + 8, P.castle, 6);
        break;
      case 'powerup_collected':
        sfx.pickup();
        break;
      case 'player_soaked': {
        sfx.soak();
        g.hitStop = 2;
        const victim = g.players[e.slot];
        const killer = e.bySlot >= 0 ? g.players[e.bySlot] : null;
        const text = e.byTide
          ? `${victim?.nickname ?? '?'} washed away!`
          : `${killer?.nickname ?? '?'} soaked ${victim?.nickname ?? '!'}`;
        g.killFeed.unshift({ text, life: 120 });
        if (g.killFeed.length > 4) g.killFeed.pop();
        break;
      }
      case 'tide_advance':
        sfx.tide();
        g.announcer = { text: 'RISING TIDE!', life: 60 };
        break;
      case 'emote':
        sfx.emote();
        break;
      default:
        break;
    }
  }
}

export function gameOnMatchEnd(g: GameScreenState, result: unknown): void {
  g.matchEnded = true;
  g.result = result;
  sfx.victory();
}

export function updateGame(g: GameScreenState, keys: Keys, dt: number): void {
  g.frame++;
  if (g.hitStop > 0) {
    g.hitStop--;
    return;
  }

  // input at ~30Hz send, sample continuously
  const binds = loadBinds();
  const dir = dirFromKeys(keys, binds);
  if (balloonPressed(keys, binds)) g.pendingBalloon = true;
  const em = emotePressed(keys, binds);
  if (em >= 0) net.send({ type: 'emote', id: em });
  if (keys.pressed.has(binds.mute)) {
    /* handled in main */
  }

  g.inputAcc += dt;
  const step = 1000 / 30;
  while (g.inputAcc >= step) {
    g.inputAcc -= step;
    const balloon = g.pendingBalloon;
    g.pendingBalloon = false;
    const frame = pushInput(g.pred, dir, balloon);
    const latency = Number(localStorage.getItem('splash_lag') ?? '0');
    if (latency > 0) {
      setTimeout(() => {
        net.send({ type: 'input', seq: frame.seq, tick: g.pred.sim?.tick ?? 0, dir: frame.dir, balloon: frame.balloon });
      }, latency);
    } else {
      net.send({ type: 'input', seq: frame.seq, tick: g.pred.sim?.tick ?? 0, dir: frame.dir, balloon: frame.balloon });
    }
  }

  g.particles.update();
  if (g.shake.life > 0) {
    g.shake.life--;
    g.shake.x = (Math.random() - 0.5) * 3;
    g.shake.y = (Math.random() - 0.5) * 3;
  } else {
    g.shake.x = 0;
    g.shake.y = 0;
  }
  for (const k of g.killFeed) k.life--;
  g.killFeed = g.killFeed.filter((k) => k.life > 0);
  if (g.announcer) {
    g.announcer.life--;
    if (g.announcer.life <= 0) g.announcer = null;
  }

  // camera follow local
  const local = interpRemote(g.pred, g.localSlot);
  if (local) {
    const mapW = g.w * TILE;
    const mapH = g.h * TILE;
    const targetX = local.x * TILE - W / 2;
    const targetY = local.y * TILE - H / 2;
    g.camX += (targetX - g.camX) * 0.15;
    g.camY += (targetY - g.camY) * 0.15;
    g.camX = Math.max(0, Math.min(mapW - W, g.camX));
    g.camY = Math.max(0, Math.min(mapH - H, g.camY));
    if (mapW < W) g.camX = (mapW - W) / 2;
    if (mapH < H) g.camY = (mapH - H) / 2;
  }
}

export function drawGame(ctx: CanvasRenderingContext2D, g: GameScreenState, ping: number): void {
  ctx.fillStyle = P.black;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(-Math.floor(g.camX) + g.shake.x, -Math.floor(g.camY) + g.shake.y);

  const snap = g.pred.remoteSnap;
  const tide = snap?.tideRing ?? g.pred.sim?.tideRing ?? 0;
  const tick = snap?.tick ?? g.pred.sim?.tick ?? 0;

  // tiles
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const px = x * TILE;
      const py = y * TILE;
      const flooded = tide > 0 && (x < tide || y < tide || x >= g.w - tide || y >= g.h - tide);
      if (flooded) {
        drawWater(ctx, px, py, tick);
        continue;
      }
      const t = g.tiles[tileIndex(g.w, x, y)] ?? TILE_FLOOR;
      if (t === TILE_BOULDER) {
        drawFloor(ctx, px, py, g.theme, (x + y) % 2 === 0);
        drawBoulder(ctx, px, py);
      } else if (t === TILE_CASTLE) {
        drawFloor(ctx, px, py, g.theme, (x + y) % 2 === 0);
        drawCastle(ctx, px, py);
      } else {
        drawFloor(ctx, px, py, g.theme, (x + y) % 2 === 0);
      }
    }
  }

  // powerups
  const pus = snap?.powerUps ?? g.pred.sim?.exposedPowerUps ?? [];
  for (const pu of pus) {
    drawPowerUp(ctx, pu.tx * TILE, pu.ty * TILE, pu.kind, tick);
  }

  // balloons
  const balloons = snap?.balloons ?? g.pred.sim?.balloons ?? [];
  for (const b of balloons) {
    drawBalloon(ctx, b.fx * TILE, b.fy * TILE, tick, b.placedTick);
  }

  // splashes
  const splashes = snap?.splashes ?? g.pred.sim?.splashes ?? [];
  for (const s of splashes) {
    for (const idx of s.tiles) {
      const tx = tileX(g.w, idx);
      const ty = tileY(g.w, idx);
      drawSplash(ctx, tx * TILE, ty * TILE, g.colorblind);
    }
  }

  // players
  for (const info of g.players) {
    const pos = interpRemote(g.pred, info.slot);
    if (!pos) continue;
    const sp = snap?.players.find((p) => p.slot === info.slot);
    if (pos.isDuck) {
      drawDuck(ctx, pos.x * TILE - 8, pos.y * TILE - 8, tick);
      continue;
    }
    if (!pos.alive && !pos.isDuck) continue;
    drawAnimal(
      ctx,
      pos.x * TILE - 8,
      pos.y * TILE - 8,
      info.animal as AnimalId,
      info.hat as HatId,
      pos.dir,
      g.frame >> 3,
      false,
    );
    // emote bubble
    if (sp && sp.emoteUntilTick > tick) {
      const labels = ['♪', '!', '♥', '?'];
      drawText(ctx, labels[sp.emoteId] ?? '!', pos.x * TILE - 2, pos.y * TILE - 16, P.white);
    }
  }

  g.particles.draw(ctx);
  ctx.restore();

  const hudPlayers: HudPlayer[] = g.players.map((p) => ({
    slot: p.slot,
    nickname: p.nickname,
    animal: p.animal,
    hat: p.hat,
    rating: p.rating,
  }));
  drawHudCorners(
    ctx,
    snap,
    hudPlayers,
    g.localSlot,
    ping,
    g.killFeed,
    g.announcer,
    g.shake,
    g.frame >> 3,
  );

  if (snap?.phase === 'countdown') {
    const left = Math.max(0, Math.ceil((snap.countdownUntilTick - snap.tick) / CONFIG.TICK_RATE));
    drawTextCenter(ctx, left > 0 ? String(left) : 'SPLASH!', 100, P.gold, 2);
  }
  if (snap?.phase === 'roundEnd') {
    const name =
      snap.roundWinner >= 0
        ? (g.players[snap.roundWinner]?.nickname ?? 'Someone')
        : 'DRAW';
    drawTextCenter(ctx, snap.roundWinner >= 0 ? `${name} wins round!` : 'DRAW!', 100, P.gold);
  }
}
