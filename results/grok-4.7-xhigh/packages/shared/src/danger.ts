import { CONFIG, type Difficulty } from './config.js';
import { splashTiles, tileAt } from './sim.js';
import { DIR_VEC, Tile, edgeDist, idx, inBounds, type Balloon, type GameState, type Player } from './types.js';

export interface DangerMap {
  hit: Int16Array;
  w: number;
  h: number;
}

function slideBlocked(state: GameState, tx: number, ty: number, ignoreId: string): boolean {
  if (!inBounds(state.width, state.height, tx, ty)) return true;
  const tile = tileAt(state, tx, ty);
  if (tile === Tile.Boulder || tile === Tile.Sandcastle) return true;
  if (state.balloons.some((b) => b.id !== ignoreId && b.x === tx && b.y === ty)) return true;
  for (const p of state.players) {
    if (!p.alive) continue;
    if (Math.floor(p.x) === tx && Math.floor(p.y) === ty) return true;
  }
  return false;
}

export function projectBalloon(state: GameState, b: Balloon, ticks: number): { x: number; y: number } {
  if (!b.sliding || b.slideDir === 0 || ticks <= 0) return { x: b.x, y: b.y };
  const v = DIR_VEC[b.slideDir];
  const step = CONFIG.KICK_TILES_PER_SEC / CONFIG.TICK_RATE;
  let x = b.x;
  let y = b.y;
  let acc = b.slideAcc;
  let remaining = ticks;
  for (let g = 0; g < 48 && remaining > 0; g++) {
    const need = (1 - acc) / step;
    if (need > remaining) return { x, y };
    const nx = x + v.x;
    const ny = y + v.y;
    if (slideBlocked(state, nx, ny, b.id)) return { x, y };
    remaining -= need;
    x = nx;
    y = ny;
    acc = 0;
  }
  return { x, y };
}

export function computeDanger(state: GameState): DangerMap {
  const w = state.width;
  const h = state.height;
  const fuse = new Map<string, number>();
  for (const b of state.balloons) fuse.set(b.id, Math.max(0, b.fuse));

  let changed = true;
  for (let guard = 0; changed && guard < 24; guard++) {
    changed = false;
    for (const b of state.balloons) {
      const t = fuse.get(b.id) ?? 0;
      const pos = projectBalloon(state, b, t);
      const cells = splashTiles(state.tiles, w, h, state.balloons, pos.x, pos.y, b.range, b.id);
      for (const o of state.balloons) {
        if (o.id === b.id) continue;
        const op = projectBalloon(state, o, t);
        if (!cells.some((c) => c.x === op.x && c.y === op.y)) continue;
        const ot = fuse.get(o.id) ?? 0;
        if (ot > t) {
          fuse.set(o.id, t);
          changed = true;
        }
      }
    }
  }

  const hit = new Int16Array(w * h);
  hit.fill(-1);
  for (const b of state.balloons) {
    const t = fuse.get(b.id) ?? 0;
    const pos = projectBalloon(state, b, t);
    const cells = splashTiles(state.tiles, w, h, state.balloons, pos.x, pos.y, b.range, b.id);
    for (const c of cells) {
      const i = idx(w, c.x, c.y);
      if (hit[i] < 0 || t < hit[i]) hit[i] = t;
    }
  }
  for (const s of state.splashes) {
    if (inBounds(w, h, s.x, s.y)) hit[idx(w, s.x, s.y)] = 0;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tileAt(state, x, y) === Tile.Flood) hit[idx(w, x, y)] = 0;
    }
  }

  const start = CONFIG.TIDE_START_SEC * CONFIG.TICK_RATE + CONFIG.WARMUP_TICKS;
  const interval = Math.max(1, Math.round(CONFIG.TIDE_INTERVAL_SEC * CONFIG.TICK_RATE));
  if (state.tick + 120 >= start) {
    const nextRing = state.tideRing + 1;
    let when = 0;
    if (state.tick < start) when = start - state.tick;
    else when = interval - ((state.tick - start) % interval);
    if (when === interval) when = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dist = edgeDist(x, y, w, h);
        if (dist === 0 || dist > nextRing) continue;
        if (tileAt(state, x, y) === Tile.Boulder) continue;
        const i = idx(w, x, y);
        if (dist <= state.tideRing) hit[i] = 0;
        else if (hit[i] < 0 || when < hit[i]) hit[i] = when;
      }
    }
  }

  return { hit, w, h };
}

export function hitAt(d: DangerMap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= d.w || y >= d.h) return 0;
  return d.hit[idx(d.w, x, y)];
}

export function ticksPerTile(speed: number): number {
  return CONFIG.TICK_RATE / Math.max(0.25, speed);
}

export function arriveUnsafe(d: DangerMap, x: number, y: number, arrive: number): boolean {
  const h = hitAt(d, x, y);
  if (h < 0) return false;
  if (arrive >= h && arrive < h + CONFIG.SPLASH_LINGER_TICKS) return true;
  if (h === 0) return true;
  return false;
}

