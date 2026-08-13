import {
  CONFIG,
  dirVec,
  inBounds,
  tileIndex,
  type BotDifficulty,
  type Dir,
  type PlayerInput,
  type PlayerState,
  type RoundState,
  type TileKind,
} from "@splash/shared";
import { computeDangerMap, SAFE, type DangerGrid } from "./dangerMap.js";

const DIRS: Dir[] = ["up", "down", "left", "right"];

export interface BotBrain {
  id: string;
  difficulty: BotDifficulty;
  lastDecideTick: number;
  lastInput: PlayerInput;
  seq: number;
}

export function createBrain(id: string, difficulty: BotDifficulty): BotBrain {
  return {
    id,
    difficulty,
    lastDecideTick: -999,
    lastInput: { seq: 0, tick: 0, dir: "none", balloonPressed: false },
    seq: 0,
  };
}

function intervalTicks(d: BotDifficulty): number {
  const ms =
    d === "easy" ? CONFIG.BOT_EASY_INTERVAL_MS : d === "hard" ? CONFIG.BOT_HARD_INTERVAL_MS : CONFIG.BOT_MEDIUM_INTERVAL_MS;
  return Math.max(1, Math.round((ms / 1000) * CONFIG.TICK_RATE));
}

function tileAt(state: RoundState, x: number, y: number): TileKind {
  if (!inBounds(x, y, state.arena.width, state.arena.height)) return "boulder";
  return state.arena.tiles[tileIndex(x, y, state.arena.width)]!;
}

function blocked(state: RoundState, x: number, y: number, extraBalloon?: { x: number; y: number }): boolean {
  const t = tileAt(state, x, y);
  if (t === "boulder" || t === "castle") return true;
  if (state.balloons.some((b) => b.tx === x && b.ty === y)) return true;
  if (extraBalloon && extraBalloon.x === x && extraBalloon.y === y) return true;
  return false;
}

function walkableNeighbors(state: RoundState, x: number, y: number, extra?: { x: number; y: number }): { dir: Dir; x: number; y: number }[] {
  const out: { dir: Dir; x: number; y: number }[] = [];
  for (const dir of DIRS) {
    const d = dirVec(dir);
    const nx = x + d.x;
    const ny = y + d.y;
    if (!blocked(state, nx, ny, extra)) out.push({ dir, x: nx, y: ny });
  }
  return out;
}

function fleeDir(state: RoundState, sx: number, sy: number, danger: DangerGrid): Dir {
  const w = state.arena.width;
  const ticksPerTile = Math.ceil(CONFIG.TICK_RATE / Math.max(CONFIG.SPEED_BASE, 1));
  const key = (x: number, y: number) => y * w + x;
  const seen = new Set<number>([key(sx, sy)]);
  const q: { x: number; y: number; first: Dir; dist: number }[] = [];
  for (const nb of walkableNeighbors(state, sx, sy)) {
    const burst = danger[tileIndex(nb.x, nb.y, w)] ?? SAFE;
    if (burst < ticksPerTile) continue;
    seen.add(key(nb.x, nb.y));
    q.push({ x: nb.x, y: nb.y, first: nb.dir, dist: 1 });
  }
  let i = 0;
  while (i < q.length) {
    const n = q[i++]!;
    if ((danger[tileIndex(n.x, n.y, w)] ?? SAFE) >= SAFE) return n.first;
    if (n.dist >= 16) continue;
    for (const nb of walkableNeighbors(state, n.x, n.y)) {
      const k = key(nb.x, nb.y);
      if (seen.has(k)) continue;
      const arrive = (n.dist + 1) * ticksPerTile;
      const burst = danger[tileIndex(nb.x, nb.y, w)] ?? SAFE;
      if (burst < arrive) continue;
      seen.add(k);
      q.push({ x: nb.x, y: nb.y, first: n.first, dist: n.dist + 1 });
    }
  }
  const neighbors = walkableNeighbors(state, sx, sy);
  if (!neighbors.length) return "none";
  neighbors.sort((a, b) => (danger[tileIndex(b.x, b.y, w)] ?? SAFE) - (danger[tileIndex(a.x, a.y, w)] ?? SAFE));
  return neighbors[0]!.dir;
}

