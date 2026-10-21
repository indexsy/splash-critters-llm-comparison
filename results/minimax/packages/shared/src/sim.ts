import { CONFIG } from './config.js';
import {
  generateArena,
  idx,
  isBoulderTile,
  perimeterPath,
  spawnPointsFor,
} from './map.js';
import { DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP } from './types.js';
import type {
  AnimalId,
  Arena,
  Balloon,
  DuckState,
  Facing,
  GameState,
  HatId,
  MatchConfig,
  Mode,
  PlayerInput,
  PlayerState,
  PowerupId,
  SimEvent,
  Splash,
  Theme,
} from './types.js';

const DIR_VECTORS: { x: number; y: number }[] = [
  { x: 0, y: -1 }, // up
  { x: 1, y: 0 }, // right
  { x: 0, y: 1 }, // down
  { x: -1, y: 0 }, // left
];

const BIT_TO_VEC: Record<number, { x: number; y: number }> = {
  [DIR_UP]: DIR_VECTORS[0],
  [DIR_RIGHT]: DIR_VECTORS[1],
  [DIR_DOWN]: DIR_VECTORS[2],
  [DIR_LEFT]: DIR_VECTORS[3],
};

/** facing: 0 down, 1 up, 2 left, 3 right */
function facingFromDir(dir: number): Facing {
  if (dir & DIR_DOWN) return 0;
  if (dir & DIR_UP) return 1;
  if (dir & DIR_LEFT) return 2;
  if (dir & DIR_RIGHT) return 3;
  return 0;
}

export interface CreateMatchOptions {
  mode: Mode;
  roundsToWin?: number;
  theme?: Theme;
  seed: number;
  players: { animal: AnimalId; hat: HatId }[];
  revengeDucks?: boolean;
  enableKick?: boolean;
}

export function createMatchState(opts: CreateMatchOptions): GameState {
  const grid = CONFIG.GRID[opts.mode];
  const spawns = spawnPointsFor(opts.mode, grid.width, grid.height);
  const arena: Arena = {
    width: grid.width,
    height: grid.height,
    theme: opts.theme ?? 'backyard',
    seed: opts.seed >>> 0,
    castles: new Array(grid.width * grid.height).fill(0),
    contents: new Array(grid.width * grid.height).fill(null),
  };
  const players: PlayerState[] = opts.players.map((p, i) => {
    const spawn = spawns[i % spawns.length];
    return {
      id: i,
      animal: p.animal,
      hat: p.hat,
      alive: true,
      x: spawn.x,
      y: spawn.y,
      facing: 0,
      moving: false,
      dir: 0,
      speed: CONFIG.SPEED_BASE,
      balloonCount: CONFIG.BALLOON_COUNT_BASE,
      splashRange: CONFIG.SPLASH_RANGE_BASE,
      flippers: 0,
      hasBoots: false,
      bootsUsed: false,
      roundWins: 0,
      soaks: 0,
      revengeSoaks: 0,
      castlesWashed: 0,
      biggestChain: 0,
      survivalTicks: 0,
      roundSurvivalTicks: 0,
      eliminatedAtTick: -1,
      duck: null,
      isBot: false,
      lastSeq: 0,
      dropRequest: false,
    };
  });

  return {
    tick: 0,
    arena,
    players,
    balloons: [],
    splashes: [],
    exposed: [],
    phase: 'countdown',
    roundNo: 0,
    roundsToWin: opts.roundsToWin ?? CONFIG.DEFAULT_ROUNDS_TO_WIN,
    countdown: 90,
    tideRing: -1,
    tideStartTick: CONFIG.TIDE_START_TICK,
    timeLeft: CONFIG.ROUND_HARD_LIMIT_TICKS,
    events: [],
    nextEntityId: 1,
    rngState: opts.seed >>> 0,
    revengeDucks: opts.revengeDucks ?? CONFIG.ENABLE_REVENGE_DUCKS,
    enableKick: opts.enableKick ?? CONFIG.ENABLE_KICK,
    lastSoaked: [],
  };
}

/**
 * Resets the world for a new round: fresh arena from `mapSeed`, players back
 * on their spawn tiles, all balloons/splashes/power-ups cleared.
 */
