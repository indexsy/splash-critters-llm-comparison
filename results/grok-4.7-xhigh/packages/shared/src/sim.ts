import {
  CONFIG,
  type AnimalId,
  type Difficulty,
  type HatId,
  type Mode,
  type PowerupKind,
  type Theme,
} from './config.js';
import { generateMap } from './map.js';
import {
  DIR_VEC,
  Dir,
  Tile,
  edgeDist,
  idx,
  inBounds,
  type Balloon,
  type CreatePlayer,
  type GameState,
  type InputMap,
  type Player,
  type PlayerInput,
  type SimEvent,
} from './types.js';

export interface CreateGameOpts {
  mode: Mode;
  seed: number;
  theme: Theme;
  players: CreatePlayer[];
  revenge: boolean;
  roundsToWin: number;
  carry?: Player[];
}

export function freshStats(): Pick<
  Player,
  'speed' | 'balloonCount' | 'splashRange' | 'flippers' | 'hasKick' | 'passBalloonId'
> {
  return {
    speed: CONFIG.SPEED_BASE,
    balloonCount: CONFIG.BALLOON_BASE,
    splashRange: CONFIG.SPLASH_BASE,
    flippers: 0,
    hasKick: false,
    passBalloonId: '',
  };
}

export function createGameState(opts: CreateGameOpts): GameState {
  const map = generateMap({ mode: opts.mode, seed: opts.seed });
  const players: Player[] = opts.players
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((p, i) => {
      const spawn = map.spawns[Math.min(i, map.spawns.length - 1)];
      const prev = opts.carry?.find((c) => c.id === p.id);
      return {
        id: p.id,
        name: p.name,
        slot: p.slot,
        animal: p.animal,
        hat: p.hat,
        x: spawn.x + 0.5,
        y: spawn.y + 0.5,
        facing: p.slot % 2 === 0 ? Dir.Right : Dir.Left,
        alive: true,
        ...freshStats(),
        roundWins: prev?.roundWins ?? 0,
        soaks: prev?.soaks ?? 0,
        revengeSoaks: prev?.revengeSoaks ?? 0,
        castles: prev?.castles ?? 0,
        biggestChain: prev?.biggestChain ?? 0,
        survivedTicks: prev?.survivedTicks ?? 0,
        longestLife: prev?.longestLife ?? 0,
        roundAliveTicks: 0,
        isBot: p.isBot,
        difficulty: p.difficulty ?? null,
        ducking: false,
        duckT: 0,
        duckDir: 1,
        duckCooldown: CONFIG.REVENGE_COOLDOWN_TICKS,
        soakedBy: '',
      };
    });
  return {
    tick: 0,
    phase: 'playing',
    mode: opts.mode,
    theme: opts.theme,
    width: map.width,
    height: map.height,
    tiles: map.tiles,
    hidden: map.hidden,
    players,
    balloons: [],
    splashes: [],
    powerups: [],
    tideRing: 0,
    warmup: CONFIG.WARMUP_TICKS,
    revenge: opts.revenge,
    roundsToWin: opts.roundsToWin,
    winnerId: null,
    draw: false,
    over: false,
    events: [],
  };
}

export function blankState(w: number, h: number): GameState {
  const tiles = new Array(w * h).fill(Tile.Empty);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tiles[y * w + x] = Tile.Boulder;
    }
  }
  return {
    tick: 1000,
    phase: 'playing',
    mode: 'duel',
    theme: 'backyard',
    width: w,
    height: h,
    tiles,
    hidden: new Array(w * h).fill(null),
    players: [],
    balloons: [],
    splashes: [],
    powerups: [],
    tideRing: 0,
    warmup: 0,
    revenge: false,
    roundsToWin: 3,
    winnerId: null,
    draw: false,
    over: false,
    events: [],
  };
}

