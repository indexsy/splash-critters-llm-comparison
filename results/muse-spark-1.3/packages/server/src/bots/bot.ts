import { CONFIG } from '@splash/shared';
import type { GameState, PlayerInput, PlayerState } from '@splash/shared';
import type { BotDifficulty } from '@splash/shared';
import { computeDanger, isUnsafe } from './dangerMap.js';

interface BotMemory {
  lastDecisionTick: number;
  dirX: number;
  dirY: number;
  wantBalloon: boolean;
  targetX: number;
  targetY: number;
  seq: number;
}

const mem = new Map<string, BotMemory>();

function getMem(id: string): BotMemory {
  let m = mem.get(id);
  if (!m) {
    m = { lastDecisionTick: -999, dirX: 0, dirY: 0, wantBalloon: false, targetX: -1, targetY: -1, seq: 0 };
    mem.set(id, m);
  }
  return m;
}

export function resetBot(id: string): void {
  mem.delete(id);
}

function walkable(s: GameState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= s.width || ty >= s.height) return false;
  const t = s.tiles[ty][tx];
  if (t === 1 || t === 2) return false;
  if (s.balloons.some((b) => b.tx === tx && b.ty === ty)) return false;
  return true;
}

// BFS from (sx,sy) to nearest tile satisfying pred; returns first-step dir + path.
function bfs(
  s: GameState,
  sx: number,
  sy: number,
  pred: (x: number, y: number) => boolean,
  maxDepth = 40,
): { dx: number; dy: number; dist: number } | null {
  const key = (x: number, y: number) => `${x},${y}`;
  const prev = new Map<string, string>();
  const dist = new Map<string, number>();
  const q: [number, number][] = [[sx, sy]];
  dist.set(key(sx, sy), 0);
  if (pred(sx, sy)) return { dx: 0, dy: 0, dist: 0 };
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length > 0) {
    const [x, y] = q.shift()!;
    const d = dist.get(key(x, y))!;
    if (d >= maxDepth) continue;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (dist.has(key(nx, ny))) continue;
      if (!walkable(s, nx, ny)) continue;
      // allow starting tile even if occupied
      dist.set(key(nx, ny), d + 1);
      prev.set(key(nx, ny), key(x, y));
      if (pred(nx, ny)) {
        // backtrack to first step
        let cx = nx;
        let cy = ny;
        while (prev.get(key(cx, cy)) !== key(sx, sy) && prev.get(key(cx, cy)) !== undefined) {
          const pk = prev.get(key(cx, cy))!;
          const [px, py] = pk.split(',').map(Number);
          cx = px;
          cy = py;
        }
        return { dx: cx - sx, dy: cy - sy, dist: d + 1 };
      }
      q.push([nx, ny]);
    }
  }
  return null;
}

// Simulate placing balloon at (tx,ty) with range, then check reachable safe tile.
function canEscapeAfterPlace(s: GameState, me: PlayerState, tx: number, ty: number): { dx: number; dy: number } | null {
  const danger = computeDanger(s);
  // pretend balloon exists
  const fakeBalloons = [...s.balloons, { id: -999, tx, ty, ownerId: me.id, fuse: CONFIG.FUSE_TICKS, range: me.splashRange, slideX: 0, slideY: 0, slideT: 0, passThrough: new Set<string>() } as never];
  const fake = { ...s, balloons: fakeBalloons } as GameState;
  const d2 = computeDanger(fake);
  void danger;
  // BFS to safe tile (BFS walkable excludes the new balloon tile except start)
  const sx = Math.floor(me.x);
  const sy = Math.floor(me.y);
  const res = bfs(
    { ...fake, balloons: fakeBalloons.filter((b) => !(b.tx === sx && b.ty === sy)) } as GameState,
    sx,
    sy,
    (x, y) => !isUnsafe(d2, x, y, 10),
    30,
  );
  return res;
}