export function beginRound(
  state: GameState,
  roundNo: number,
  mapSeed: number,
  theme: Theme,
): void {
  const spawns = spawnPointsFor(state.players.length <= 2 ? 'duel' : 'ffa', state.arena.width, state.arena.height);
  const arena = generateArena({
    width: state.arena.width,
    height: state.arena.height,
    seed: mapSeed,
    theme,
    spawns,
  });
  state.arena = arena;
  state.roundNo = roundNo;
  state.tick = 0;
  state.balloons.length = 0;
  state.splashes.length = 0;
  state.exposed.length = 0;
  state.tideRing = -1;
  state.tideStartTick = CONFIG.TIDE_START_TICK;
  state.timeLeft = CONFIG.ROUND_HARD_LIMIT_TICKS;
  state.countdown = 90;
  state.phase = 'countdown';
  state.lastSoaked = [];
  state.rngState = mapSeed >>> 0;

  state.players.forEach((p, i) => {
    const spawn = spawns[i % spawns.length];
    p.x = spawn.x;
    p.y = spawn.y;
    p.facing = 0;
    p.moving = false;
    p.dir = 0;
    p.alive = true;
    p.duck = null;
    p.bootsUsed = false;
    p.dropRequest = false;
    p.lastSeq = 0;
    p.roundSurvivalTicks = 0;
    p.eliminatedAtTick = -1;
  });
}

// ---------------------------------------------------------------------------
// tile helpers
// ---------------------------------------------------------------------------

export function tileIndex(state: GameState, x: number, y: number): number {
  return idx(state.arena.width, x, y);
}

export function castleAt(state: GameState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.arena.width || y >= state.arena.height) return false;
  return state.arena.castles[idx(state.arena.width, x, y)] === 1;
}

export function balloonAt(state: GameState, x: number, y: number): Balloon | undefined {
  for (const b of state.balloons) if (b.x === x && b.y === y) return b;
  return undefined;
}

export function playerTile(player: PlayerState): { x: number; y: number } {
  return { x: Math.floor(player.x), y: Math.floor(player.y) };
}

export function playerAtTile(
  state: GameState,
  x: number,
  y: number,
  exceptId = -1,
): PlayerState | undefined {
  for (const p of state.players) {
    if (!p.alive || p.id === exceptId) continue;
    const t = playerTile(p);
    if (t.x === x && t.y === y) return p;
  }
  return undefined;
}

