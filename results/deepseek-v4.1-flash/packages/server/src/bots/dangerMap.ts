import {
  CONFIG,
  playerTile,
  isTileFlooded,
  type BalloonState,
  type Dir,
  type PlayerState,
  type RoundState,
  type Vec,
} from "@splash/shared";

export interface Danger {
  tick: number;
  ownerId: string | null;
}

export interface ExtraBalloon {
  ownerId: string;
  x: number;
  y: number;
  range: number;
  fuseTicks?: number;
}

const CARDINALS: Array<{ dir: Dir; dx: number; dy: number }> = [
  { dir: "up", dx: 0, dy: -1 },
  { dir: "down", dx: 0, dy: 1 },
  { dir: "left", dx: -1, dy: 0 },
  { dir: "right", dx: 1, dy: 0 },
];

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function blastTiles(state: RoundState, balloon: BalloonState): Vec[] {
  const tiles: Vec[] = [{ x: balloon.x, y: balloon.y }];
  for (const vector of CARDINALS) {
    for (let step = 1; step <= balloon.range; step += 1) {
      const x = balloon.x + vector.dx * step;
      const y = balloon.y + vector.dy * step;
      if (x < 0 || y < 0 || x >= state.arena.w || y >= state.arena.h) break;
      if (state.arena.boulders[y]?.[x]) break;
      tiles.push({ x, y });
      if (state.arena.castles[y]?.[x] === 1) break;
    }
  }
  return tiles;
}

function toBalloon(state: RoundState, extra: ExtraBalloon): BalloonState {
  return {
    id: -1,
    ownerId: extra.ownerId,
    x: extra.x,
    y: extra.y,
    range: extra.range,
    placedTick: state.tick,
    burstTick: state.tick + (extra.fuseTicks ?? CONFIG.FUSE_TICKS),
    kickedDir: "none",
    slideCooldown: 0,
    source: "balloon",
  };
}