export function makePlayer(partial: Partial<Player> & { id: string; x: number; y: number }): Player {
  return {
    name: partial.name ?? partial.id,
    slot: partial.slot ?? 0,
    animal: (partial.animal ?? 'frog') as AnimalId,
    hat: (partial.hat ?? null) as HatId | null,
    facing: partial.facing ?? Dir.Down,
    alive: partial.alive ?? true,
    speed: partial.speed ?? CONFIG.SPEED_BASE,
    balloonCount: partial.balloonCount ?? 1,
    splashRange: partial.splashRange ?? 2,
    flippers: partial.flippers ?? 0,
    hasKick: partial.hasKick ?? false,
    passBalloonId: partial.passBalloonId ?? '',
    roundWins: partial.roundWins ?? 0,
    soaks: partial.soaks ?? 0,
    revengeSoaks: partial.revengeSoaks ?? 0,
    castles: partial.castles ?? 0,
    biggestChain: partial.biggestChain ?? 0,
    survivedTicks: partial.survivedTicks ?? 0,
    longestLife: partial.longestLife ?? 0,
    roundAliveTicks: partial.roundAliveTicks ?? 0,
    isBot: partial.isBot ?? false,
    difficulty: (partial.difficulty ?? null) as Difficulty | null,
    ducking: partial.ducking ?? false,
    duckT: partial.duckT ?? 0,
    duckDir: partial.duckDir ?? 1,
    duckCooldown: partial.duckCooldown ?? 0,
    soakedBy: partial.soakedBy ?? '',
    ...partial,
  };
}

export function tileAt(state: GameState, x: number, y: number): number {
  if (!inBounds(state.width, state.height, x, y)) return Tile.Boulder;
  return state.tiles[idx(state.width, x, y)];
}

export function balloonAt(state: GameState, x: number, y: number): Balloon | undefined {
  return state.balloons.find((b) => b.x === x && b.y === y);
}

export interface SplashCell {
  x: number;
  y: number;
  stopped: 'boulder' | 'castle' | 'balloon' | 'edge' | 'range' | null;
}

export function splashTiles(
  tiles: number[],
  w: number,
  h: number,
  balloons: { id: string; x: number; y: number }[],
  x: number,
  y: number,
  range: number,
  ignoreId = '',
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [{ x, y }];
  const dirs = [DIR_VEC[1], DIR_VEC[2], DIR_VEC[3], DIR_VEC[4]];
  for (const d of dirs) {
    for (let i = 1; i <= range; i++) {
      const tx = x + d.x * i;
      const ty = y + d.y * i;
      if (!inBounds(w, h, tx, ty)) break;
      const tile = tiles[idx(w, tx, ty)];
      if (tile === Tile.Boulder) break;
      out.push({ x: tx, y: ty });
      if (tile === Tile.Sandcastle) break;
      const bomb = balloons.find((b) => b.x === tx && b.y === ty && b.id !== ignoreId);
      if (bomb) break;
    }
  }
  return out;
}

export function applyPowerup(p: Player, kind: PowerupKind): void {
  if (kind === 'extra_balloon') p.balloonCount = Math.min(CONFIG.BALLOON_CAP, p.balloonCount + 1);
  else if (kind === 'big_splash') p.splashRange = Math.min(CONFIG.SPLASH_CAP, p.splashRange + 1);
  else if (kind === 'flippers') {
    p.flippers += 1;
    p.speed = Math.min(CONFIG.SPEED_CAP, CONFIG.SPEED_BASE + p.flippers * CONFIG.SPEED_PER_FLIPPER);
  } else if (kind === 'rubber_boots') {
    p.hasKick = true;
  }
}

function blockedTile(state: GameState, tx: number, ty: number, passId: string): boolean {
  if (!inBounds(state.width, state.height, tx, ty)) return true;
  const tile = state.tiles[idx(state.width, tx, ty)];
  if (tile === Tile.Boulder || tile === Tile.Sandcastle) return true;
  const b = balloonAt(state, tx, ty);
  if (b && b.id !== passId) return true;
  return false;
}