function canEscapeOwnBalloon(state: RoundState, p: PlayerState, danger: DangerGrid): boolean {
  const tx = Math.floor(p.x + 0.5);
  const ty = Math.floor(p.y + 0.5);
  const w = state.arena.width;
  const marked = new Set<string>();
  const mark = (x: number, y: number) => marked.add(`${x},${y}`);
  mark(tx, ty);
  for (const dir of DIRS) {
    const d = dirVec(dir);
    for (let s = 1; s <= p.splashRange; s++) {
      const x = tx + d.x * s;
      const y = ty + d.y * s;
      const t = tileAt(state, x, y);
      if (t === "boulder") break;
      mark(x, y);
      if (t === "castle") break;
    }
  }
  const extra = { x: tx, y: ty };
  const seen = new Set<string>([`${tx},${ty}`]);
  const q: { x: number; y: number; dist: number }[] = [{ x: tx, y: ty, dist: 0 }];
  const ticksPerTile = Math.ceil(CONFIG.TICK_RATE / Math.max(p.speed, 1));
  let qi = 0;
  while (qi < q.length) {
    const n = q[qi++]!;
    if (!marked.has(`${n.x},${n.y}`) && (danger[tileIndex(n.x, n.y, w)] ?? SAFE) >= SAFE && n.dist > 0) {
      return true;
    }
    if (n.dist >= 12) continue;
    for (const nb of walkableNeighbors(state, n.x, n.y, n.dist === 0 ? undefined : extra)) {
      const k = `${nb.x},${nb.y}`;
      if (seen.has(k)) continue;
      const arrive = (n.dist + 1) * ticksPerTile;
      if (marked.has(k) && arrive >= CONFIG.FUSE_TICKS) continue;
      seen.add(k);
      q.push({ x: nb.x, y: nb.y, dist: n.dist + 1 });
    }
  }
  return false;
}

function bfs(
  state: RoundState,
  sx: number,
  sy: number,
  goal: (x: number, y: number) => boolean,
  danger: DangerGrid,
  maxDist = 40,
): Dir | null {
  const w = state.arena.width;
  const key = (x: number, y: number) => y * w + x;
  const seen = new Set<number>([key(sx, sy)]);
  const q: { x: number; y: number; first: Dir; dist: number }[] = [];
  for (const dir of DIRS) {
    const d = dirVec(dir);
    const nx = sx + d.x;
    const ny = sy + d.y;
    if (blocked(state, nx, ny)) continue;
    if ((danger[tileIndex(nx, ny, w)] ?? SAFE) < SAFE) continue;
    seen.add(key(nx, ny));
    q.push({ x: nx, y: ny, first: dir, dist: 1 });
  }
  let i = 0;
  while (i < q.length) {
    const n = q[i++]!;
    if (goal(n.x, n.y)) return n.first;
    if (n.dist >= maxDist) continue;
    for (const dir of DIRS) {
      const d = dirVec(dir);
      const nx = n.x + d.x;
      const ny = n.y + d.y;
      const k = key(nx, ny);
      if (seen.has(k) || blocked(state, nx, ny)) continue;
      if ((danger[tileIndex(nx, ny, w)] ?? SAFE) < SAFE) continue;
      seen.add(k);
      q.push({ x: nx, y: ny, first: n.first, dist: n.dist + 1 });
    }
  }
  return null;
}

