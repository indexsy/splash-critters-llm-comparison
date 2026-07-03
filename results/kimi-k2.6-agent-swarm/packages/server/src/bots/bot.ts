import type { RoundState, Direction, PlayerState, InputFrame } from '@splash-critters/shared';
import {
  CONFIG,
  simulateTick,
  canPlaceBalloon,
  getTile,
  inBounds,
} from '@splash-critters/shared';
import type { DangerMap } from './dangerMap.js';
import { computeDangerMap } from './dangerMap.js';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

export interface BotDecision {
  dir: Direction | null;
  balloonPressed: boolean;
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
const DX: Record<Direction, number> = { up: 0, down: 0, left: -1, right: 1 };
const DY: Record<Direction, number> = { up: -1, down: 1, left: 0, right: 0 };

export class Bot {
  private playerId: string;
  private difficulty: BotDifficulty;
  private rng = Math.random;

  constructor(playerId: string, difficulty: BotDifficulty) {
    this.playerId = playerId;
    this.difficulty = difficulty;
  }

  getDecision(state: RoundState, dangerMap: DangerMap): BotDecision {
    const me = state.players.find((p) => p.playerId === this.playerId);
    if (!me || !me.alive) return { dir: null, balloonPressed: false };

    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);

    // ── Easy difficulty: occasional danger misjudgment ──
    if (
      this.difficulty === 'easy' &&
      this.rng() < CONFIG.BOT_EASY_ERROR_RATE
    ) {
      return this.farmOrWander(state, dangerMap, me);
    }

    // ── 1. Flee if current tile is dangerous ──
    const dangerTime = dangerMap.getDanger({ x: tx, y: ty });
    if (dangerTime !== Infinity && dangerTime <= state.tick + this.fleeBuffer()) {
      const safeTile = this.findNearestSafeTile(state, dangerMap, me);
      if (safeTile) {
        const dir = this.directionToward(me, safeTile, state);
        if (dir) return { dir, balloonPressed: false };
      }
    }

    // ── 2. Place balloon safely ──
    if (canPlaceBalloon(state, this.playerId)) {
      if (this.shouldPlaceBalloon(state, dangerMap, me)) {
        if (this.verifyEscape(state, me)) {
          return { dir: null, balloonPressed: true };
        }
      }
    }

    // ── 3. Farm / collect / attack ──
    return this.farmOrWander(state, dangerMap, me);
  }

  // ─────────────────────── Difficulty tuning ───────────────────────

  private fleeBuffer(): number {
    switch (this.difficulty) {
      case 'easy':
        return 45; // 1.5s
      case 'medium':
        return 30; // 1.0s
      case 'hard':
        return 20; // 0.67s
    }
  }

  private attackRange(): number {
    switch (this.difficulty) {
      case 'easy':
        return 2;
      case 'medium':
        return 4;
      case 'hard':
        return 6;
    }
  }

  private shouldPlaceBalloon(
    state: RoundState,
    _dangerMap: DangerMap,
    me: PlayerState
  ): boolean {
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);

    if (this.difficulty === 'easy') {
      // Easy bots rarely place, and only when standing next to a sandcastle
      if (this.rng() > 0.3) return false;
      return this.hasAdjacentCastle(state, tx, ty);
    }

    if (this.difficulty === 'medium') {
      // Medium: place near castles or within attack range of a player
      if (this.hasAdjacentCastle(state, tx, ty)) return true;
      const nearestEnemy = this.findNearestEnemy(state, me);
      if (nearestEnemy) {
        const dist =
          Math.abs(Math.floor(nearestEnemy.x) - tx) +
          Math.abs(Math.floor(nearestEnemy.y) - ty);
        if (dist <= this.attackRange()) return true;
      }
      return false;
    }

    // Hard: aggressive placement
    // Place near castles, near enemies, or to create chains
    if (this.hasAdjacentCastle(state, tx, ty)) return true;

    const nearestEnemy = this.findNearestEnemy(state, me);
    if (nearestEnemy) {
      const dist =
        Math.abs(Math.floor(nearestEnemy.x) - tx) +
        Math.abs(Math.floor(nearestEnemy.y) - ty);
      if (dist <= this.attackRange()) return true;
    }

    // Hard: place next to existing balloons to engineer chains
    if (this.hasAdjacentBalloon(state, tx, ty)) return true;

