import { CONFIG, TICK_RATE } from "@sc/shared";
import { TILE_BOULDER, TILE_CASTLE, TILE_FLOOR } from "@sc/shared";
import type { BotDifficulty, SimPlayerInput, SimState } from "@sc/shared";
import { bfsReachable, computeDanger } from "./dangerMap";

export interface BotBrain {
  entityId: string;
  difficulty: BotDifficulty;
  decideAt: number; // next decision tick
  targetTile: number | null;
  wantDrop: boolean;
  lastDirX: number;
  lastDirY: number;
}

export function createBot(entityId: string, difficulty: BotDifficulty): BotBrain {
  return {
    entityId,
    difficulty,
    decideAt: 0,
    targetTile: null,
    wantDrop: false,
    lastDirX: 0,
    lastDirY: 0,
  };
}

const intervalFor = (d: BotDifficulty): number =>
  Math.round(CONFIG.botIntervalsMs[d] / CONFIG.tickMs);

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/**
 * Decide one action for the bot. Returns input for this tick.
 * Priority: flee danger → safe balloon placement → farm castles → collect powerups → attack.
 */
export function botThink(state: SimState, brain: BotBrain): SimPlayerInput {
  const { w, h } = state.config;
  const me = state.players.find((p) => p.id === brain.entityId)!;
  const idle: SimPlayerInput = { seq: 0, tick: state.tick, dirX: 0, dirY: 0, balloonPressed: false };

  if (!me.alive) {
    // revenge duck lobs toward nearest live player along border
    if (state.config.enableRevengeDucks && me.revengeCooldown === 0) {
      let best: { x: number; y: number; d: number } | null = null;
      for (const p of state.players) {
        if (!p.alive || p.id === me.id) continue;
        const d = manhattan(Math.round(me.x), Math.round(me.y), Math.round(p.x), Math.round(p.y));
        if (!best || d < best.d) best = { x: Math.round(p.x), y: Math.round(p.y), d };
      }
      if (best) {
        const dx = Math.sign(best.x - Math.round(me.x));
        const dy = dx !== 0 ? 0 : Math.sign(best.y - Math.round(me.y));
        return { ...idle, dirX: dx, dirY: dy, balloonPressed: true };
      }
    }
    return idle;
  }

  const cx = Math.round(me.x);
  const cy = Math.round(me.y);
  const here = cy * w + cx;

  // Tiles the bot's body currently overlaps — the sim soaks any of them,
  // so danger must be evaluated conservatively across all of them.
  const bodyTiles: number[] = [];
  for (const [bxo, byo] of [[0, 0], [-0.45, 0], [0.45, 0], [0, -0.45], [0, 0.45]] as const) {
    const tx = Math.round(me.x + bxo);
    const ty = Math.round(me.y + byo);
    if (tx >= 0 && ty >= 0 && tx < w && ty < h) {
      const t = ty * w + tx;
      if (!bodyTiles.includes(t)) bodyTiles.push(t);
    }
  }

  if (state.tick < brain.decideAt) {
    // keep walking toward current target; drop only on decision boundaries
    return steer(state, brain, idle, cx, cy, false);
  }
  brain.decideAt = state.tick + intervalFor(brain.difficulty);

  const danger = computeDanger(state);

  // Easy bots misjudge danger sometimes
  const misjudge =
    brain.difficulty === "easy" && Math.random() < CONFIG.botErrorRates.easy;

  // 1) Flee if any tile under the bot is dangerous (or splash-covered)
  const inDanger =
    !misjudge && bodyTiles.some((t) => danger.time[t] !== Infinity || danger.splash[t] === 1);
  if (inDanger) {
    const { dist, prev } = bfsReachable(state, cx, cy, danger, 40, me.speed);
    let bestTile = -1;
    let bestDist = Infinity;
    for (let t = 0; t < dist.length; t++) {
      if (dist[t] === -1 || dist[t] === 0) continue;
      if (danger.time[t] === Infinity && danger.splash[t] === 0 && dist[t]! < bestDist) {
        bestDist = dist[t]!;
        bestTile = t;
      }
    }
    if (bestTile >= 0) {
      // step toward it
      let cur = bestTile;
      while (prev[cur] !== -1 && prev[cur] !== here) cur = prev[cur]!;
      brain.targetTile = cur;
      brain.wantDrop = false;
      return steer(state, brain, idle, cx, cy, false);
    }
    // Nowhere safe reachable — never freeze: scramble to the neighbouring
    // walkable tile with the latest time-to-burst.
    let bestN = -1;
    let bestT = -Infinity;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx <= 0 || ny <= 0 || nx >= w || ny >= h) continue;
      const nt = ny * w + nx;
      const tile = state.grid[nt]!;
      if (tile === TILE_BOULDER || tile === TILE_CASTLE || tile === 3) continue;
      if (state.balloons.some((b) => !b.sliding && b.x === nx && b.y === ny)) continue;
      if (danger.time[nt]! > bestT) {
        bestT = danger.time[nt]!;
        bestN = nt;
      }
    }
    if (bestN >= 0) {
      brain.targetTile = bestN;
    }
    return steer(state, brain, idle, cx, cy, false);
  }

  // 2) Consider dropping a balloon: simulate splash + verify escape
  const ownedBalloons = state.balloons.filter((b) => b.owner === me.id).length;
  const canDrop =
    ownedBalloons < me.balloonCount &&
    Math.abs(me.x - cx) < 0.2 &&
    Math.abs(me.y - cy) < 0.2; // only drop near a tile centre
  const enemyNear = playerInRange(state, cx, cy, me.splashRange);
  if (canDrop && enemyNear && brain.difficulty !== "easy") {
    const cornered = enemyEscapeTiles(state, cx, cy) <= 2;
    const prob = brain.difficulty === "hard" ? (cornered ? 0.95 : 0.55) : cornered ? 0.7 : 0.25;
    if (Math.random() < prob && escapeExistsAfterDrop(state, cx, cy, me.splashRange)) {
      brain.wantDrop = true;
      brain.targetTile = null;
      return { ...idle, balloonPressed: true };
    }
  }
  if (canDrop && Math.random() < attackUrge(brain.difficulty)) {
    const wouldHitCastleOrPlayer = splashWouldHit(state, cx, cy, me.splashRange);
    const nearTarget = brain.targetTile !== null && manhattan(cx, cy, brain.targetTile % w, Math.floor(brain.targetTile / w)) <= 1;
    if ((wouldHitCastleOrPlayer || nearTarget || brain.difficulty === "hard") && escapeExistsAfterDrop(state, cx, cy, me.splashRange)) {
      brain.wantDrop = true;
      brain.targetTile = null;
      return { ...idle, balloonPressed: true };
    }
  }

  // 3) Pick a goal: exposed powerup > castle cluster > nearest player (hard)
  brain.wantDrop = false;
  const goals: Array<{ tile: number; weight: number }> = [];

  for (const e of state.exposed) goals.push({ tile: e.y * w + e.x, weight: 100 });
  for (let t = 0; t < state.grid.length; t++) {
    if (state.grid[t] === TILE_CASTLE) {
      const x = t % w;
      const y = Math.floor(t / w);
      goals.push({ tile: t, weight: 10 - manhattan(cx, cy, x, y) * 0.5 });
    }
  }
  if (brain.difficulty === "hard") {
    for (const p of state.players) {
      if (p.alive && p.id !== me.id) {
        // intercept: aim 2 tiles ahead of their facing direction
        const px = Math.max(1, Math.min(w - 2, Math.round(p.x) + p.dirX * 2));
        const py = Math.max(1, Math.min(h - 2, Math.round(p.y) + p.dirY * 2));
        goals.push({ tile: py * w + px, weight: 40 });
      }
    }
  } else if (brain.difficulty === "medium") {
    for (const p of state.players) {
      if (p.alive && p.id !== me.id && manhattan(cx, cy, Math.round(p.x), Math.round(p.y)) <= 4) {
        goals.push({ tile: Math.round(p.y) * w + Math.round(p.x), weight: 30 });
      }
    }
  }

  const { dist, prev } = bfsReachable(state, cx, cy, danger, 60);

  // Rising tide: strongly prefer the deepest reachable tile from the border
  if (state.tideRing >= 0) {
    let safest = -1;
    let safestRing = -1;
    for (let t = 0; t < dist.length; t++) {
      if (dist[t] === undefined || dist[t]! <= 0) continue;
      const x = t % w;
      const y = Math.floor(t / w);
      const ring = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (ring > safestRing) {
        safestRing = ring;
        safest = t;
      }
    }
    if (safest >= 0) goals.push({ tile: safest, weight: 500 });
  }

  let bestGoal: number | null = null;
  let bestScore = -Infinity;
  for (const g of goals) {
    if (dist[g.tile] === undefined || dist[g.tile] === -1) continue;
    // never choose a goal that sits inside a current or future splash zone
    if (danger.splash[g.tile] === 1 || danger.time[g.tile] !== Infinity) continue;
    const score = g.weight - dist[g.tile]!;
    if (score > bestScore) {
      bestScore = score;
      bestGoal = g.tile;
    }
  }
  if (bestGoal !== null && dist[bestGoal]! > 0) {
    let cur = bestGoal;
    while (prev[cur] !== -1 && prev[cur] !== here) cur = prev[cur]!;
    brain.targetTile = cur;
  } else {
    // wander
    brain.targetTile = wanderTarget(state, cx, cy);
  }
  return steer(state, brain, idle, cx, cy, false);
}