function targetDir(state: RoundState, me: PlayerState, danger: DangerGrid, difficulty: BotDifficulty): Dir {
  const tx = Math.floor(me.x + 0.5);
  const ty = Math.floor(me.y + 0.5);
  const pu = state.exposed[0];
  if (pu) {
    const d = bfs(state, tx, ty, (x, y) => x === pu.tx && y === pu.ty, danger, 24);
    if (d) return d;
  }
  const castle = bfs(
    state,
    tx,
    ty,
    (x, y) => DIRS.some((dir) => tileAt(state, x + dirVec(dir).x, y + dirVec(dir).y) === "castle"),
    danger,
    20,
  );
  if (difficulty === "easy") {
    if (Math.random() < 0.35) return DIRS[Math.floor(Math.random() * 4)]!;
    return castle ?? DIRS[Math.floor(Math.random() * 4)]!;
  }

  let nearest: { x: number; y: number; dist: number } | null = null;
  for (const o of state.players) {
    if (o.id === me.id || o.status !== "alive") continue;
    const ox = Math.floor(o.x + 0.5);
    const oy = Math.floor(o.y + 0.5);
    const dist = Math.abs(ox - tx) + Math.abs(oy - ty);
    if (!nearest || dist < nearest.dist) nearest = { x: ox, y: oy, dist };
  }
  const huntRange = difficulty === "hard" ? 99 : 6;
  if (nearest && nearest.dist <= huntRange) {
    const standOff = difficulty === "hard" ? me.splashRange : 1;
    const d = bfs(
      state,
      tx,
      ty,
      (x, y) => {
        const man = Math.abs(x - nearest!.x) + Math.abs(y - nearest!.y);
        if (difficulty === "hard") return man === standOff || (x === nearest!.x || y === nearest!.y) && man <= standOff;
        return man === 1;
      },
      danger,
      30,
    );
    if (d) return d;
  }
  return castle ?? DIRS[Math.floor(Math.random() * 4)]!;
}

export function think(state: RoundState, brain: BotBrain, me: PlayerState): PlayerInput {
  if (me.status === "revenge") {
    const input: PlayerInput = {
      seq: ++brain.seq,
      tick: state.tick,
      dir: DIRS[state.tick % 4]!,
      balloonPressed: me.revengeCooldown <= 0,
    };
    brain.lastInput = input;
    return input;
  }
  if (me.status !== "alive") {
    const input: PlayerInput = { seq: ++brain.seq, tick: state.tick, dir: "none", balloonPressed: false };
    brain.lastInput = input;
    return input;
  }

  const danger = computeDangerMap(state);
  const tx = Math.floor(me.x + 0.5);
  const ty = Math.floor(me.y + 0.5);
  const here = danger[tileIndex(tx, ty, state.arena.width)] ?? SAFE;
  const inDanger = here < SAFE;
  const interval = intervalTicks(brain.difficulty);
  if (!inDanger && state.tick - brain.lastDecideTick < interval && brain.lastInput.seq > 0) {
    return { ...brain.lastInput, tick: state.tick, balloonPressed: false, seq: ++brain.seq };
  }
  brain.lastDecideTick = state.tick;

  const misjudge = brain.difficulty === "easy" && Math.random() < CONFIG.BOT_EASY_ERROR_RATE;
  let dir: Dir = "none";
  let drop = false;

  if (inDanger && (brain.difficulty !== "easy" || !misjudge)) {
    dir = fleeDir(state, tx, ty, danger);
  } else {
    dir = targetDir(state, me, danger, brain.difficulty);
    const canAttack =
      brain.difficulty === "hard"
        ? state.tick > 20
        : brain.difficulty === "medium"
          ? Math.random() < 0.4 && state.tick > 20
          : Math.random() < 0.12 && state.tick > 40;
    if (canAttack && me.balloonsOut < me.balloonCount && !inDanger) {
      const aligned = state.players.some((o) => {
        if (o.id === me.id || o.status !== "alive") return false;
        const ox = Math.floor(o.x + 0.5);
        const oy = Math.floor(o.y + 0.5);
        const man = Math.abs(ox - tx) + Math.abs(oy - ty);
        const line = ox === tx || oy === ty;
        return man <= me.splashRange + (brain.difficulty === "hard" ? 1 : 0) && (brain.difficulty === "easy" || line || man <= 2);
      });
      const nearCastle = DIRS.some((d) => {
        const v = dirVec(d);
        return tileAt(state, tx + v.x, ty + v.y) === "castle";
      });
      if ((aligned || (nearCastle && brain.difficulty !== "hard")) && canEscapeOwnBalloon(state, me, danger)) drop = true;
      if (brain.difficulty === "hard" && nearCastle && !aligned && canEscapeOwnBalloon(state, me, danger) && state.tick < 200) {
        drop = true;
      }
    }
  }

  const input: PlayerInput = { seq: ++brain.seq, tick: state.tick, dir, balloonPressed: drop };
  brain.lastInput = input;
  return input;
}