/** A tile is walkable when it holds no boulder, no sandcastle and no balloon. */
export function tileWalkable(
  state: GameState,
  x: number,
  y: number,
  exceptPlayerId = -1,
): boolean {
  if (isBoulderTile(x, y, state.arena.width, state.arena.height)) return false;
  if (castleAt(state, x, y)) return false;
  if (balloonAt(state, x, y)) return false;
  if (playerAtTile(state, x, y, exceptPlayerId)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// simulation
// ---------------------------------------------------------------------------

export interface TickResult {
  roundEnded: boolean;
  winners: number[];
  draw: boolean;
}

/**
 * Advances the simulation by exactly one tick. The function is deterministic:
 * the same state + same inputs always produce the same result, which lets the
 * server stay authoritative while the client predicts locally.
 */
export function simulateTick(state: GameState, inputs: PlayerInput[]): TickResult {
  const result: TickResult = { roundEnded: false, winners: [], draw: false };
  if (state.phase === 'round_over' || state.phase === 'match_over') return result;

  state.events.length = 0;
  state.lastSoaked.length = 0;
  state.tick += 1;
  state.timeLeft = Math.max(0, CONFIG.ROUND_HARD_LIMIT_TICKS - state.tick);

  // 1. consume inputs
  for (const input of inputs) {
    const p = state.players[input.playerId];
    if (!p) continue;
    if (input.seq > p.lastSeq) p.lastSeq = input.seq;
    p.dir = input.dir;
    if (input.balloon) p.dropRequest = true;
  }

  // 2. countdown -> running
  if (state.phase === 'countdown') {
    state.countdown -= 1;
    if (state.countdown <= 0) state.phase = 'running';
  }

  const running = state.phase === 'running';

  // 3. balloon drops happen on the tile that is occupied right now, the
  //    player is free to walk off it afterwards.
  for (const p of state.players) {
    if (!p.dropRequest) continue;
    p.dropRequest = false;
    if (!p.alive || !running) continue;
    placeBalloon(state, p, false);
  }

  // 4. movement
  const dt = 1 / CONFIG.TICK_RATE;
  for (const p of state.players) {
    if (!p.alive) continue;
    movePlayer(state, p, dt);
    if (running && p.alive) {
      p.survivalTicks += 1;
      p.roundSurvivalTicks += 1;
    }
  }

  // 5. kicked balloons slide
  for (const b of state.balloons) {
    if (b.sliding) stepSlidingBalloon(state, b);
  }

  // 6. fuses + burst cascade
  for (const b of state.balloons) b.fuse -= 1;
  resolveBursts(state);

  // 7. lingering splash damage
  applyLingeringSplashes(state);

  // 8. rising tide
  if (running) applyTide(state);

  // 9. exposed power-ups
  collectPowerups(state);

  // 10. revenge ducks
  if (running && state.revengeDucks) updateDucks(state);

  // 11. round end
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    const winners = alive.map((p) => p.id);
    const draw = winners.length === 0;
    if (draw) {
      // Everyone was soaked on the same tick: the survivors share the round.
      for (const id of state.lastSoaked) {
        const p = state.players[id];
        if (p) p.roundWins += 1;
      }
    } else {
      for (const id of winners) {
        const p = state.players[id];
        if (p) p.roundWins += 1;
      }
    }
    state.phase = 'round_over';
    state.events.push({ t: 'round_end', winners, draw });
    result.roundEnded = true;
    result.winners = winners;
    result.draw = draw;
  } else if (state.timeLeft <= 0) {
    for (const p of alive) p.roundWins += 1;
    state.phase = 'round_over';
    state.events.push({ t: 'round_end', winners: alive.map((p) => p.id), draw: alive.length > 1 });
    result.roundEnded = true;
    result.winners = alive.map((p) => p.id);
    result.draw = alive.length > 1;
  }

  return result;
}

/**
 * Can the player stand on that tile? Balloons are solid, but the owner of a
 * balloon may still walk off the tile it was dropped on.
 */
function canPlayerStand(
  state: GameState,
  p: PlayerState,
  tx: number,
  ty: number,
  currentTile: { x: number; y: number },
): boolean {
  if (isBoulderTile(tx, ty, state.arena.width, state.arena.height)) return false;
  if (castleAt(state, tx, ty)) return false;
  if (playerAtTile(state, tx, ty, p.id)) return false;
  const balloon = balloonAt(state, tx, ty);
  if (balloon) {
    const ownTile = balloon.owner === p.id && currentTile.x === tx && currentTile.y === ty;
    if (!ownTile) return false;
  }
  return true;
}

function movePlayer(state: GameState, p: PlayerState, dt: number): void {
  let vx = 0;
  let vy = 0;
  if (p.dir & DIR_LEFT) vx -= 1;
  if (p.dir & DIR_RIGHT) vx += 1;
  if (p.dir & DIR_UP) vy -= 1;
  if (p.dir & DIR_DOWN) vy += 1;
  if (vx === 0 && vy === 0) {
    p.moving = false;
    return;
  }
  const len = Math.hypot(vx, vy) || 1;
  const step = (p.speed * dt) / len;
  const dx = vx * step;
  const dy = vy * step;
  p.moving = true;
  p.facing = facingFromDir(p.dir);

  const startX = p.x;
  const startY = p.y;
  const currentTile = playerTile(p);

  // X axis first so the player slides along walls.
  const nx = p.x + dx;
  if (canPlayerStand(state, p, Math.floor(nx), Math.floor(p.y), currentTile)) {
    p.x = nx;
  } else {
    tryKick(state, p, Math.floor(nx), Math.floor(p.y), dx > 0 ? DIR_RIGHT : DIR_LEFT);
  }

  const ny = p.y + dy;
  if (canPlayerStand(state, p, Math.floor(p.x), Math.floor(ny), currentTile)) {
    p.y = ny;
  } else {
    tryKick(state, p, Math.floor(p.x), Math.floor(ny), dy > 0 ? DIR_DOWN : DIR_UP);
  }

  if (p.x === startX && p.y === startY) p.moving = false;
}

function tryKick(state: GameState, p: PlayerState, tx: number, ty: number, dirBit: number): void {
  if (!state.enableKick) return;
  if (!p.hasBoots || p.bootsUsed) return;
  const target = balloonAt(state, tx, ty);
  if (!target) return;
  p.bootsUsed = true;
  target.sliding = true;
  target.slideDir = dirBit;
  target.slideCooldown = 0;
  state.events.push({ t: 'balloon_kicked', x: target.x, y: target.y, dir: dirBit, by: p.id });
}

function stepSlidingBalloon(state: GameState, b: Balloon): void {
  b.slideCooldown -= 1;
  if (b.slideCooldown > 0) return;
  b.slideCooldown = CONFIG.KICK_STEP_TICKS;
  const vec = BIT_TO_VEC[b.slideDir];
  if (!vec) {
    b.sliding = false;
    return;
  }
  const nx = b.x + vec.x;
  const ny = b.y + vec.y;
  const blocked =
    isBoulderTile(nx, ny, state.arena.width, state.arena.height) ||
    castleAt(state, nx, ny) ||
    !!balloonAt(state, nx, ny) ||
    !!playerAtTile(state, nx, ny);
  if (blocked) {
    b.sliding = false;
    return;
  }
  b.x = nx;
  b.y = ny;
}

function placeBalloon(state: GameState, p: PlayerState, revenge: boolean): boolean {
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  if (isBoulderTile(tx, ty, state.arena.width, state.arena.height)) return false;
  if (castleAt(state, tx, ty)) return false;
  if (balloonAt(state, tx, ty)) return false;
  if (!revenge) {
    const owned = state.balloons.filter((b) => b.owner === p.id).length;
    if (owned >= p.balloonCount) return false;
  }
  state.balloons.push({
    id: state.nextEntityId++,
    owner: p.id,
    x: tx,
    y: ty,
    fuse: CONFIG.BALLOON_FUSE_TICKS,
    range: p.splashRange,
    revenge,
    sliding: false,
    slideDir: 0,
    slideCooldown: 0,
  });
  state.events.push({ t: 'balloon_placed', x: tx, y: ty, owner: p.id, revenge });
  return true;
}

/** Resolves every balloon whose fuse expired, including full chain cascades. */
function resolveBursts(state: GameState): void {
  const ready = state.balloons.filter((b) => b.fuse <= 0);
  if (ready.length === 0) return;

  const queue: { balloon: Balloon; depth: number }[] = ready.map((b) => ({ balloon: b, depth: 1 }));
  const queued = new Set<number>(ready.map((b) => b.id));
  const processed = new Set<number>();

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const { balloon, depth } = item;
    if (processed.has(balloon.id)) continue;
    processed.add(balloon.id);
    if (depth > CONFIG.CHAIN_MAX_DEPTH) continue;

    removeBalloon(state, balloon.id);
    const triggered = burstBalloon(state, balloon, depth);

    const owner = state.players[balloon.owner];
    if (owner && depth > owner.biggestChain) owner.biggestChain = depth;
    if (depth >= 2) {
      state.events.push({
        t: 'chain_burst',
        depth,
        x: balloon.x,
        y: balloon.y,
        owner: balloon.owner,
      });
    }

    for (const other of triggered) {
      if (queued.has(other.id) || processed.has(other.id)) continue;
      queued.add(other.id);
      queue.push({ balloon: other, depth: depth + 1 });
    }
  }
}