    return false;
  }

  // ─────────────────────── Escape verification ───────────────────────

  private verifyEscape(state: RoundState, me: PlayerState): boolean {
    // Simulate placement using the shared sim
    const testInputs = new Map<string, InputFrame>();
    testInputs.set(this.playerId, { dir: null, balloonPressed: true });

    const testState = simulateTick(
      state,
      { tick: state.tick, playerInputs: testInputs },
      CONFIG
    );

    const testDanger = computeDangerMap(testState);

    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    const centerDanger = testDanger.getDanger({ x: tx, y: ty });

    // If the center is safe, no need to escape
    if (centerDanger === Infinity) return true;

    const timeLimit = centerDanger - testState.tick;
    if (timeLimit <= 0) return false;

    // BFS for a safe tile reachable before the danger hits
    const queue: Array<{ x: number; y: number; dist: number }> = [
      { x: tx, y: ty, dist: 0 },
    ];
    const visited = new Set<string>([`${tx},${ty}`]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // A tile is safe if no splash hits it before we can arrive
      if (current.dist > 0) {
        const danger = testDanger.getDanger(current);
        const arrivalTick = testState.tick + this.timeToMove(current.dist, me.speed);
        if (danger === Infinity || danger > arrivalTick + 5) {
          return true;
        }
      }

      if (current.dist >= 15) continue;

      for (const dir of DIRECTIONS) {
        const nx = current.x + DX[dir];
        const ny = current.y + DY[dir];
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        if (!inBounds(testState.map, { x: nx, y: ny })) continue;
        if (!isWalkable(testState, nx, ny, this.playerId)) continue;

        visited.add(key);
        queue.push({ x: nx, y: ny, dist: current.dist + 1 });
      }
    }

    return false;
  }

  private timeToMove(tileCount: number, speed: number): number {
    return Math.ceil(tileCount * (CONFIG.TICK_RATE / speed));
  }

  // ─────────────────────── Target selection ───────────────────────

  private farmOrWander(
    state: RoundState,
    dangerMap: DangerMap,
    me: PlayerState
  ): BotDecision {
    const target = this.findTarget(state, dangerMap, me);
    if (target) {
      const dir = this.directionToward(me, target, state);
      return { dir, balloonPressed: false };
    }
    return { dir: null, balloonPressed: false };
  }

  private findTarget(
    state: RoundState,
    dangerMap: DangerMap,
    me: PlayerState
  ): { x: number; y: number } | null {
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);

    // ── Hard: hunt players aggressively, especially late game ──
    if (this.difficulty === 'hard') {
      const nearestEnemy = this.findNearestEnemy(state, me);
      if (nearestEnemy) {
        const edist =
          Math.abs(Math.floor(nearestEnemy.x) - tx) +
          Math.abs(Math.floor(nearestEnemy.y) - ty);
        // Late game → pure aggression
        if (state.tick > CONFIG.TIDE_START_TICKS * 0.5 || edist <= 3) {
          return { x: Math.floor(nearestEnemy.x), y: Math.floor(nearestEnemy.y) };
        }
      }
    }

    // ── Collect exposed power-ups ──
    const powerUp = this.findNearestPowerUp(state, me);
    if (powerUp) {
      // Hard always collects; medium collects if not already hunting; easy sometimes
      if (
        this.difficulty === 'hard' ||
        (this.difficulty === 'medium' && !this.findNearestEnemy(state, me)) ||
        (this.difficulty === 'easy' && this.rng() < 0.5)
      ) {
        return powerUp;
      }
    }

    // ── Farm sandcastles ──
    const castle = this.findNearestCastle(state, me);
    if (castle) return castle;

    // ── Attack nearest enemy if close enough ──
    const nearestEnemy = this.findNearestEnemy(state, me);
    if (nearestEnemy) {
      const edist =
        Math.abs(Math.floor(nearestEnemy.x) - tx) +
        Math.abs(Math.floor(nearestEnemy.y) - ty);
      if (edist <= this.attackRange()) {
        return { x: Math.floor(nearestEnemy.x), y: Math.floor(nearestEnemy.y) };
      }
    }

    // ── Hard: kick balloons toward enemies if we have boots ──
    if (this.difficulty === 'hard' && me.hasBoots) {
      const kickTarget = this.findBalloonToKick(state, me, dangerMap);
      if (kickTarget) return kickTarget;
    }

    return null;
  }

  // ─────────────────────── Nearest-thing finders ───────────────────────

  private findNearestEnemy(state: RoundState, me: PlayerState): PlayerState | null {
    let best: PlayerState | null = null;
    let bestDist = Infinity;
    for (const p of state.players) {
      if (p.playerId === this.playerId || !p.alive) continue;
      const d =
        Math.abs(Math.floor(p.x) - Math.floor(me.x)) +
        Math.abs(Math.floor(p.y) - Math.floor(me.y));
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  private findNearestCastle(
    state: RoundState,
    me: PlayerState
  ): { x: number; y: number } | null {
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;

    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        if (getTile(state.map, { x, y }) === 'sandcastle') {
          const d = Math.abs(x - tx) + Math.abs(y - ty);
          if (d < bestDist) {
            bestDist = d;
            best = { x, y };
          }
        }
      }
    }
    return best;
  }

  private findNearestPowerUp(
    state: RoundState,
    me: PlayerState
  ): { x: number; y: number } | null {
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;

    for (const [key] of state.exposedPowerUps) {
      const [x, y] = key.split(',').map(Number);
      const d = Math.abs(x - tx) + Math.abs(y - ty);
      if (d < bestDist) {
        bestDist = d;
        best = { x, y };
      }
    }
    return best;
  }

  private findNearestSafeTile(
    state: RoundState,
    dangerMap: DangerMap,
    me: PlayerState
  ): { x: number; y: number } | null {
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    const queue = [{ x: tx, y: ty }];
    const visited = new Set<string>([`${tx},${ty}`]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      const danger = dangerMap.getDanger(current);
      if (danger === Infinity || danger > state.tick + this.fleeBuffer()) {
        return current;
      }

      for (const dir of DIRECTIONS) {
        const nx = current.x + DX[dir];
        const ny = current.y + DY[dir];
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        if (!inBounds(state.map, { x: nx, y: ny })) continue;
        if (!isWalkable(state, nx, ny, this.playerId)) continue;

        visited.add(key);
        queue.push({ x: nx, y: ny });
      }
    }

    return null;
  }

  // ─────────────────────── Kick logic (hard) ───────────────────────

  private findBalloonToKick(
    state: RoundState,
    me: PlayerState,
    _dangerMap: DangerMap
  ): { x: number; y: number } | null {
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    const nearestEnemy = this.findNearestEnemy(state, me);
    if (!nearestEnemy) return null;

    for (const dir of DIRECTIONS) {
      const nx = tx + DX[dir];
      const ny = ty + DY[dir];
      if (!inBounds(state.map, { x: nx, y: ny })) continue;

      const b = state.balloons.find((bl) => bl.x === nx && bl.y === ny);
      if (!b) continue;
      if (b.isKicked) continue;

      // Is kicking this toward an enemy or into a tight corridor?
      const enemyTx = Math.floor(nearestEnemy.x);
      const enemyTy = Math.floor(nearestEnemy.y);
      const kickDx = DX[dir];
      const kickDy = DY[dir];

      // Simple heuristic: kick toward enemy general direction
      const afterKick = { x: nx + kickDx * 3, y: ny + kickDy * 3 };
      const distToEnemy =
        Math.abs(afterKick.x - enemyTx) + Math.abs(afterKick.y - enemyTy);
      if (distToEnemy < Math.abs(nx - enemyTx) + Math.abs(ny - enemyTy)) {
        // Target the balloon tile so we move into it and trigger the kick
        return { x: nx, y: ny };
      }
    }

    return null;
  }

  // ─────────────────────── Utility helpers ───────────────────────

  private directionToward(
    me: PlayerState,
    target: { x: number; y: number },
    state: RoundState
  ): Direction | null {
    const path = findPath(
      { x: Math.floor(me.x), y: Math.floor(me.y) },
      target,
      state,
      this.playerId
    );
    if (!path || path.length === 0) return null;
    return path[0];
  }

  private hasAdjacentCastle(state: RoundState, tx: number, ty: number): boolean {
    for (const dir of DIRECTIONS) {
      const nx = tx + DX[dir];
      const ny = ty + DY[dir];
      if (!inBounds(state.map, { x: nx, y: ny })) continue;
      if (getTile(state.map, { x: nx, y: ny }) === 'sandcastle') return true;
    }
    return false;
  }

  private hasAdjacentBalloon(state: RoundState, tx: number, ty: number): boolean {
    for (const dir of DIRECTIONS) {
      const nx = tx + DX[dir];
      const ny = ty + DY[dir];
      if (state.balloons.some((b) => b.x === nx && b.y === ny)) return true;
    }
    return false;
  }
}