/** Free walkable neighbours of a tile (rough escape count). */
function enemyEscapeTiles(state: SimState, x: number, y: number): number {
  let n = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx <= 0 || ny <= 0 || nx >= state.config.w - 1 || ny >= state.config.h - 1) continue;
    const t = state.grid[ny * state.config.w + nx]!;
    if (t === TILE_FLOOR) n++;
  }
  return n;
}

function attackUrge(d: BotDifficulty): number {
  return d === "easy" ? 0.15 : d === "medium" ? 0.5 : 0.85;
}

function steer(
  state: SimState,
  brain: BotBrain,
  idle: SimPlayerInput,
  _cx: number,
  _cy: number,
  _allowDrop: boolean,
): SimPlayerInput {
  void _cx;
  void _cy;
  void _allowDrop;
  if (brain.targetTile === null) return idle;
  const me = state.players.find((p) => p.id === brain.entityId)!;
  const tx = brain.targetTile % state.config.w;
  const ty = Math.floor(brain.targetTile / state.config.w);
  const EPS = 0.06;
  const cxr = Math.round(me.x);
  const cyr = Math.round(me.y);
  const to = (delta: number): number => Math.max(-1, Math.min(1, delta * 8));
  // Intent comes from INTEGER tile deltas so alignment can never fight travel.
  const dxc = tx - cxr;
  const dyc = ty - cyr;
  if (dxc !== 0) {
    // horizontal travel: be exactly on row cyr first
    if (Math.abs(me.y - cyr) > EPS) return { ...idle, dirX: 0, dirY: to(cyr - me.y) };
    return { ...idle, dirX: to(tx - me.x), dirY: 0 };
  }
  if (dyc !== 0) {
    // vertical travel: be exactly on column cxr first
    if (Math.abs(me.x - cxr) > EPS) return { ...idle, dirX: to(cxr - me.x), dirY: 0 };
    return { ...idle, dirX: 0, dirY: to(ty - me.y) };
  }
  // arrived at target tile: settle onto its exact centre
  if (Math.abs(me.x - cxr) > EPS) return { ...idle, dirX: to(cxr - me.x), dirY: 0 };
  if (Math.abs(me.y - cyr) > EPS) return { ...idle, dirX: 0, dirY: to(cyr - me.y) };
  brain.targetTile = null;
  return idle;
}

