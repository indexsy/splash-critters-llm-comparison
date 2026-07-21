import { CONFIG, type Difficulty, type Direction, type GameState, type PlayerInput, type SimPlayer } from "@splash/shared";
import { computeDangerMap, dangerArrival, dangerKey, isDangerousNow, type DangerMap } from "./dangerMap.js";

const DIRECTIONS: ReadonlyArray<Exclude<Direction, "none">> = ["up", "down", "left", "right"];
const VECTOR: Record<Exclude<Direction, "none">, { x: number; y: number }> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
};

interface PathNode { x: number; y: number; from: Direction | "none"; depth: number; prev: PathNode | null }

function tilePassable(state: GameState, x: number, y: number, ignorePlayer?: string): boolean {
  const tile = state.map.tiles[y]?.[x];
  if (tile === undefined || tile === 1 || tile === 2) return false;
  const balloon = state.balloons.find((b) => b.x === x && b.y === y);
  if (balloon && !balloon.ownerMayPass) return false;
  const occupant = state.players.find((p) => p.alive && p.id !== ignorePlayer && Math.floor(p.x) === x && Math.floor(p.y) === y);
  return !occupant;
}

function bfs(state: GameState, startX: number, startY: number, danger: DangerMap, currentTick: number, maxDepth: number): PathNode | null {
  const visited = new Set<string>([dangerKey(startX, startY)]);
  const queue: PathNode[] = [{ x: startX, y: startY, from: "none", depth: 0, prev: null }];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.depth > 0) {
      const arrivalTick = currentTick + Math.ceil(node.depth * CONFIG.TICK_RATE / CONFIG.BASE_SPEED);
      const d = dangerArrival(danger, node.x, node.y);
      const safe = d === undefined;
      if (safe) return node;
    }
    if (node.depth >= maxDepth) continue;
    for (const dir of DIRECTIONS) {
      const v = VECTOR[dir];
      if (!v) continue;
      const nx = node.x + v.x;
      const ny = node.y + v.y;
      const key = dangerKey(nx, ny);
      if (visited.has(key)) continue;
      if (!tilePassable(state, nx, ny)) continue;
      if (isDangerousNow(danger, nx, ny, currentTick)) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny, from: dir, depth: node.depth + 1, prev: node });
    }
  }
  return null;
}

function firstStep(safe: PathNode): Direction {
  let node: PathNode = safe;
  while (node.prev && node.prev.prev) node = node.prev;
  return node.from === "none" ? "none" : node.from;
}