// ─────────────────────── Exported helpers ───────────────────────

export function findPath(
  start: { x: number; y: number },
  goal: { x: number; y: number },
  state: RoundState,
  excludePlayerId?: string
): Direction[] | null {
  const queue: Array<{ x: number; y: number; path: Direction[] }> = [
    { x: start.x, y: start.y, path: [] },
  ];
  const visited = new Set<string>([`${start.x},${start.y}`]);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.x === goal.x && current.y === goal.y) {
      return current.path;
    }

    for (const dir of DIRECTIONS) {
      const nx = current.x + DX[dir];
      const ny = current.y + DY[dir];
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (!inBounds(state.map, { x: nx, y: ny })) continue;

      const tile = getTile(state.map, { x: nx, y: ny });
      if (tile === 'boulder' || tile === 'water') continue;

      // Sandcastle is an obstacle unless it is the goal tile
      if (tile === 'sandcastle' && (nx !== goal.x || ny !== goal.y)) continue;

      // Balloons are obstacles
      if (state.balloons.some((b) => b.x === nx && b.y === ny)) continue;

      // Other alive players are obstacles
      if (
        state.players.some(
          (p) =>
            p.alive &&
            p.playerId !== excludePlayerId &&
            Math.floor(p.x) === nx &&
            Math.floor(p.y) === ny
        )
      )
        continue;

      visited.add(key);
      queue.push({ x: nx, y: ny, path: [...current.path, dir] });
    }
  }

  return null;
}

export function isWalkable(
  state: RoundState,
  x: number,
  y: number,
  excludePlayerId?: string
): boolean {
  if (!inBounds(state.map, { x, y })) return false;

  const tile = getTile(state.map, { x, y });
  if (tile === 'boulder' || tile === 'sandcastle' || tile === 'water') return false;

  if (state.balloons.some((b) => b.x === x && b.y === y)) return false;

  if (
    state.players.some(
      (p) =>
        p.alive &&
        p.playerId !== excludePlayerId &&
        Math.floor(p.x) === x &&
        Math.floor(p.y) === y
    )
  )
    return false;

  return true;
}
