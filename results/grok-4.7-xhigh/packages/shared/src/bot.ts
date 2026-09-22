import { CONFIG, type Difficulty } from './config.js';
import {
  arriveUnsafe,
  bfsPath,
  computeDanger,
  findSafeTile,
  hitAt,
  mustFlee,
  thinkInterval,
  ticksPerTile,
  walkable,
  type DangerMap,
} from './danger.js';
import { mulberry32 } from './rng.js';
import { splashTiles, tileAt } from './sim.js';
import { DIR_VEC, Dir, Tile, type GameState, type Player, type PlayerInput } from './types.js';

export interface BotMemory {
  nextThink: number;
  path: { x: number; y: number }[];
  place: boolean;
  rng: () => number;
  stuck: number;
  lastX: number;
  lastY: number;
  wanderDir: Dir;
  wanderUntil: number;
}

export function createBotMemory(seed: number): BotMemory {
  return {
    nextThink: 0,
    path: [],
    place: false,
    rng: mulberry32(seed || 1),
    stuck: 0,
    lastX: -1,
    lastY: -1,
    wanderDir: Dir.None,
    wanderUntil: 0,
  };
}

function centered(p: Player): boolean {
  return Math.abs(p.x - (Math.floor(p.x) + 0.5)) < 0.18 && Math.abs(p.y - (Math.floor(p.y) + 0.5)) < 0.18;
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function dirToward(p: Player, tile: { x: number; y: number }): Dir {
  const dx = tile.x + 0.5 - p.x;
  const dy = tile.y + 0.5 - p.y;
  if (Math.abs(dx) < 0.06 && Math.abs(dy) < 0.06) return Dir.None;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? Dir.Right : Dir.Left;
  return dy > 0 ? Dir.Down : Dir.Up;
}

function follow(p: Player, mem: BotMemory): Dir {
  const cx = Math.floor(p.x);
  const cy = Math.floor(p.y);
  while (
    mem.path.length &&
    mem.path[0].x === cx &&
    mem.path[0].y === cy &&
    Math.abs(p.x - (cx + 0.5)) < 0.16 &&
    Math.abs(p.y - (cy + 0.5)) < 0.16
  ) {
    mem.path.shift();
  }
  if (!mem.path.length) return Dir.None;
  const n = mem.path[0];
  if (Math.abs(n.x - cx) + Math.abs(n.y - cy) > 1) {
    mem.path = [];
    return Dir.None;
  }
  return dirToward(p, n);
}

function hypoDanger(state: GameState, me: Player): DangerMap {
  const tx = Math.floor(me.x);
  const ty = Math.floor(me.y);
  return computeDanger({
    ...state,
    balloons: state.balloons.concat({
      id: `hypo:${me.id}`,
      x: tx,
      y: ty,
      ownerId: me.id,
      fuse: CONFIG.FUSE_TICKS,
      range: me.splashRange,
      sliding: false,
      slideDir: Dir.None,
      slideAcc: 0,
      born: state.tick - 1,
      revenge: false,
    }),
  });
}

function escapeAfterPlace(state: GameState, me: Player): { x: number; y: number }[] | null {
  if (!walkable(state, Math.floor(me.x), Math.floor(me.y), me.passBalloonId) && tileAt(state, Math.floor(me.x), Math.floor(me.y)) !== Tile.Empty) {
    return null;
  }
  if (state.balloons.some((b) => b.x === Math.floor(me.x) && b.y === Math.floor(me.y))) return null;
  const danger = hypoDanger(state, me);
  const safe = findSafeTile(state, me, danger);
  if (!safe) return null;
  const path = bfsPath(state, me, safe, danger, true);
  if (!path.length && (safe.x !== Math.floor(me.x) || safe.y !== Math.floor(me.y))) return null;
  const travel = Math.max(1, path.length) * ticksPerTile(me.speed);
  const h = hitAt(danger, Math.floor(me.x), Math.floor(me.y));
  if (h >= 0 && travel + 1 >= h) return null;
  if (path.length === 0) return null;
  return path;
}

function wouldHit(state: GameState, me: Player, ex: number, ey: number, predict: boolean, facing: number): boolean {
  const tx = Math.floor(me.x);
  const ty = Math.floor(me.y);
  const cells = splashTiles(state.tiles, state.width, state.height, state.balloons, tx, ty, me.splashRange);
  if (cells.some((c) => c.x === ex && c.y === ey)) return true;
  if (predict && facing) {
    const v = DIR_VEC[facing];
    const px = ex + v.x * 2;
    const py = ey + v.y * 2;
    if (cells.some((c) => c.x === px && c.y === py)) return true;
  }
  return false;
}

function findStand(
  state: GameState,
  me: Player,
  tx: number,
  ty: number,
  danger: DangerMap,
): { x: number; y: number } | null {
  const mx = Math.floor(me.x);
  const my = Math.floor(me.y);
  let best: { x: number; y: number } | null = null;
  let bestD = 1e9;
  for (let i = 1; i <= me.splashRange; i++) {
    for (const d of [1, 2, 3, 4]) {
      const v = DIR_VEC[d];
      const sx = tx - v.x * i;
      const sy = ty - v.y * i;
      if (!walkable(state, sx, sy)) continue;
      const cells = splashTiles(state.tiles, state.width, state.height, state.balloons, sx, sy, me.splashRange);
      if (!cells.some((c) => c.x === tx && c.y === ty)) continue;
      const arrive = manhattan(mx, my, sx, sy) * ticksPerTile(me.speed);
      if (arriveUnsafe(danger, sx, sy, arrive)) continue;
      const dist = manhattan(mx, my, sx, sy);
      if (dist < bestD) {
        bestD = dist;
        best = { x: sx, y: sy };
      }
    }
  }
  return best;
}

function nearestCastle(state: GameState, x: number, y: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = 1e9;
  for (let ty = 1; ty < state.height - 1; ty++) {
    for (let tx = 1; tx < state.width - 1; tx++) {
      if (tileAt(state, tx, ty) !== Tile.Sandcastle) continue;
      const d = manhattan(x, y, tx, ty);
      if (d < bestD) {
        bestD = d;
        best = { x: tx, y: ty };
      }
    }
  }
  return best;
}

function ownLethal(state: GameState, me: Player, danger: DangerMap): boolean {
  const tx = Math.floor(me.x);
  const ty = Math.floor(me.y);
  for (const b of state.balloons) {
    if (b.ownerId !== me.id) continue;
    const cells = splashTiles(state.tiles, state.width, state.height, state.balloons, b.x, b.y, b.range, b.id);
    if (cells.some((c) => c.x === tx && c.y === ty) && hitAt(danger, tx, ty) >= 0) return true;
  }
  return false;
}

function clampDir(state: GameState, me: Player, dir: Dir, danger: DangerMap): Dir {
  const cx = Math.floor(me.x);
  const cy = Math.floor(me.y);
  const curHit = hitAt(danger, cx, cy);
  const curScore = curHit < 0 ? 8000 : curHit;
  const ahead = (d: Dir) => {
    if (d === Dir.None) return { x: cx, y: cy };
    const v = DIR_VEC[d];
    return { x: Math.floor(me.x + v.x * 0.52), y: Math.floor(me.y + v.y * 0.52) };
  };
  const scoreOf = (d: Dir) => {
    const t = ahead(d);
    if (d !== Dir.None && (tileAt(state, t.x, t.y) === Tile.Boulder || tileAt(state, t.x, t.y) === Tile.Sandcastle || tileAt(state, t.x, t.y) === Tile.Flood)) {
      return -1;
    }
    const h = hitAt(danger, t.x, t.y);
    return h < 0 ? 9999 : h;
  };
  const proposed = dir === Dir.None ? curScore : scoreOf(dir);
  if (dir !== Dir.None && proposed >= 0 && proposed < 28 && proposed <= curScore) {
      let best: Dir = Dir.None;
    let bestS = curScore;
    for (const d of [Dir.Up, Dir.Right, Dir.Down, Dir.Left]) {
      const v = DIR_VEC[d];
      const tx = cx + v.x;
      const ty = cy + v.y;
      if (!walkable(state, tx, ty, me.passBalloonId)) continue;
      const h = hitAt(danger, tx, ty);
      const score = h < 0 ? 9999 : h;
      if (score > bestS) {
        bestS = score;
        best = d;
      }
    }
    return best;
  }
  return dir;
}

function considerKick(state: GameState, me: Player): Dir {
  if (!CONFIG.ENABLE_KICK || !me.hasKick) return Dir.None;
  const tx = Math.floor(me.x);
  const ty = Math.floor(me.y);
  const enemies = state.players.filter((p) => p.alive && p.id !== me.id);
  for (const d of [Dir.Up, Dir.Right, Dir.Down, Dir.Left]) {
    const v = DIR_VEC[d];
    const b = state.balloons.find((bb) => bb.x === tx + v.x && bb.y === ty + v.y && !bb.sliding);
    if (!b) continue;
    for (const e of enemies) {
      const ex = Math.floor(e.x) - b.x;
      const ey = Math.floor(e.y) - b.y;
      if (Math.sign(ex) === v.x && Math.sign(ey) === v.y && (ex !== 0 || ey !== 0)) return d;
    }
  }
  return Dir.None;
}

function plan(state: GameState, me: Player, mem: BotMemory, danger: DangerMap): void {
  const diff: Difficulty = me.difficulty ?? 'medium';
  const tx = Math.floor(me.x);
  const ty = Math.floor(me.y);
  const enemies = state.players.filter((p) => p.alive && p.id !== me.id);
  enemies.sort((a, b) => manhattan(tx, ty, Math.floor(a.x), Math.floor(a.y)) - manhattan(tx, ty, Math.floor(b.x), Math.floor(b.y)));
  const enemy = enemies[0];
  const power = me.balloonCount + me.splashRange + me.flippers;
  const early = state.tick < CONFIG.WARMUP_TICKS + 25 * CONFIG.TICK_RATE || power < 8;

  if (diff !== 'hard' || early) {
    let bestU: { x: number; y: number } | null = null;
    let bestD = 1e9;
    for (const u of state.powerups) {
      const d = manhattan(tx, ty, u.x, u.y);
      if (d < bestD && !arriveUnsafe(danger, u.x, u.y, d * ticksPerTile(me.speed))) {
        bestD = d;
        bestU = u;
      }
    }
    if (bestU && bestD <= (diff === 'easy' ? 5 : 10)) {
      const path = bfsPath(state, me, bestU, danger, false);
      if (path.length) {
        mem.path = path;
        mem.place = false;
        return;
      }
    }
  }

  const attackRange = CONFIG.BOT_ATTACK_RANGE[diff];
  const lateHard = diff === 'hard' && state.tick > CONFIG.WARMUP_TICKS + 8 * CONFIG.TICK_RATE;
  if (enemy && (lateHard || (attackRange > 0 && manhattan(tx, ty, Math.floor(enemy.x), Math.floor(enemy.y)) <= attackRange))) {
    const ex = Math.floor(enemy.x);
    const ey = Math.floor(enemy.y);
    if (centered(me) && wouldHit(state, me, ex, ey, diff === 'hard', enemy.facing)) {
      const esc = escapeAfterPlace(state, me);
      if (esc) {
        mem.place = true;
        mem.path = esc;
        return;
      }
    }
    const stand = findStand(state, me, ex, ey, danger);
    if (stand) {
      if (stand.x === tx && stand.y === ty) {
        const esc = escapeAfterPlace(state, me);
        if (esc && centered(me)) {
          mem.place = true;
          mem.path = esc;
          return;
        }
      } else {
        const path = bfsPath(state, me, stand, danger, false);
        if (path.length) {
          mem.path = path;
          mem.place = false;
          return;
        }
      }
    }
    if (lateHard) {
      const path = bfsPath(state, me, { x: ex, y: ey }, danger, false);
      if (path.length) {
        mem.path = path.slice(0, Math.max(1, path.length - 1));
        mem.place = false;
        return;
      }
    }
  }

  if (diff === 'easy' && mem.rng() < 0.55) {
    mem.place = false;
    mem.wanderUntil = state.tick + 10;
    const options = [Dir.Up, Dir.Right, Dir.Down, Dir.Left].filter((d) => {
      const v = DIR_VEC[d];
      return walkable(state, tx + v.x, ty + v.y);
    });
    mem.wanderDir = options.length ? options[Math.floor(mem.rng() * options.length)] : Dir.None;
    mem.path = [];
    return;
  }

  const castle = nearestCastle(state, tx, ty);
  if (castle) {
    const stand = findStand(state, me, castle.x, castle.y, danger);
    if (stand) {
      if (stand.x === tx && stand.y === ty && centered(me)) {
        const esc = escapeAfterPlace(state, me);
        if (esc && (diff !== 'easy' || mem.rng() > 0.35)) {
          mem.place = true;
          mem.path = esc;
          return;
        }
      } else if (!(stand.x === tx && stand.y === ty)) {
        const path = bfsPath(state, me, stand, danger, false);
        if (path.length) {
          mem.path = path;
          mem.place = false;
          return;
        }
      }
    }
  }

  mem.place = false;
  mem.path = [];
  mem.wanderUntil = state.tick + 8;
  const options = [Dir.Up, Dir.Right, Dir.Down, Dir.Left].filter((d) => {
    const v = DIR_VEC[d];
    return walkable(state, tx + v.x, ty + v.y) && !arriveUnsafe(danger, tx + v.x, ty + v.y, ticksPerTile(me.speed));
  });
  mem.wanderDir = options.length ? options[Math.floor(mem.rng() * options.length)] : Dir.None;
}

export function botAct(state: GameState, playerId: string, mem: BotMemory): PlayerInput {
  const me = state.players.find((p) => p.id === playerId);
  const none: PlayerInput = { seq: 0, tick: state.tick, dir: Dir.None, balloon: false };
  if (!me || !me.alive || state.warmup > 0 || state.over) return none;
  const diff: Difficulty = me.difficulty ?? 'medium';
  let danger = computeDanger(state);
  if (diff === 'easy' && mem.rng() < CONFIG.BOT_ERROR_RATE.easy) {
    const copy = new Int16Array(danger.hit);
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    for (let i = 0; i < copy.length; i++) {
      if (copy[i] >= 0 && mem.rng() < 0.35) copy[i] = -1;
    }
    const i = ty * state.width + tx;
    if (!ownLethal(state, me, danger)) copy[i] = danger.hit[i];
    else copy[i] = danger.hit[i];
    danger = { hit: copy, w: danger.w, h: danger.h };
  }

  const realDanger = computeDanger(state);
  const lethal = ownLethal(state, me, realDanger);
  const hereHit = hitAt(realDanger, Math.floor(me.x), Math.floor(me.y));
  if (mustFlee(state, me, realDanger) || lethal || hereHit >= 0) {
    const safe = findSafeTile(state, me, realDanger);
    mem.path = safe ? bfsPath(state, me, safe, realDanger, true) : [];
    mem.place = false;
    mem.nextThink = state.tick + Math.max(2, Math.floor(thinkInterval(diff) / 2));
    if (!mem.path.length) {
      const tx = Math.floor(me.x);
      const ty = Math.floor(me.y);
    let best: Dir = Dir.None;
      let bestScore = hitAt(realDanger, tx, ty);
      if (bestScore < 0) bestScore = 9999;
      for (const d of [Dir.Up, Dir.Right, Dir.Down, Dir.Left]) {
        const v = DIR_VEC[d];
        const nx = tx + v.x;
        const ny = ty + v.y;
        if (!walkable(state, nx, ny, me.passBalloonId)) continue;
        const h = hitAt(realDanger, nx, ny);
        const score = h < 0 ? 9999 : h;
        if (score > bestScore) {
          bestScore = score;
          best = d;
        }
      }
      mem.wanderDir = best;
      mem.wanderUntil = state.tick + 5;
    }
  } else if (state.tick >= mem.nextThink) {
    mem.nextThink = state.tick + thinkInterval(diff);
    plan(state, me, mem, danger);
  }

  if (Math.abs(me.x - mem.lastX) < 0.02 && Math.abs(me.y - mem.lastY) < 0.02) mem.stuck += 1;
  else mem.stuck = 0;
  mem.lastX = me.x;
  mem.lastY = me.y;
  if (mem.stuck > 18) {
    mem.path = [];
    mem.place = false;
    mem.stuck = 0;
    mem.nextThink = state.tick;
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    const options = [Dir.Up, Dir.Right, Dir.Down, Dir.Left].filter((d) => {
      const v = DIR_VEC[d];
      return walkable(state, tx + v.x, ty + v.y);
    });
    mem.wanderDir = options.length ? options[Math.floor(mem.rng() * options.length)] : Dir.None;
    mem.wanderUntil = state.tick + 6;
  }

  let dir = follow(me, mem);
  if (dir === Dir.None && state.tick < mem.wanderUntil) dir = mem.wanderDir;
  const kick = considerKick(state, me);
  if (kick && diff === 'hard' && !mem.place) dir = kick;

  let balloon = mem.place && centered(me);
  if (balloon) {
    const esc = escapeAfterPlace(state, me);
    if (!esc) balloon = false;
    else mem.path = esc;
  }
  if (balloon) mem.place = false;
  if (!centered(me) && mem.place) {
    balloon = false;
    dir = dirToward(me, { x: Math.floor(me.x), y: Math.floor(me.y) });
  }
  dir = clampDir(state, me, dir, realDanger);
  return { seq: 0, tick: state.tick, dir, balloon };
}