function removeBalloon(state: GameState, id: number): void {
  const i = state.balloons.findIndex((b) => b.id === id);
  if (i >= 0) state.balloons.splice(i, 1);
}

/** Applies one burst. Returns the balloons caught by the splash. */
function burstBalloon(state: GameState, b: Balloon, depth: number): Balloon[] {
  const w = state.arena.width;
  const h = state.arena.height;
  const lens: [number, number, number, number] = [0, 0, 0, 0];
  const triggered: Balloon[] = [];

  // The centre of the cross soaks whoever is standing on the balloon.
  const centreVictim = playerAtTile(state, b.x, b.y);
  if (centreVictim) soakPlayer(state, centreVictim, b.owner, b.x, b.y, b.revenge);

  for (let d = 0; d < 4; d++) {
    const vec = DIR_VECTORS[d];
    for (let step = 1; step <= b.range; step++) {
      const tx = b.x + vec.x * step;
      const ty = b.y + vec.y * step;
      if (isBoulderTile(tx, ty, w, h)) break;
      lens[d] = step;

      if (castleAt(state, tx, ty)) {
        washCastle(state, tx, ty, b.owner, depth);
        break; // the splash stops at the first sandcastle in this direction
      }

      const other = balloonAt(state, tx, ty);
      if (other && other.id !== b.id) triggered.push(other);

      const ex = state.exposed.find((e) => e.x === tx && e.y === ty);
      if (ex) {
        state.exposed.splice(state.exposed.indexOf(ex), 1);
      }

      const victim = playerAtTile(state, tx, ty);
      if (victim) {
        soakPlayer(state, victim, b.owner, tx, ty, b.revenge);
      }
    }
  }

  const splash: Splash = {
    id: state.nextEntityId++,
    x: b.x,
    y: b.y,
    lens,
    ticks: CONFIG.SPLASH_LINGER_TICKS,
    depth,
    owner: b.owner,
    revenge: b.revenge,
  };
  state.splashes.push(splash);
  return triggered;
}

