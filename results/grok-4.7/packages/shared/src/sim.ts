import {
  CARDINALS,
  CONFIG,
  DIRS,
  TILE_BOULDER,
  TILE_CASTLE,
  TILE_EMPTY,
  type Dir,
  type PowerKind,
} from './config.js';
import type { GeneratedMap } from './map.js';
import { tileRing } from './map.js';

export interface SimPlayer {
  id: string;
  name: string;
  animal: string;
  hat: string;
  x: number;
  y: number;
  dir: Dir;
  alive: boolean;
  ducking: boolean;
  duckPos: number;
  duckCooldown: number;
  speed: number;
  balloonMax: number;
  splashRange: number;
  hasKick: boolean;
  flippers: number;
  soaks: number;
  castles: number;
  biggestChain: number;
  survived: number;
  balloonHeld: boolean;
  phasingX: number;
  phasingY: number;
  soakedBy: string | null;
}

export interface SimBalloon {
  id: number;
  ownerId: string;
  tx: number;
  ty: number;
  fuse: number;
  range: number;
  slideDir: Dir | null;
  slideProg: number;
  slideTiles: number;
  maxSlide: number;
  revenge: boolean;
  bornTick: number;
}

export interface SimSplash {
  x: number;
  y: number;
  dir: Dir | 'center';
  ttl: number;
  ownerId: string;
}

export interface SimPower {
  x: number;
  y: number;
  kind: PowerKind;
  hidden: boolean;
  revealedTick: number;
}

export type SimEvent =
  | { t: 'castle_washed'; x: number; y: number; by: string }
  | { t: 'powerup_revealed'; x: number; y: number; kind: PowerKind }
  | { t: 'powerup_collected'; x: number; y: number; kind: PowerKind; playerId: string }
  | { t: 'player_soaked'; playerId: string; by: string; x: number; y: number }
  | { t: 'chain_burst'; x: number; y: number; count: number; ownerId: string }
  | { t: 'balloon_kicked'; x: number; y: number; dir: Dir; playerId: string }
  | { t: 'tide_advance'; level: number }
  | { t: 'revenge_lob'; playerId: string; x: number; y: number; dir: Dir }
  | { t: 'balloon_placed'; playerId: string; x: number; y: number; id: number };

export interface SimState {
  width: number;
  height: number;
  tiles: number[];
  players: SimPlayer[];
  balloons: SimBalloon[];
  splashes: SimSplash[];
  powerups: SimPower[];
  tick: number;
  tideLevel: number;
  tideStart: number;
  tideInterval: number;
  nextBalloonId: number;
  events: SimEvent[];
  phase: 'playing' | 'round_end';
  winnerId: string | null;
  draw: boolean;
  enableKick: boolean;
  enableRevenge: boolean;
  aliveAtStart: number;
}

export interface TickInput {
  id: string;
  dir: Dir;
  balloon: boolean;
}

export function isFlooded(state: SimState, x: number, y: number): boolean {
  if (state.tideLevel <= 0) return false;
  return tileRing(x, y, state.width, state.height) <= state.tideLevel;
}

export function idx(state: SimState, x: number, y: number): number {
  return y * state.width + x;
}

export function inBounds(state: SimState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.width && y < state.height;
}

export function balloonAt(state: SimState, x: number, y: number, ignoreId?: number): SimBalloon | undefined {
  return state.balloons.find((b) => b.tx === x && b.ty === y && b.id !== ignoreId);
}

export function splashCells(
  state: SimState,
  ox: number,
  oy: number,
  range: number,
  ignoreBalloonId?: number,
): { x: number; y: number; dir: Dir | 'center' }[] {
  const cells: { x: number; y: number; dir: Dir | 'center' }[] = [{ x: ox, y: oy, dir: 'center' }];
  for (const dir of CARDINALS) {
    const d = DIRS[dir];
    for (let i = 1; i <= range; i++) {
      const x = ox + d.x * i;
      const y = oy + d.y * i;
      if (!inBounds(state, x, y)) break;
      const tile = state.tiles[idx(state, x, y)]!;
      if (tile === TILE_BOULDER) break;
      cells.push({ x, y, dir });
      if (tile === TILE_CASTLE) break;
      const b = balloonAt(state, x, y, ignoreBalloonId);
      if (b) break;
    }
  }
  return cells;
}