function wanderTarget(state: SimState, cx: number, cy: number): number {
  const { w, h } = state.config;
  for (let tries = 0; tries < 20; tries++) {
    const x = 1 + Math.floor(Math.random() * (w - 2));
    const y = 1 + Math.floor(Math.random() * (h - 2));
    if (state.grid[y * w + x] === TILE_FLOOR) return y * w + x;
  }
  return cy * w + cx;
}

function splashWouldHit(state: SimState, cx: number, cy: number, range: number): boolean {
  const { w } = state.config;
  const hit = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= state.config.h) return false;
    const t = y * w + x;
    if (state.grid[t] === TILE_CASTLE) return true;
    return state.players.some((p) => p.alive && p.id !== "" && Math.round(p.x) === x && Math.round(p.y) === y && t !== cy * w + cx);
  };
  for (let i = 1; i <= range; i++) {
    if (
      hit(cx + i, cy) ||
      hit(cx - i, cy) ||
      hit(cx, cy + i) ||
      hit(cx, cy - i)
    )
      return true;
  }
  return false;
}

/** True if a live player stands on the bot's cross within range (line of sight blocked by walls/castles). */
function playerInRange(state: SimState, cx: number, cy: number, range: number): boolean {
  const { w } = state.config;
  const solidAt = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= state.config.h) return true;
    const t = state.grid[y * w + x]!;
    return t === 1 || t === TILE_CASTLE;
  };
  for (const p of state.players) {
    if (!p.alive) continue;
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    if (px === cx && py === cy) continue;
    if (Math.abs(px - cx) + Math.abs(py - cy) > range) continue;
    // same row or column with clear path?
    if (py === cy) {
      const step = Math.sign(px - cx);
      let clear = true;
      for (let x = cx + step; x !== px; x += step) if (solidAt(x, cy)) clear = false;
      if (clear) return true;
    } else if (px === cx) {
      const step = Math.sign(py - cy);
      let clear = true;
      for (let y = cy + step; y !== py; y += step) if (solidAt(cx, y)) clear = false;
      if (clear) return true;
    }
  }
  return false;
}