function washCastle(state: GameState, x: number, y: number, owner: number, depth: number): void {
  const i = idx(state.arena.width, x, y);
  if (!state.arena.castles[i]) return;
  state.arena.castles[i] = 0;
  const content = state.arena.contents[i];
  state.arena.contents[i] = null;
  state.events.push({ t: 'castle_washed', x, y, owner, depth });
  const p = state.players[owner];
  if (p) p.castlesWashed += 1;
  if (content) {
    state.exposed.push({ id: state.nextEntityId++, x, y, kind: content });
    state.events.push({ t: 'powerup_revealed', x, y, kind: content });
  }
}

/**
 * The lingering splash is purely visual: the damage is dealt on the burst tick
 * itself. Keeping it non lethal lets revealed power-ups be collected from the
 * tile the water just washed.
 */
function applyLingeringSplashes(state: GameState): void {
  for (let i = state.splashes.length - 1; i >= 0; i--) {
    const s = state.splashes[i];
    s.ticks -= 1;
    if (s.ticks <= 0) state.splashes.splice(i, 1);
  }
}

function applyTide(state: GameState): void {
  if (state.tick < state.tideStartTick) return;
  const elapsed = state.tick - state.tideStartTick;
  const ring = Math.floor(elapsed / CONFIG.TIDE_INTERVAL_TICKS);
  if (ring > state.tideRing) {
    state.tideRing = ring;
    state.events.push({ t: 'tide_advance', ring });
  }
  const w = state.arena.width;
  const h = state.arena.height;
  for (const p of state.players) {
    if (!p.alive) continue;
    const t = playerTile(p);
    const r = Math.min(t.x, t.y, w - 1 - t.x, h - 1 - t.y);
    if (r <= state.tideRing) {
      soakPlayer(state, p, -1, t.x, t.y, false);
    }
  }
  // Dissolve sandcastles swallowed by the rising water.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (r > state.tideRing) continue;
      const i = idx(w, x, y);
      if (state.arena.castles[i]) {
        state.arena.castles[i] = 0;
        state.arena.contents[i] = null;
      }
    }
  }
}

function collectPowerups(state: GameState): void {
  for (let i = state.exposed.length - 1; i >= 0; i--) {
    const e = state.exposed[i];
    const p = playerAtTile(state, e.x, e.y);
    if (!p) continue;
    state.exposed.splice(i, 1);
    applyPowerup(p, e.kind);
    state.events.push({ t: 'powerup_collected', x: e.x, y: e.y, kind: e.kind, player: p.id });
  }
}

export function applyPowerup(p: PlayerState, kind: PowerupId): void {
  switch (kind) {
    case 'extra_balloon':
      p.balloonCount = Math.min(CONFIG.BALLOON_COUNT_CAP, p.balloonCount + 1);
      break;
    case 'big_splash':
      p.splashRange = Math.min(CONFIG.SPLASH_RANGE_CAP, p.splashRange + 1);
      break;
    case 'flippers':
      p.flippers += 1;
      p.speed = Math.min(CONFIG.SPEED_CAP, CONFIG.SPEED_BASE + p.flippers * CONFIG.SPEED_PER_FLIPPER);
      break;
    case 'boots':
      p.hasBoots = true;
      p.bootsUsed = false;
      break;
  }
}