export function predictBalloonTile(state: SimState, b: SimBalloon): { x: number; y: number } {
  if (!b.slideDir) return { x: b.tx, y: b.ty };
  let x = b.tx;
  let y = b.ty;
  let prog = b.slideProg;
  let tiles = b.slideTiles;
  const d = DIRS[b.slideDir];
  const step = CONFIG.KICK_SPEED / CONFIG.TICK_RATE;
  for (let i = 0; i < b.fuse; i++) {
    let left = step;
    let guard = 0;
    while (left > 0 && guard++ < 4) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (!canBalloonEnter(state, nx, ny, b.id)) return { x, y };
      const need = 1 - prog;
      if (left >= need) {
        left -= need;
        x = nx;
        y = ny;
        prog = 0;
        tiles += 1;
        if (b.maxSlide > 0 && tiles >= b.maxSlide) return { x, y };
        const nnx = x + d.x;
        const nny = y + d.y;
        if (!canBalloonEnter(state, nnx, nny, b.id)) return { x, y };
      } else {
        prog += left;
        left = 0;
      }
    }
  }
  return { x, y };
}

function canBalloonEnter(state: SimState, x: number, y: number, ignoreId: number): boolean {
  if (!inBounds(state, x, y)) return false;
  const tile = state.tiles[idx(state, x, y)]!;
  if (tile === TILE_BOULDER || tile === TILE_CASTLE) return false;
  if (balloonAt(state, x, y, ignoreId)) return false;
  for (const p of state.players) {
    if (!p.alive) continue;
    if (Math.floor(p.x) === x && Math.floor(p.y) === y) return false;
  }
  return true;
}

function tileBlocked(state: SimState, x: number, y: number, player: SimPlayer): boolean {
  if (!inBounds(state, x, y)) return true;
  const tile = state.tiles[idx(state, x, y)]!;
  if (tile === TILE_BOULDER || tile === TILE_CASTLE) return true;
  if (player.phasingX === x && player.phasingY === y) return false;
  if (balloonAt(state, x, y)) return true;
  return false;
}