function freeAt(state: GameState, p: Player, x: number, y: number): boolean {
  const body = CONFIG.HITBOX;
  const samples: [number, number][] = [
    [x - body, y - body],
    [x + body, y - body],
    [x - body, y + body],
    [x + body, y + body],
  ];
  for (const [sx, sy] of samples) {
    if (blockedTile(state, Math.floor(sx), Math.floor(sy), p.passBalloonId)) return false;
  }
  for (const o of state.players) {
    if (o.id === p.id || !o.alive) continue;
    if (Math.abs(o.x - x) < CONFIG.PLAYER_SEPARATION && Math.abs(o.y - y) < CONFIG.PLAYER_SEPARATION) return false;
  }
  return true;
}

function approach(cur: number, target: number, max: number): number {
  const d = target - cur;
  if (Math.abs(d) <= max) return target;
  return cur + Math.sign(d) * max;
}

function tryKick(state: GameState, p: Player, dir: Dir): boolean {
  if (!CONFIG.ENABLE_KICK || !p.hasKick || dir === Dir.None) return false;
  const v = DIR_VEC[dir];
  const fx = Math.floor(p.x) + v.x;
  const fy = Math.floor(p.y) + v.y;
  const b = balloonAt(state, fx, fy);
  if (!b || b.id === p.passBalloonId || b.sliding) return false;
  const cross = v.x !== 0 ? Math.abs(p.y - (fy + 0.5)) : Math.abs(p.x - (fx + 0.5));
  if (cross > 0.48) return false;
  b.sliding = true;
  b.slideDir = dir;
  b.slideAcc = 0;
  state.events.push({ type: 'balloon_kicked', id: b.id, dir, by: p.id });
  p.facing = dir;
  return true;
}

function movePlayer(state: GameState, p: Player, dir: Dir): void {
  if (!p.alive || dir === Dir.None) return;
  p.facing = dir;
  const v = DIR_VEC[dir];
  const dist = p.speed / CONFIG.TICK_RATE;
  const step = (dx: number, dy: number) => {
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (!freeAt(state, p, nx, ny)) return false;
    p.x = nx;
    p.y = ny;
    return true;
  };
  if (step(v.x * dist, v.y * dist)) return;
  if (tryKick(state, p, dir)) return;
  if (v.x !== 0) {
    const center = Math.floor(p.y) + 0.5;
    const yy = approach(p.y, center, dist);
    if (yy !== p.y && freeAt(state, p, p.x, yy)) p.y = yy;
    step(v.x * dist, 0);
  } else if (v.y !== 0) {
    const center = Math.floor(p.x) + 0.5;
    const xx = approach(p.x, center, dist);
    if (xx !== p.x && freeAt(state, p, xx, p.y)) p.x = xx;
    step(0, v.y * dist);
  }
}

function bodyOverlapsTile(x: number, y: number, tx: number, ty: number): boolean {
  const b = CONFIG.HITBOX;
  return x + b > tx && x - b < tx + 1 && y + b > ty && y - b < ty + 1;
}

function updatePass(state: GameState, p: Player): void {
  if (!p.passBalloonId) return;
  const b = state.balloons.find((x) => x.id === p.passBalloonId);
  if (!b || !bodyOverlapsTile(p.x, p.y, b.x, b.y)) p.passBalloonId = '';
}

function tryPlace(state: GameState, p: Player, input: PlayerInput): void {
  if (!p.alive) return;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  if (!inBounds(state.width, state.height, tx, ty)) return;
  if (tileAt(state, tx, ty) !== Tile.Empty) return;
  if (balloonAt(state, tx, ty)) return;
  const active = state.balloons.filter((b) => b.ownerId === p.id).length;
  if (active >= p.balloonCount) return;
  const id = `${p.id}:${input.seq}`;
  if (state.balloons.some((b) => b.id === id)) return;
  const balloon: Balloon = {
    id,
    x: tx,
    y: ty,
    ownerId: p.id,
    fuse: CONFIG.FUSE_TICKS,
    range: p.splashRange,
    sliding: false,
    slideDir: Dir.None,
    slideAcc: 0,
    born: state.tick,
    revenge: false,
  };
  state.balloons.push(balloon);
  p.passBalloonId = id;
  state.events.push({ type: 'balloon_placed', id, x: tx, y: ty, ownerId: p.id });
}