function soakPlayer(
  state: GameState,
  victim: PlayerState,
  by: number,
  x: number,
  y: number,
  revenge: boolean,
): void {
  if (!victim.alive) return;
  victim.alive = false;
  victim.moving = false;
  victim.eliminatedAtTick = state.tick;
  state.lastSoaked.push(victim.id);
  if (by >= 0 && by !== victim.id) {
    const killer = state.players[by];
    if (killer) {
      killer.soaks += 1;
      if (revenge) killer.revengeSoaks += 1;
    }
  }
  state.events.push({ t: 'player_soaked', player: victim.id, by, x, y, revenge });
  if (state.revengeDucks) {
    const path = perimeterPath(state.arena.width, state.arena.height);
    const duck: DuckState = {
      x: path[0]?.x ?? 0,
      y: path[0]?.y ?? 0,
      dist: 0,
      dir: 0,
      cooldown: CONFIG.REVENGE_INTERVAL_TICKS,
    };
    victim.duck = duck;
  }
}

function updateDucks(state: GameState): void {
  const path = perimeterPath(state.arena.width, state.arena.height);
  if (path.length === 0) return;
  const step = (CONFIG.REVENGE_DUCK_SPEED * 1) / CONFIG.TICK_RATE;
  for (const p of state.players) {
    const duck = p.duck;
    if (!duck) continue;
    duck.dist += step;
    const len = path.length;
    const i = Math.floor(duck.dist) % len;
    const j = (i + 1) % len;
    const frac = duck.dist - Math.floor(duck.dist);
    duck.x = path[i].x + (path[j].x - path[i].x) * frac;
    duck.y = path[i].y + (path[j].y - path[i].y) * frac;
    duck.dir = Math.abs(path[j].x - path[i].x) > 0 ? (path[j].x > path[i].x ? 3 : 2) : path[j].y > path[i].y ? 0 : 1;

    duck.cooldown -= 1;
    if (duck.cooldown > 0) continue;
    duck.cooldown = CONFIG.REVENGE_INTERVAL_TICKS;

    const vec = DIR_VECTORS[duck.dir];
    let tx = Math.floor(duck.x);
    let ty = Math.floor(duck.y);
    for (let s = 0; s < CONFIG.REVENGE_RANGE; s++) {
      const cx = tx + vec.x;
      const cy = ty + vec.y;
      if (isBoulderTile(cx, cy, state.arena.width, state.arena.height)) break;
      if (castleAt(state, cx, cy)) break;
      if (balloonAt(state, cx, cy)) break;
      tx = cx;
      ty = cy;
    }
    if (tx === Math.floor(duck.x) && ty === Math.floor(duck.y)) continue;
    const balloon: Balloon = {
      id: state.nextEntityId++,
      owner: p.id,
      x: tx,
      y: ty,
      fuse: CONFIG.BALLOON_FUSE_TICKS,
      range: p.splashRange,
      revenge: true,
      sliding: false,
      slideDir: 0,
      slideCooldown: 0,
    };
    state.balloons.push(balloon);
    state.events.push({ t: 'revenge_lob', x: tx, y: ty, dir: duck.dir, player: p.id });
  }
}

// ---------------------------------------------------------------------------
// helpers used by the server (bot brain, results)
// ---------------------------------------------------------------------------

/** Tiles covered by a splash, given its burst-time lens. */
export function splashTiles(s: Splash): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let d = 0; d < 4; d++) {
    const vec = DIR_VECTORS[d];
    for (let step = 1; step <= s.lens[d]; step++) {
      out.push({ x: s.x + vec.x * step, y: s.y + vec.y * step });
    }
  }
  return out;
}

export function matchConfig(state: GameState, ranked: boolean): MatchConfig {
  return {
    mode: state.players.length <= 2 ? 'duel' : 'ffa',
    roundsToWin: state.roundsToWin,
    theme: state.arena.theme,
    ranked,
    enableRevengeDucks: state.revengeDucks,
    enableKick: state.enableKick,
  };
}