export function canStand(state: SimState, player: SimPlayer, x: number, y: number): boolean {
  const r = CONFIG.PLAYER_RADIUS - 1e-4;
  const corners: [number, number][] = [
    [x - r, y - r],
    [x + r, y - r],
    [x - r, y + r],
    [x + r, y + r],
  ];
  const seen = new Set<string>();
  for (const [sx, sy] of corners) {
    const tx = Math.floor(sx);
    const ty = Math.floor(sy);
    const key = `${tx},${ty}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (tileBlocked(state, tx, ty, player)) return false;
  }
  return true;
}

function nudge(state: SimState, player: SimPlayer, axis: 'x' | 'y'): void {
  const pos = axis === 'x' ? player.x : player.y;
  const center = Math.floor(pos) + 0.5;
  const delta = Math.sign(center - pos) * Math.min(0.14, Math.abs(center - pos));
  if (delta === 0) return;
  const nx = axis === 'x' ? player.x + delta : player.x;
  const ny = axis === 'y' ? player.y + delta : player.y;
  if (canStand(state, player, nx, ny)) {
    player.x = nx;
    player.y = ny;
  }
}

function maybeKick(state: SimState, player: SimPlayer, dir: Dir): void {
  if (!state.enableKick || !player.hasKick || dir === 'none') return;
  const d = DIRS[dir];
  const tx = Math.floor(player.x) + d.x;
  const ty = Math.floor(player.y) + d.y;
  const b = balloonAt(state, tx, ty);
  if (!b || b.slideDir) return;
  if (b.tx === player.phasingX && b.ty === player.phasingY) return;
  b.slideDir = dir;
  b.slideProg = 0;
  b.slideTiles = 0;
  b.maxSlide = 0;
  state.events.push({ t: 'balloon_kicked', x: b.tx, y: b.ty, dir, playerId: player.id });
}

function movePlayer(state: SimState, player: SimPlayer, dir: Dir): void {
  if (dir === 'none') return;
  const dist = player.speed / CONFIG.TICK_RATE;
  const d = DIRS[dir];
  maybeKick(state, player, dir);
  const nx = player.x + d.x * dist;
  const ny = player.y + d.y * dist;
  if (canStand(state, player, nx, ny)) {
    player.x = nx;
    player.y = ny;
  } else if (d.x !== 0) {
    nudge(state, player, 'y');
    const nx2 = player.x + d.x * dist;
    if (canStand(state, player, nx2, player.y)) player.x = nx2;
    else if (canStand(state, player, player.x + d.x * dist, player.y)) player.x += d.x * dist;
  } else if (d.y !== 0) {
    nudge(state, player, 'x');
    const ny2 = player.y + d.y * dist;
    if (canStand(state, player, player.x, ny2)) player.y = ny2;
  }
  player.dir = dir;
  if (player.phasingX >= 0) {
    const still = tileBlockedWould(player, player.phasingX, player.phasingY);
    if (!still) {
      player.phasingX = -1;
      player.phasingY = -1;
    }
  }
}

function tileBlockedWould(player: SimPlayer, tx: number, ty: number): boolean {
  const r = CONFIG.PLAYER_RADIUS;
  return (
    player.x + r > tx &&
    player.x - r < tx + 1 &&
    player.y + r > ty &&
    player.y - r < ty + 1
  );
}

function tryPlace(state: SimState, player: SimPlayer): void {
  const tx = Math.floor(player.x);
  const ty = Math.floor(player.y);
  if (!inBounds(state, tx, ty)) return;
  const tile = state.tiles[idx(state, tx, ty)]!;
  if (tile !== TILE_EMPTY) return;
  if (balloonAt(state, tx, ty)) return;
  const owned = state.balloons.filter((b) => b.ownerId === player.id && !b.revenge).length;
  if (owned >= player.balloonMax) return;
  const balloon: SimBalloon = {
    id: state.nextBalloonId++,
    ownerId: player.id,
    tx,
    ty,
    fuse: CONFIG.FUSE_TICKS,
    range: player.splashRange,
    slideDir: null,
    slideProg: 0,
    slideTiles: 0,
    maxSlide: 0,
    revenge: false,
    bornTick: state.tick,
  };
  state.balloons.push(balloon);
  player.phasingX = tx;
  player.phasingY = ty;
  state.events.push({ t: 'balloon_placed', playerId: player.id, x: tx, y: ty, id: balloon.id });
}

function borderPath(w: number, h: number): { x: number; y: number; inward: Dir }[] {
  const path: { x: number; y: number; inward: Dir }[] = [];
  for (let x = 0; x < w - 1; x++) path.push({ x, y: 0, inward: 'down' });
  for (let y = 0; y < h - 1; y++) path.push({ x: w - 1, y, inward: 'left' });
  for (let x = w - 1; x > 0; x--) path.push({ x, y: h - 1, inward: 'up' });
  for (let y = h - 1; y > 0; y--) path.push({ x: 0, y, inward: 'right' });
  return path;
}

export function borderLength(w: number, h: number): number {
  return borderPath(w, h).length;
}

function nearestBorder(state: SimState, player: SimPlayer): number {
  const path = borderPath(state.width, state.height);
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  let best = 0;
  let bestD = 1e9;
  for (let i = 0; i < path.length; i++) {
    const c = path[i]!;
    const d = Math.abs(c.x - px) + Math.abs(c.y - py);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function advanceDucks(state: SimState): void {
  if (!state.enableRevenge) return;
  const path = borderPath(state.width, state.height);
  if (path.length === 0) return;
  const step = CONFIG.DUCK_SPEED / CONFIG.TICK_RATE;
  for (const p of state.players) {
    if (!p.ducking) continue;
    p.duckPos = (p.duckPos + step) % path.length;
    if (p.duckCooldown > 0) {
      p.duckCooldown -= 1;
      continue;
    }
    const cell = path[Math.floor(p.duckPos) % path.length]!;
    const d = DIRS[cell.inward];
    const sx = cell.x + d.x;
    const sy = cell.y + d.y;
    if (!canBalloonEnter(state, sx, sy, -1)) {
      p.duckCooldown = 15;
      continue;
    }
    const balloon: SimBalloon = {
      id: state.nextBalloonId++,
      ownerId: p.id,
      tx: sx,
      ty: sy,
      fuse: CONFIG.REVENGE_FUSE_TICKS,
      range: CONFIG.REVENGE_LOB_RANGE,
      slideDir: cell.inward,
      slideProg: 0,
      slideTiles: 0,
      maxSlide: 2,
      revenge: true,
      bornTick: state.tick,
    };
    state.balloons.push(balloon);
    p.duckCooldown = CONFIG.REVENGE_LOB_COOLDOWN_TICKS;
    state.events.push({ t: 'revenge_lob', playerId: p.id, x: sx, y: sy, dir: cell.inward });
  }
}

function advanceSlides(state: SimState): void {
  const step = CONFIG.KICK_SPEED / CONFIG.TICK_RATE;
  for (const b of state.balloons) {
    if (!b.slideDir) continue;
    let left = step;
    let guard = 0;
    while (left > 0 && b.slideDir && guard++ < 5) {
      const d = DIRS[b.slideDir];
      const nx = b.tx + d.x;
      const ny = b.ty + d.y;
      if (!canBalloonEnter(state, nx, ny, b.id)) {
        b.slideDir = null;
        b.slideProg = 0;
        break;
      }
      const need = 1 - b.slideProg;
      if (left >= need) {
        left -= need;
        b.tx = nx;
        b.ty = ny;
        b.slideProg = 0;
        b.slideTiles += 1;
        if (b.maxSlide > 0 && b.slideTiles >= b.maxSlide) {
          b.slideDir = null;
          break;
        }
        const nnx = b.tx + d.x;
        const nny = b.ty + d.y;
        if (!canBalloonEnter(state, nnx, nny, b.id)) {
          b.slideDir = null;
          break;
        }
      } else {
        b.slideProg += left;
        left = 0;
      }
    }
  }
}

function washCastle(state: SimState, x: number, y: number, by: string): void {
  const i = idx(state, x, y);
  if (state.tiles[i] !== TILE_CASTLE) return;
  state.tiles[i] = TILE_EMPTY;
  state.events.push({ t: 'castle_washed', x, y, by });
  if (by !== 'tide') {
    const p = state.players.find((pl) => pl.id === by);
    if (p) p.castles += 1;
  }
  const pu = state.powerups.find((p) => p.x === x && p.y === y && p.hidden);
  if (!pu) return;
  if (by === 'tide' || isFlooded(state, x, y)) {
    state.powerups = state.powerups.filter((p) => p !== pu);
    return;
  }
  pu.hidden = false;
  pu.revealedTick = state.tick;
  state.events.push({ t: 'powerup_revealed', x, y, kind: pu.kind });
}

function destroyExposed(state: SimState, x: number, y: number): void {
  state.powerups = state.powerups.filter(
    (p) => p.hidden || p.x !== x || p.y !== y || p.revealedTick >= state.tick,
  );
}

function addSplash(state: SimState, x: number, y: number, dir: Dir | 'center', ownerId: string): void {
  const existing = state.splashes.find((s) => s.x === x && s.y === y);
  if (existing) {
    existing.ttl = CONFIG.SPLASH_LINGER_TICKS;
    return;
  }
  state.splashes.push({ x, y, dir, ttl: CONFIG.SPLASH_LINGER_TICKS, ownerId });
}

function explodePass(state: SimState): void {
  const due = state.balloons
    .filter((b) => b.fuse <= 0)
    .map((b) => b.id)
    .sort((a, b) => a - b);
  const exploded = new Set<number>();
  const queueAll = [...due];
  while (queueAll.length) {
    const start = queueAll.shift()!;
    if (exploded.has(start)) continue;
    const queue = [start];
    const involved: SimBalloon[] = [];
    let origin: { x: number; y: number; ownerId: string } | null = null;
    while (queue.length) {
      const bid = queue.shift()!;
      if (exploded.has(bid)) continue;
      const b = state.balloons.find((x) => x.id === bid);
      if (!b) continue;
      exploded.add(bid);
      if (!origin) origin = { x: b.tx, y: b.ty, ownerId: b.ownerId };
      involved.push(b);
      state.balloons = state.balloons.filter((x) => x.id !== bid);
      const cells = splashCells(state, b.tx, b.ty, b.range, b.id);
      for (const c of cells) {
        addSplash(state, c.x, c.y, c.dir, b.ownerId);
        const tile = state.tiles[idx(state, c.x, c.y)];
        if (tile === TILE_CASTLE) washCastle(state, c.x, c.y, b.ownerId);
        destroyExposed(state, c.x, c.y);
        const other = balloonAt(state, c.x, c.y);
        if (other && !exploded.has(other.id) && !queue.includes(other.id)) queue.push(other.id);
      }
    }
    if (involved.length >= 2 && origin) {
      state.events.push({
        t: 'chain_burst',
        x: origin.x,
        y: origin.y,
        count: involved.length,
        ownerId: origin.ownerId,
      });
      for (const b of involved) {
        const p = state.players.find((pl) => pl.id === b.ownerId);
        if (p) p.biggestChain = Math.max(p.biggestChain, involved.length);
      }
    }
  }
}

function updateTide(state: SimState): void {
  if (state.tick < state.tideStart) return;
  const level = 1 + Math.floor((state.tick - state.tideStart) / state.tideInterval);
  if (level <= state.tideLevel) return;
  const prev = state.tideLevel;
  state.tideLevel = level;
  state.events.push({ t: 'tide_advance', level });
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const ring = tileRing(x, y, state.width, state.height);
      if (ring <= level && ring > prev && state.tiles[idx(state, x, y)] === TILE_CASTLE) {
        washCastle(state, x, y, 'tide');
      }
    }
  }
}

function soakPlayers(state: SimState): void {
  const splashOwner = new Map<string, string>();
  for (const s of state.splashes) splashOwner.set(`${s.x},${s.y}`, s.ownerId);
  const ordered = [...state.players].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const p of ordered) {
    if (!p.alive) continue;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    const splashBy = splashOwner.get(`${tx},${ty}`);
    const flooded = isFlooded(state, tx, ty);
    if (!splashBy && !flooded) continue;
    p.alive = false;
    p.ducking = state.enableRevenge;
    p.duckPos = nearestBorder(state, p);
    p.duckCooldown = CONFIG.REVENGE_LOB_COOLDOWN_TICKS;
    p.soakedBy = flooded && !splashBy ? 'tide' : splashBy ?? 'tide';
    state.events.push({
      t: 'player_soaked',
      playerId: p.id,
      by: p.soakedBy,
      x: tx,
      y: ty,
    });
    if (p.soakedBy !== 'tide' && p.soakedBy !== p.id) {
      const attacker = state.players.find((a) => a.id === p.soakedBy);
      if (attacker) attacker.soaks += 1;
    }
  }
}

function collectPowerups(state: SimState): void {
  for (const p of state.players) {
    if (!p.alive) continue;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    const pu = state.powerups.find((u) => !u.hidden && u.x === tx && u.y === ty);
    if (!pu) continue;
    if (pu.kind === 'balloon') p.balloonMax = Math.min(CONFIG.BALLOON_CAP, p.balloonMax + 1);
    else if (pu.kind === 'splash') p.splashRange = Math.min(CONFIG.SPLASH_CAP, p.splashRange + 1);
    else if (pu.kind === 'flippers') {
      p.flippers += 1;
      p.speed = Math.min(CONFIG.SPEED_CAP, CONFIG.SPEED_BASE + p.flippers * CONFIG.SPEED_PER_FLIPPER);
    } else if (pu.kind === 'boots') p.hasKick = true;
    state.powerups = state.powerups.filter((u) => u !== pu);
    state.events.push({ t: 'powerup_collected', x: tx, y: ty, kind: pu.kind, playerId: p.id });
  }
}

function decaySplashes(state: SimState): void {
  for (const s of state.splashes) s.ttl -= 1;
  state.splashes = state.splashes.filter((s) => s.ttl > 0);
}

export function simulateTick(state: SimState, inputs: TickInput[]): SimState {
  if (state.phase !== 'playing') return state;
  state.tick += 1;
  state.events = [];
  state.aliveAtStart = state.players.filter((p) => p.alive).length;
  const inputMap = new Map(inputs.map((i) => [i.id, i]));
  const ordered = [...state.players].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const p of ordered) {
    if (!p.alive) continue;
    const input = inputMap.get(p.id);
    const pressed = input?.balloon ?? false;
    const rising = pressed && !p.balloonHeld;
    p.balloonHeld = pressed;
    const dir = input?.dir ?? 'none';
    if (dir !== 'none') movePlayer(state, p, dir);
    if (rising) tryPlace(state, p);
  }
  advanceDucks(state);
  advanceSlides(state);
  for (const b of state.balloons) {
    if (b.bornTick < state.tick) b.fuse -= 1;
  }
  explodePass(state);
  updateTide(state);
  soakPlayers(state);
  collectPowerups(state);
  decaySplashes(state);
  for (const p of state.players) if (p.alive) p.survived += 1;
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.phase = 'round_end';
    if (alive.length === 1) {
      state.winnerId = alive[0]!.id;
      state.draw = false;
    } else {
      state.winnerId = null;
      state.draw = true;
    }
  }
  return state;
}

export function createRoundState(opts: {
  map: GeneratedMap;
  players: { id: string; name: string; animal: string; hat: string }[];
  enableKick?: boolean;
  enableRevenge?: boolean;
  tideStart?: number;
  tideInterval?: number;
}): SimState {
  const players: SimPlayer[] = opts.players.map((p, i) => {
    const spawn = opts.map.spawns[i % opts.map.spawns.length]!;
    return {
      id: p.id,
      name: p.name,
      animal: p.animal,
      hat: p.hat,
      x: spawn.x + 0.5,
      y: spawn.y + 0.5,
      dir: 'down',
      alive: true,
      ducking: false,
      duckPos: 0,
      duckCooldown: 0,
      speed: CONFIG.SPEED_BASE,
      balloonMax: CONFIG.BALLOON_BASE,
      splashRange: CONFIG.SPLASH_BASE,
      hasKick: false,
      flippers: 0,
      soaks: 0,
      castles: 0,
      biggestChain: 0,
      survived: 0,
      balloonHeld: false,
      phasingX: -1,
      phasingY: -1,
      soakedBy: null,
    };
  });
  return {
    width: opts.map.width,
    height: opts.map.height,
    tiles: opts.map.tiles.slice(),
    players,
    balloons: [],
    splashes: [],
    powerups: opts.map.powerups.map((p) => ({
      x: p.x,
      y: p.y,
      kind: p.kind,
      hidden: true,
      revealedTick: -1,
    })),
    tick: 0,
    tideLevel: 0,
    tideStart: opts.tideStart ?? CONFIG.ROUND_TIME_TICKS,
    tideInterval: opts.tideInterval ?? CONFIG.TIDE_INTERVAL_TICKS,
    nextBalloonId: 1,
    events: [],
    phase: 'playing',
    winnerId: null,
    draw: false,
    enableKick: opts.enableKick ?? CONFIG.ENABLE_KICK,
    enableRevenge: opts.enableRevenge ?? false,
    aliveAtStart: players.length,
  };
}

export function makeBlankArena(w: number, h: number): SimState {
  const tiles = new Array<number>(w * h).fill(TILE_EMPTY);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tiles[y * w + x] = TILE_BOULDER;
    }
  }
  return {
    width: w,
    height: h,
    tiles,
    players: [],
    balloons: [],
    splashes: [],
    powerups: [],
    tick: 0,
    tideLevel: 0,
    tideStart: CONFIG.ROUND_TIME_TICKS,
    tideInterval: CONFIG.TIDE_INTERVAL_TICKS,
    nextBalloonId: 1,
    events: [],
    phase: 'playing',
    winnerId: null,
    draw: false,
    enableKick: true,
    enableRevenge: false,
    aliveAtStart: 0,
  };
}

export function addTestPlayer(state: SimState, id: string, tx: number, ty: number, extra: Partial<SimPlayer> = {}): SimPlayer {
  const p: SimPlayer = {
    id,
    name: id,
    animal: 'frog',
    hat: 'none',
    x: tx + 0.5,
    y: ty + 0.5,
    dir: 'down',
    alive: true,
    ducking: false,
    duckPos: 0,
    duckCooldown: 0,
    speed: CONFIG.SPEED_BASE,
    balloonMax: CONFIG.BALLOON_BASE,
    splashRange: CONFIG.SPLASH_BASE,
    hasKick: false,
    flippers: 0,
    soaks: 0,
    castles: 0,
    biggestChain: 0,
    survived: 0,
    balloonHeld: false,
    phasingX: -1,
    phasingY: -1,
    soakedBy: null,
    ...extra,
  };
  state.players.push(p);
  return p;
}

export function addTestBalloon(
  state: SimState,
  ownerId: string,
  tx: number,
  ty: number,
  fuse: number,
  range: number,
): SimBalloon {
  const b: SimBalloon = {
    id: state.nextBalloonId++,
    ownerId,
    tx,
    ty,
    fuse,
    range,
    slideDir: null,
    slideProg: 0,
    slideTiles: 0,
    maxSlide: 0,
    revenge: false,
    bornTick: 0,
  };
  state.balloons.push(b);
  return b;
}

export function cloneState(state: SimState): SimState {
  return structuredClone(state);
}