export function botInput(s: GameState, me: PlayerState, difficulty: BotDifficulty, rng: () => number = Math.random): PlayerInput {
  const m = getMem(me.id);
  m.seq++;
  const interval = CONFIG.BOT_INTERVAL[difficulty];
  const errRate = CONFIG.BOT_ERROR_RATE[difficulty];
  const myTx = Math.floor(me.x);
  const myTy = Math.floor(me.y);

  if (s.tick - m.lastDecisionTick < interval) {
    // keep moving in chosen dir
    return { seq: m.seq, tick: s.tick, dx: m.dirX, dy: m.dirY, balloon: m.wantBalloon };
  }
  m.lastDecisionTick = s.tick;
  m.wantBalloon = false;

  const danger = computeDanger(s);
  const inDanger = isUnsafe(danger, myTx, myTy, 10);

  // Occasional misjudgment on easy
  if (rng() < errRate) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]];
    const [dx, dy] = dirs[Math.floor(rng() * dirs.length)];
    m.dirX = dx;
    m.dirY = dy;
    return { seq: m.seq, tick: s.tick, dx, dy, balloon: false };
  }

  // 1) Flee if dangerous
  if (inDanger) {
    const esc = bfs(s, myTx, myTy, (x, y) => !isUnsafe(danger, x, y, 10), 30);
    if (esc) {
      m.dirX = esc.dx;
      m.dirY = esc.dy;
      return { seq: m.seq, tick: s.tick, dx: esc.dx, dy: esc.dy, balloon: false };
    }
    // no safe tile — run to least-dangerous neighbor
    let best: [number, number] | null = null;
    let bestV = -Infinity;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      const nx = myTx + dx;
      const ny = myTy + dy;
      if (!walkable(s, nx, ny) && !(nx === myTx && ny === myTy)) continue;
      const v = danger.dangerAt[ny]?.[nx] ?? Infinity;
      if (v > bestV) {
        bestV = v;
        best = [dx, dy];
      }
    }
    if (best) {
      m.dirX = best[0];
      m.dirY = best[1];
      return { seq: m.seq, tick: s.tick, dx: best[0], dy: best[1], balloon: false };
    }
    m.dirX = 0;
    m.dirY = 0;
    return { seq: m.seq, tick: s.tick, dx: 0, dy: 0, balloon: false };
  }

  // Helper: adjacent castle?
  const adjCastle = (() => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      const nx = myTx + dx;
      const ny = myTy + dy;
      if (nx < 0 || ny < 0 || nx >= s.width || ny >= s.height) continue;
      if (s.tiles[ny][nx] === 2) return true;
    }
    return false;
  })();

  // 2) Consider placing balloon: need escape + (adjacent castle or enemy near)
  const owned = s.balloons.filter((b) => b.ownerId === me.id).length;
  const canPlace = owned < me.balloonCount && !s.balloons.some((b) => b.tx === myTx && b.ty === myTy);
  if (canPlace) {
    const enemies = s.players.filter((p) => p.id !== me.id && p.alive && !p.isDuck);
    const nearestDist = Math.min(...enemies.map((e) => Math.abs(Math.floor(e.x) - myTx) + Math.abs(Math.floor(e.y) - myTy)), 99);
    const aggroRange = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 4 : 6;
    const shouldAttack = nearestDist <= aggroRange && (difficulty !== 'easy' || rng() < 0.25);
    // hard bots farm early then hunt: if tick < 1500 prefer castles, else always attack
    const hardHunt = difficulty === 'hard' && s.tick > 1200;
    if ((adjCastle && (difficulty !== 'hard' || s.tick < 2000 || rng() < 0.6)) || shouldAttack || hardHunt) {
      const esc = canEscapeAfterPlace(s, me, myTx, myTy);
      if (esc) {
        m.dirX = esc.dx;
        m.dirY = esc.dy;
        m.wantBalloon = false;
        // place now, move next ticks
        return { seq: m.seq, tick: s.tick, dx: 0, dy: 0, balloon: true };
      }
    }
  }

  // 3) Farm castles / collect powerups / attack
  // Powerup nearby?
  if (s.powerups.length > 0) {
    const pu = bfs(s, myTx, myTy, (x, y) => s.powerups.some((p) => p.tx === x && p.ty === y), 40);
    if (pu && (difficulty !== 'easy' || rng() < 0.7)) {
      // verify path safety
      m.dirX = pu.dx;
      m.dirY = pu.dy;
      return { seq: m.seq, tick: s.tick, dx: pu.dx, dy: pu.dy, balloon: false };
    }
  }
  // Hard: hunt nearest player
  if (difficulty === 'hard') {
    const enemies = s.players.filter((p) => p.id !== me.id && p.alive && !p.isDuck);
    if (enemies.length > 0 && s.tick > 600) {
      enemies.sort((a, b) => Math.abs(Math.floor(a.x) - myTx) + Math.abs(Math.floor(a.y) - myTy) - (Math.abs(Math.floor(b.x) - myTx) + Math.abs(Math.floor(b.y) - myTy)));
      const t = enemies[0];
      const hunt = bfs(s, myTx, myTy, (x, y) => Math.abs(x - Math.floor(t.x)) + Math.abs(y - Math.floor(t.y)) <= 1, 50);
      if (hunt && (hunt.dx !== 0 || hunt.dy !== 0)) {
        // cut escape corridors: prefer moves reducing distance — BFS already does
        m.dirX = hunt.dx;
        m.dirY = hunt.dy;
        return { seq: m.seq, tick: s.tick, dx: hunt.dx, dy: hunt.dy, balloon: false };
      }
    }
  }
  // Medium: attack within 4
  if (difficulty === 'medium') {
    const enemies = s.players.filter((p) => p.id !== me.id && p.alive && !p.isDuck && Math.abs(Math.floor(p.x) - myTx) + Math.abs(Math.floor(p.y) - myTy) <= 5);
    if (enemies.length > 0 && rng() < 0.6) {
      const t = enemies[0];
      const hunt = bfs(s, myTx, myTy, (x, y) => Math.abs(x - Math.floor(t.x)) + Math.abs(y - Math.floor(t.y)) <= 2, 30);
      if (hunt && (hunt.dx !== 0 || hunt.dy !== 0)) {
        m.dirX = hunt.dx;
        m.dirY = hunt.dy;
        return { seq: m.seq, tick: s.tick, dx: hunt.dx, dy: hunt.dy, balloon: false };
      }
    }
  }
  // Farm: path to adjacent-of-castle tile
  const farm = bfs(
    s,
    myTx,
    myTy,
    (x, y) => {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= s.width || ny >= s.height) continue;
        if (s.tiles[ny][nx] === 2) return true;
      }
      return false;
    },
    60,
  );
  if (farm && (farm.dx !== 0 || farm.dy !== 0)) {
    // verify destination safety
    m.dirX = farm.dx;
    m.dirY = farm.dy;
    return { seq: m.seq, tick: s.tick, dx: farm.dx, dy: farm.dy, balloon: false };
  }
  // Wander
  if (m.dirX === 0 && m.dirY === 0 || rng() < 0.15) {
    const opts: [number, number][] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      if (walkable(s, myTx + dx, myTy + dy) && !isUnsafe(danger, myTx + dx, myTy + dy, 10)) opts.push([dx, dy]);
    }
    if (opts.length > 0) {
      const [dx, dy] = opts[Math.floor(rng() * opts.length)];
      m.dirX = dx;
      m.dirY = dy;
    } else {
      m.dirX = 0;
      m.dirY = 0;
    }
  }
  return { seq: m.seq, tick: s.tick, dx: m.dirX, dy: m.dirY, balloon: false };
}