/** Verify that after placing a balloon at (cx,cy) the bot can still reach safety.
 * Mirrors bfsReachable constraints: never traverse lethal or soon-lethal tiles. */
function escapeExistsAfterDrop(state: SimState, cx: number, cy: number, range: number): boolean {
  const { w, h } = state.config;
  const danger = computeDanger(state);
  const mark = (x: number, y: number): boolean => {
    if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return false;
    const t = y * w + x;
    if (state.grid[t] === 1 || state.grid[t] === 3 /* flooded */) return false;
    danger.time[t] = Math.min(danger.time[t]!, CONFIG.fuseTicks - 10);
    return state.grid[t] !== TILE_CASTLE;
  };
  mark(cx, cy);
  outer: for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    for (let i = 1; i <= range; i++) {
      if (!mark(cx + dx * i, cy + dy * i)) continue outer;
    }
  }
  // can we reach a permanently-safe tile walking only through safe tiles?
  const visited = new Set<number>([cy * w + cx]);
  let frontier = [cy * w + cx];
  for (let step = 1; step <= 40; step++) {
    const next: number[] = [];
    for (const cur of frontier) {
      const x = cur % w;
      const y = Math.floor(cur / w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1) continue;
        const nt = ny * w + nx;
        if (visited.has(nt)) continue;
        const tile = state.grid[nt]!;
        if (tile === 1 || tile === TILE_CASTLE || tile === 3) continue;
        if (danger.time[nt] !== Infinity && danger.time[nt]! <= step + CONFIG.splashLingerTicks) continue;
        visited.add(nt);
        if (danger.time[nt] === Infinity && danger.splash[nt] === 0) return true;
        next.push(nt);
      }
    }
    frontier = next;
  }
  return false;
}