function slideBlocked(state: GameState, tx: number, ty: number): boolean {
  if (!inBounds(state.width, state.height, tx, ty)) return true;
  const tile = tileAt(state, tx, ty);
  if (tile === Tile.Boulder || tile === Tile.Sandcastle) return true;
  if (balloonAt(state, tx, ty)) return true;
  for (const p of state.players) {
    if (!p.alive) continue;
    if (Math.floor(p.x) === tx && Math.floor(p.y) === ty) return true;
  }
  return false;
}

function advanceSlides(state: GameState): void {
  const step = CONFIG.KICK_TILES_PER_SEC / CONFIG.TICK_RATE;
  const list = state.balloons.slice().sort((a, b) => a.id.localeCompare(b.id));
  for (const b of list) {
    if (!b.sliding) continue;
    b.slideAcc += step;
    let guard = 0;
    while (b.slideAcc >= 1 && b.sliding && guard++ < 4) {
      const v = DIR_VEC[b.slideDir] ?? DIR_VEC[0];
      const nx = b.x + v.x;
      const ny = b.y + v.y;
      if (slideBlocked(state, nx, ny)) {
        b.sliding = false;
        b.slideAcc = 0;
        break;
      }
      b.slideAcc -= 1;
      b.x = nx;
      b.y = ny;
    }
  }
}

function eliminate(state: GameState, p: Player, by: string, revenge: boolean): void {
  if (!p.alive) return;
  p.alive = false;
  p.ducking = state.revenge;
  p.duckCooldown = CONFIG.REVENGE_COOLDOWN_TICKS;
  p.duckT = duckParam(state, p.x, p.y);
  p.duckDir = 1;
  p.soakedBy = by;
  p.longestLife = Math.max(p.longestLife, p.roundAliveTicks);
  if (by && by !== p.id && by !== 'tide') {
    const owner = state.players.find((o) => o.id === by);
    if (owner) {
      if (revenge) owner.revengeSoaks += 1;
      else owner.soaks += 1;
    }
  }
  state.events.push({ type: 'player_soaked', playerId: p.id, by, revenge });
}

function soakTile(state: GameState, tx: number, ty: number, by: string, revenge: boolean): void {
  for (const p of state.players) {
    if (!p.alive) continue;
    if (Math.floor(p.x) === tx && Math.floor(p.y) === ty) eliminate(state, p, by, revenge);
  }
}

function washCastle(state: GameState, x: number, y: number, by: string, revealed: Set<string>): void {
  const i = idx(state.width, x, y);
  if (state.tiles[i] !== Tile.Sandcastle) return;
  state.tiles[i] = Tile.Empty;
  const owner = state.players.find((p) => p.id === by);
  if (owner) owner.castles += 1;
  const kind = state.hidden[i];
  state.hidden[i] = null;
  state.events.push({ type: 'castle_washed', x, y, by });
  if (kind) {
    state.powerups.push({ x, y, kind });
    revealed.add(`${x},${y}`);
    state.events.push({ type: 'powerup_revealed', x, y, kind });
  }
}

function destroyPowerupAt(state: GameState, x: number, y: number, revealed: Set<string>): void {
  if (revealed.has(`${x},${y}`)) return;
  const i = state.powerups.findIndex((u) => u.x === x && u.y === y);
  if (i >= 0) state.powerups.splice(i, 1);
}