export function mustFlee(state: GameState, me: Player, danger: DangerMap): boolean {
  const tx = Math.floor(me.x);
  const ty = Math.floor(me.y);
  const h = hitAt(danger, tx, ty);
  if (h < 0) return false;
  if (h === 0) return true;
  const safe = findSafeTile(state, me, danger);
  if (!safe) return true;
  const travel = (Math.abs(safe.x - tx) + Math.abs(safe.y - ty)) * ticksPerTile(me.speed);
  return travel + 2 >= h;
}

export function walkable(state: GameState, x: number, y: number, ignoreBalloon = ''): boolean {
  if (!inBounds(state.width, state.height, x, y)) return false;
  const t = tileAt(state, x, y);
  if (t === Tile.Boulder || t === Tile.Sandcastle || t === Tile.Flood) return false;
  const b = state.balloons.find((bb) => bb.x === x && bb.y === y);
  if (b && b.id !== ignoreBalloon) return false;
  return true;
}

export function findSafeTile(
  state: GameState,
  me: Player,
  danger: DangerMap,
): { x: number; y: number; steps: number } | null {
  const sx = Math.floor(me.x);
  const sy = Math.floor(me.y);
  const q: { x: number; y: number; steps: number }[] = [{ x: sx, y: sy, steps: 0 }];
  const seen = new Set<string>([`${sx},${sy}`]);
  const speed = ticksPerTile(me.speed);
  let best: { x: number; y: number; steps: number; score: number } | null = null;
  while (q.length) {
    const cur = q.shift()!;
    const h = hitAt(danger, cur.x, cur.y);
    if (cur.steps > 0 && h < 0) return { x: cur.x, y: cur.y, steps: cur.steps };
    const score = h < 0 ? 9999 : h;
    if (score > (best?.score ?? -1) && tileAt(state, cur.x, cur.y) !== Tile.Flood) {
      best = { x: cur.x, y: cur.y, steps: cur.steps, score };
    }
    if (cur.steps > 18) continue;
    for (const d of [1, 2, 3, 4]) {
      const v = DIR_VEC[d];
      const nx = cur.x + v.x;
      const ny = cur.y + v.y;
      const k = `${nx},${ny}`;
      if (seen.has(k) || !walkable(state, nx, ny)) continue;
      const nh = hitAt(danger, nx, ny);
      const na = (cur.steps + 1) * speed;
      if (nh === 0) continue;
      if (nh > 0 && na >= nh) continue;
      seen.add(k);
      q.push({ x: nx, y: ny, steps: cur.steps + 1 });
    }
  }
  return best ? { x: best.x, y: best.y, steps: best.steps } : null;
}

export function bfsPath(
  state: GameState,
  me: Player,
  goal: { x: number; y: number },
  danger: DangerMap | null,
  flee: boolean,
): { x: number; y: number }[] {
  const sx = Math.floor(me.x);
  const sy = Math.floor(me.y);
  if (sx === goal.x && sy === goal.y) return [];
  const q: { x: number; y: number; steps: number }[] = [{ x: sx, y: sy, steps: 0 }];
  const prev = new Map<string, string>();
  const seen = new Set<string>([`${sx},${sy}`]);
  const speed = ticksPerTile(me.speed);
  let found = false;
  while (q.length) {
    const cur = q.shift()!;
    if (cur.x === goal.x && cur.y === goal.y) {
      found = true;
      break;
    }
    if (cur.steps > 22) continue;
    for (const d of [1, 2, 3, 4]) {
      const v = DIR_VEC[d];
      const nx = cur.x + v.x;
      const ny = cur.y + v.y;
      const k = `${nx},${ny}`;
      if (seen.has(k) || !walkable(state, nx, ny, me.passBalloonId)) continue;
      if (danger && !flee) {
        const na = (cur.steps + 1) * speed;
        if (arriveUnsafe(danger, nx, ny, na) || hitAt(danger, nx, ny) === 0) continue;
        const nh = hitAt(danger, nx, ny);
        if (nh > 0 && na + speed >= nh && !(nx === goal.x && ny === goal.y)) continue;
      }
      if (danger && flee) {
        const nh = hitAt(danger, nx, ny);
        const na = (cur.steps + 1) * speed;
        if (nh === 0) continue;
        if (nh > 0 && na >= nh && !(nx === goal.x && ny === goal.y)) continue;
      }
      seen.add(k);
      prev.set(k, `${cur.x},${cur.y}`);
      q.push({ x: nx, y: ny, steps: cur.steps + 1 });
    }
  }
  if (!found) return [];
  const path: { x: number; y: number }[] = [];
  let cur = `${goal.x},${goal.y}`;
  while (cur !== `${sx},${sy}`) {
    const [x, y] = cur.split(',').map(Number);
    path.push({ x, y });
    const p = prev.get(cur);
    if (!p) break;
    cur = p;
  }
  path.reverse();
  return path;
}

export function thinkInterval(diff: Difficulty): number {
  return Math.max(1, Math.round(CONFIG.BOT_INTERVAL_MS[diff] / (1000 / CONFIG.TICK_RATE)));
}