function nearestOpponent(state: GameState, me: SimPlayer): SimPlayer | undefined {
  let best: SimPlayer | undefined;
  let bestDist = Infinity;
  for (const p of state.players) {
    if (p.id === me.id || !p.alive) continue;
    const dist = Math.abs(p.x - me.x) + Math.abs(p.y - me.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

function canReachSafeAfterBalloon(state: GameState, me: SimPlayer, danger: DangerMap, balloonX: number, balloonY: number, range: number): boolean {
  const predicted: DangerMap = new Map(danger);
  const nowTick = state.tick;
  const burstTick = nowTick + CONFIG.BALLOON_FUSE_TICKS;
  const blockTile = (x: number, y: number): void => {
    const current = predicted.get(dangerKey(x, y));
    if (current === undefined || burstTick < current) predicted.set(dangerKey(x, y), burstTick);
  };
  blockTile(balloonX, balloonY);
  for (const v of VECTOR_RUN) {
    for (let distance = 1; distance <= range; distance++) {
      const x = balloonX + v.x * distance;
      const y = balloonY + v.y * distance;
      const tile = state.map.tiles[y]?.[x] ?? 1;
      if (tile === 1) break;
      blockTile(x, y);
      if (tile === 2) break;
    }
  }
  return bfs(state, Math.floor(me.x), Math.floor(me.y), predicted, nowTick, 12) !== null;
}

const VECTOR_RUN = Object.values(VECTOR);

export function decideBotInput(state: GameState, playerId: string, difficulty: Difficulty, seq: number, rng: () => number): PlayerInput {
  const me = state.players.find((p) => p.id === playerId);
  const tick = state.tick;
  const errorRate = CONFIG.BOT_ERROR_RATE[difficulty];
  const input: PlayerInput = {
    playerId, seq, tick, dir: "none", balloonPressed: false
  };
  if (!me || !me.alive) {
    if (me && !me.alive && CONFIG.ENABLE_REVENGE_DUCKS && !state.ranked && state.tick >= me.revengeReadyAt) {
      if (rng() < 0.3) input.revengePressed = true;
    }
    return input;
  }
  if (rng() < errorRate) {
    if (rng() < 0.5) input.dir = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]!;
    return input;
  }
  const danger = computeDangerMap(state);
  const myTileX = Math.floor(me.x);
  const myTileY = Math.floor(me.y);
  const currentDanger = dangerArrival(danger, myTileX, myTileY);
  if (currentDanger !== undefined && currentDanger <= tick + 40) {
    const escape = bfs(state, myTileX, myTileY, danger, tick, 16);
    if (escape) {
      input.dir = firstStep(escape);
    } else {
      const fallback = pickLeastBadNeighbor(state, myTileX, myTileY, danger, tick);
      input.dir = fallback;
    }
    return input;
  }
  const opponent = nearestOpponent(state, me);
  const wantAggression = difficulty !== "easy";
  const inRange = opponent ? Math.abs(opponent.x - me.x) + Math.abs(opponent.y - me.y) <= me.stats.splashRange + 1.5 : false;
  const castleInRange = hasCastleInSplash(state, myTileX, myTileY, me.stats.splashRange);
  const wantsToDrop = (wantAggression && opponent && inRange) || (castleInRange && (difficulty !== "easy" || rng() < 0.45));
  if (wantsToDrop && me.activeBalloons < me.stats.balloonCount) {
    if (canReachSafeAfterBalloon(state, me, danger, myTileX, myTileY, me.stats.splashRange)) {
      input.balloonPressed = true;
      const escape = bfs(state, myTileX, myTileY, danger, tick, 16);
      if (escape) input.dir = firstStep(escape);
      return input;
    }
  }
  if (wantAggression && opponent && difficulty === "hard" && rng() < 0.25) {
    const dx = opponent.x - me.x;
    const dy = opponent.y - me.y;
    const targetDir: Direction = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? "right" : "left")
      : (dy > 0 ? "down" : "up");
    const next = nextTile(myTileX, myTileY, targetDir);
    if (tilePassable(state, next.x, next.y, me.id) && !isDangerousNow(danger, next.x, next.y, tick)) {
      const stillSafe = bfs(state, next.x, next.y, danger, tick, 10) !== null;
      if (stillSafe) {
        input.dir = targetDir;
        return input;
      }
    }
  }
  const wander = bfs(state, myTileX, myTileY, danger, tick, 10);
  if (wander && rng() < 0.6) {
    input.dir = firstStep(wander);
  } else if (rng() < 0.25) {
    input.dir = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]!;
  }
  return input;
}

function hasCastleInSplash(state: GameState, x: number, y: number, range: number): boolean {
  for (const vector of VECTOR_RUN) {
    for (let distance = 1; distance <= range; distance++) {
      const tile = state.map.tiles[y + vector.y * distance]?.[x + vector.x * distance] ?? 1;
      if (tile === 1) break;
      if (tile === 2) return true;
    }
  }
  return false;
}

function pickLeastBadNeighbor(state: GameState, x: number, y: number, danger: DangerMap, tick: number): Direction {
  let best: Direction = "none";
  let bestArrival = -1;
  for (const dir of DIRECTIONS) {
    const v = VECTOR[dir];
    if (!v) continue;
    const nx = x + v.x;
    const ny = y + v.y;
    if (!tilePassable(state, nx, ny)) continue;
    const arrival = dangerArrival(danger, nx, ny) ?? Number.MAX_SAFE_INTEGER;
    if (arrival > bestArrival) {
      bestArrival = arrival;
      best = dir;
    }
  }
  return best;
}

function nextTile(x: number, y: number, dir: Direction): { x: number; y: number } {
  if (dir === "none") return { x, y };
  const v = VECTOR[dir];
  if (!v) return { x, y };
  return { x: x + v.x, y: y + v.y };
}

export interface BotHandle {
  id: string;
  name: string;
  difficulty: Difficulty;
}

let botSeqCounter = 0;
export function nextBotSeq(): number {
  botSeqCounter += 1;
  return botSeqCounter;
}