function resolveExplosions(state: GameState): void {
  const revealed = new Set<string>();
  const exploded = new Set<string>();
  const starters = state.balloons.filter((b) => b.fuse <= 0).map((b) => b.id);
  const pending = starters.slice();
  let guard = 0;
  while (pending.length && guard++ < 64) {
    const startId = pending.shift()!;
    if (exploded.has(startId)) continue;
    const queue = [startId];
    let count = 0;
    let originX = 0;
    let originY = 0;
    let starterOwner = '';
    let chainMax = 1;
    while (queue.length && guard++ < 500) {
      const id = queue.shift()!;
      if (exploded.has(id)) continue;
      const b = state.balloons.find((x) => x.id === id);
      if (!b) continue;
      exploded.add(id);
      if (count === 0) {
        originX = b.x;
        originY = b.y;
        starterOwner = b.ownerId;
      }
      count++;
      state.balloons = state.balloons.filter((x) => x.id !== id);
      for (const p of state.players) if (p.passBalloonId === id) p.passBalloonId = '';
      const cells = splashTiles(state.tiles, state.width, state.height, state.balloons, b.x, b.y, b.range, id);
      chainMax = Math.max(chainMax, count);
      for (const cell of cells) {
        state.splashes.push({
          x: cell.x,
          y: cell.y,
          ttl: CONFIG.SPLASH_LINGER_TICKS,
          ownerId: b.ownerId,
          chain: count,
          revenge: b.revenge,
        });
        if (tileAt(state, cell.x, cell.y) === Tile.Sandcastle) washCastle(state, cell.x, cell.y, b.ownerId, revealed);
        const other = balloonAt(state, cell.x, cell.y);
        if (other && !exploded.has(other.id) && !queue.includes(other.id)) queue.push(other.id);
        destroyPowerupAt(state, cell.x, cell.y, revealed);
        soakTile(state, cell.x, cell.y, b.ownerId, b.revenge);
      }
    }
    if (count >= 2) {
      state.events.push({ type: 'chain_burst', count, x: originX, y: originY, by: starterOwner });
      const starter = state.players.find((p) => p.id === starterOwner);
      if (starter && count > starter.biggestChain) starter.biggestChain = count;
    }
  }
}

function collectPowerups(state: GameState, p: Player): void {
  if (!p.alive) return;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  const i = state.powerups.findIndex((u) => u.x === tx && u.y === ty);
  if (i < 0) return;
  const u = state.powerups[i];
  state.powerups.splice(i, 1);
  applyPowerup(p, u.kind);
  state.events.push({ type: 'powerup_collected', x: tx, y: ty, kind: u.kind, playerId: p.id });
}

function dissolveCastle(state: GameState, x: number, y: number): void {
  const i = idx(state.width, x, y);
  if (state.tiles[i] !== Tile.Sandcastle) return;
  state.tiles[i] = Tile.Flood;
  state.hidden[i] = null;
  state.events.push({ type: 'castle_washed', x, y, by: 'tide' });
}

function applyTide(state: GameState): void {
  const start = CONFIG.TIDE_START_SEC * CONFIG.TICK_RATE + CONFIG.WARMUP_TICKS;
  if (state.tick < start) return;
  const interval = Math.max(1, Math.round(CONFIG.TIDE_INTERVAL_SEC * CONFIG.TICK_RATE));
  const ring = 1 + Math.floor((state.tick - start) / interval);
  while (state.tideRing < ring) {
    state.tideRing += 1;
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (edgeDist(x, y, state.width, state.height) > state.tideRing) continue;
        const t = tileAt(state, x, y);
        if (t === Tile.Boulder) continue;
        if (t === Tile.Sandcastle) dissolveCastle(state, x, y);
        else state.tiles[idx(state.width, x, y)] = Tile.Flood;
        const b = balloonAt(state, x, y);
        if (b) b.fuse = 0;
        soakTile(state, x, y, 'tide', false);
        const pi = state.powerups.findIndex((u) => u.x === x && u.y === y);
        if (pi >= 0) state.powerups.splice(pi, 1);
      }
    }
    state.events.push({ type: 'tide_advance', ring: state.tideRing });
  }
}