export function buildDangerMap(
  state: RoundState,
  extra?: ExtraBalloon,
): Map<string, Danger> {
  const balloons = state.balloons.map((balloon) => ({ ...balloon }));
  if (extra) balloons.push(toBalloon(state, extra));
  const effective = new Map<number, number>();
  for (const balloon of balloons) {
    effective.set(balloon.id, Math.max(balloon.burstTick, state.tick + 1));
  }
  for (let pass = 0; pass < balloons.length + 2; pass += 1) {
    let changed = false;
    for (const source of balloons) {
      const sourceBurst = effective.get(source.id) ?? source.burstTick;
      const blast = new Set(blastTiles(state, source).map((tile) => tileKey(tile.x, tile.y)));
      for (const target of balloons) {
        if (target.id === source.id) continue;
        if (!blast.has(tileKey(target.x, target.y))) continue;
        if (sourceBurst < (effective.get(target.id) ?? target.burstTick)) {
          effective.set(target.id, sourceBurst);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const danger = new Map<string, Danger>();
  for (const balloon of balloons) {
    const burstAt = effective.get(balloon.id) ?? balloon.burstTick;
    for (const tile of blastTiles(state, balloon)) {
      const key = tileKey(tile.x, tile.y);
      const existing = danger.get(key);
      if (!existing || burstAt < existing.tick) {
        danger.set(key, { tick: burstAt, ownerId: balloon.ownerId });
      }
    }
  }
  if (state.tide.active) {
    for (let y = 0; y < state.arena.h; y += 1) {
      for (let x = 0; x < state.arena.w; x += 1) {
        if (isTileFlooded(state.arena, state.tide, x, y)) {
          danger.set(tileKey(x, y), { tick: state.tick, ownerId: null });
        }
      }
    }
  }
  return danger;
}

function walkable(
  state: RoundState,
  x: number,
  y: number,
  startX: number,
  startY: number,
): boolean {
  if (x < 0 || y < 0 || x >= state.arena.w || y >= state.arena.h) return false;
  if (state.arena.boulders[y]?.[x]) return false;
  if (state.arena.castles[y]?.[x] === 1) return false;
  if (isTileFlooded(state.arena, state.tide, x, y)) return false;
  if (x === startX && y === startY) return true;
  return !state.balloons.some((balloon) => balloon.x === x && balloon.y === y);
}

export function nearestSafeTile(
  state: RoundState,
  player: PlayerState,
  danger: Map<string, Danger>,
  marginTicks = 8,
): Vec[] | null {
  const start = playerTile(player);
  if (state.ended || !player.alive) return null;
  const visited = new Set<string>([tileKey(start.x, start.y)]);
  const queue: Array<{ x: number; y: number; path: Vec[] }> = [
    { x: start.x, y: start.y, path: [] },
  ];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const entry = danger.get(tileKey(current.x, current.y));
    const safe = !entry;
    if (safe && (current.x !== start.x || current.y !== start.y)) {
      return current.path;
    }
    for (const vector of CARDINALS) {
      const nx = current.x + vector.dx;
      const ny = current.y + vector.dy;
      const key = tileKey(nx, ny);
      if (visited.has(key)) continue;
      if (!walkable(state, nx, ny, start.x, start.y)) continue;
      visited.add(key);
      queue.push({
        x: nx,
        y: ny,
        path: [...current.path, { x: nx, y: ny }],
      });
    }
  }
  return null;
}

export function pathToTarget(
  state: RoundState,
  player: PlayerState,
  target: Vec,
  danger?: Map<string, Danger>,
): Vec[] | null {
  const start = playerTile(player);
  if (start.x === target.x && start.y === target.y) return [];
  const visited = new Set<string>([tileKey(start.x, start.y)]);
  const queue: Array<{ x: number; y: number; path: Vec[] }> = [
    { x: start.x, y: start.y, path: [] },
  ];
  const dangerous = (x: number, y: number): boolean => {
    if (!danger) return false;
    const entry = danger.get(tileKey(x, y));
    return Boolean(entry && entry.tick <= state.tick + CONFIG.SPLASH_TICKS + 14);
  };
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const vector of CARDINALS) {
      const nx = current.x + vector.dx;
      const ny = current.y + vector.dy;
      const key = tileKey(nx, ny);
      if (visited.has(key)) continue;
      const isGoal = nx === target.x && ny === target.y;
      if (!isGoal && !walkable(state, nx, ny, start.x, start.y)) continue;
      if (!isGoal && dangerous(nx, ny)) continue;
      if (isGoal && dangerous(nx, ny)) continue;
      if (isGoal) {
        return [...current.path, { x: nx, y: ny }];
      }
      visited.add(key);
      queue.push({
        x: nx,
        y: ny,
        path: [...current.path, { x: nx, y: ny }],
      });
    }
  }
  return null;
}

export function directionToNextTile(
  player: PlayerState,
  next: Vec,
): Dir {
  const tile = playerTile(player);
  if (next.x > tile.x) return "right";
  if (next.x < tile.x) return "left";
  if (next.y > tile.y) return "down";
  if (next.y < tile.y) return "up";
  const cx = next.x + 0.5;
  const cy = next.y + 0.5;
  const dx = cx - player.x;
  const dy = cy - player.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

export function isImmediateDanger(
  state: RoundState,
  player: PlayerState,
  danger: Map<string, Danger>,
  warningTicks = 18,
): boolean {
  const tile = playerTile(player);
  const entry = danger.get(tileKey(tile.x, tile.y));
  return Boolean(entry && entry.tick <= state.tick + warningTicks);
}

export function canEscapeOwnBlast(
  state: RoundState,
  player: PlayerState,
  extra?: ExtraBalloon,
): Vec[] | null {
  const danger = buildDangerMap(state, extra);
  return nearestSafeTile(state, player, danger);
}