function lingerSoak(state: GameState): void {
  for (const s of state.splashes) soakTile(state, s.x, s.y, s.ownerId, !!s.revenge);
}

function floodSoak(state: GameState): void {
  for (const p of state.players) {
    if (!p.alive) continue;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    if (tileAt(state, tx, ty) === Tile.Flood) eliminate(state, p, 'tide', false);
  }
}

function perimLength(state: GameState): number {
  return 2 * (state.width + state.height) - 4;
}

function duckParam(state: GameState, x: number, y: number): number {
  const w = state.width;
  const h = state.height;
  const len = perimLength(state);
  let dist = 0;
  const fx = Math.max(0, Math.min(w - 1, Math.round(x)));
  const fy = Math.max(0, Math.min(h - 1, Math.round(y)));
  if (fy === 0) dist = fx;
  else if (fx === w - 1) dist = w - 1 + fy;
  else if (fy === h - 1) dist = w - 1 + h - 1 + (w - 1 - fx);
  else dist = w - 1 + h - 1 + w - 1 + (h - 1 - fy);
  return dist / len;
}

export function duckPosition(state: GameState, t: number): { x: number; y: number } {
  const w = state.width;
  const h = state.height;
  const len = perimLength(state);
  let d = ((t % 1) + 1) % 1;
  d *= len;
  if (d < w - 1) return { x: d, y: 0 };
  d -= w - 1;
  if (d < h - 1) return { x: w - 1, y: d };
  d -= h - 1;
  if (d < w - 1) return { x: w - 1 - d, y: h - 1 };
  d -= w - 1;
  return { x: 0, y: h - 1 - d };
}

function updateDuck(state: GameState, p: Player, input: PlayerInput | undefined): void {
  if (input) {
    if (input.dir === Dir.Right || input.dir === Dir.Down) p.duckDir = 1;
    else if (input.dir === Dir.Left || input.dir === Dir.Up) p.duckDir = -1;
  }
  const len = perimLength(state);
  p.duckT += (p.duckDir * CONFIG.DUCK_TILES_PER_SEC) / CONFIG.TICK_RATE / len;
  p.duckT = ((p.duckT % 1) + 1) % 1;
  if (p.duckCooldown > 0) p.duckCooldown -= 1;
  if (!input?.balloon || p.duckCooldown > 0) return;
  const pos = duckPosition(state, p.duckT);
  const cx = (state.width - 1) / 2;
  const cy = (state.height - 1) / 2;
  let dx = cx - pos.x;
  let dy = cy - pos.y;
  if (Math.abs(dx) > Math.abs(dy)) dy = 0;
  else dx = 0;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  let lx = Math.round(pos.x);
  let ly = Math.round(pos.y);
  let landed: { x: number; y: number } | null = null;
  for (let i = 1; i <= CONFIG.REVENGE_RANGE; i++) {
    const nx = lx + stepX * i;
    const ny = ly + stepY * i;
    if (!inBounds(state.width, state.height, nx, ny)) break;
    if (tileAt(state, nx, ny) === Tile.Boulder) break;
    landed = { x: nx, y: ny };
    if (tileAt(state, nx, ny) === Tile.Sandcastle) break;
  }
  if (!landed) return;
  if (balloonAt(state, landed.x, landed.y)) return;
  if (tileAt(state, landed.x, landed.y) !== Tile.Empty && tileAt(state, landed.x, landed.y) !== Tile.Flood) return;
  const id = `${p.id}:duck:${state.tick}`;
  state.balloons.push({
    id,
    x: landed.x,
    y: landed.y,
    ownerId: p.id,
    fuse: CONFIG.REVENGE_FUSE_TICKS,
    range: CONFIG.REVENGE_SPLASH,
    sliding: false,
    slideDir: Dir.None,
    slideAcc: 0,
    born: state.tick,
    revenge: true,
  });
  p.duckCooldown = CONFIG.REVENGE_COOLDOWN_TICKS;
  state.events.push({ type: 'revenge_lob', playerId: p.id, x: landed.x, y: landed.y });
}

function checkRoundEnd(state: GameState): void {
  if (state.over || state.phase !== 'playing' || state.warmup > 0) return;
  if (state.players.length < 2) return;
  const alive = state.players.filter((p) => p.alive);
  if (alive.length > 1) return;
  state.over = true;
  state.phase = 'round_end';
  if (alive.length === 1) {
    state.winnerId = alive[0].id;
    state.draw = false;
  } else {
    state.winnerId = null;
    state.draw = true;
  }
  state.events.push({ type: 'round_over', winnerId: state.winnerId });
}

function orderedPlayers(state: GameState): Player[] {
  const list = state.players.slice().sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id));
  if (list.length === 0) return list;
  const start = state.tick % list.length;
  return list.slice(start).concat(list.slice(0, start));
}

export function simulateTick(state: GameState, inputs: InputMap): GameState {
  state.events = [];
  if (state.over || state.phase === 'round_end') return state;
  if (state.warmup > 0) {
    state.warmup -= 1;
    state.tick += 1;
    return state;
  }

  const order = orderedPlayers(state);
  for (const p of order) {
    const input = inputs[p.id];
    if (p.ducking) {
      updateDuck(state, p, input);
      continue;
    }
    if (!p.alive) continue;
    if (input?.balloon) tryPlace(state, p, input);
  }
  for (const p of order) {
    if (!p.alive || p.ducking) continue;
    const dir = (inputs[p.id]?.dir ?? Dir.None) as Dir;
    if (dir >= 0 && dir <= 4) movePlayer(state, p, dir);
    updatePass(state, p);
  }

  advanceSlides(state);

  for (const b of state.balloons) {
    if (b.born !== state.tick) b.fuse -= 1;
  }
  resolveExplosions(state);

  for (const p of state.players) collectPowerups(state, p);

  applyTide(state);
  if (state.balloons.some((b) => b.fuse <= 0)) resolveExplosions(state);
  floodSoak(state);
  lingerSoak(state);

  for (const s of state.splashes) s.ttl -= 1;
  state.splashes = state.splashes.filter((s) => s.ttl > 0);

  for (const p of state.players) {
    if (p.alive) {
      p.survivedTicks += 1;
      p.roundAliveTicks += 1;
    }
  }

  checkRoundEnd(state);
  state.tick += 1;
  return state;
}

export function hashState(state: GameState): string {
  const players = state.players
    .map(
      (p) =>
        `${p.id}:${p.x.toFixed(4)}:${p.y.toFixed(4)}:${p.alive ? 1 : 0}:${p.speed.toFixed(2)}:${p.balloonCount}:${p.splashRange}:${p.hasKick ? 1 : 0}:${p.roundWins}:${p.soaks}`,
    )
    .join('|');
  const balloons = state.balloons
    .map((b) => `${b.id}:${b.x}:${b.y}:${b.fuse}:${b.sliding ? 1 : 0}:${b.slideAcc.toFixed(3)}`)
    .join('|');
  const splashes = state.splashes.map((s) => `${s.x}:${s.y}:${s.ttl}`).join('|');
  const ups = state.powerups.map((u) => `${u.x}:${u.y}:${u.kind}`).join('|');
  return `${state.tick};${state.tiles.join(',')};${players};${balloons};${splashes};${ups};${state.tideRing};${state.over ? 1 : 0}`;
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

export function playTicks(state: GameState): number {
  return Math.max(0, state.tick - CONFIG.WARMUP_TICKS);
}

export function emptyInput(tick = 0): PlayerInput {
  return { seq: 0, tick, dir: Dir.None, balloon: false };
}

export type { SimEvent };
