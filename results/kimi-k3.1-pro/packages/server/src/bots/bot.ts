import { CONFIG, cloneGameState, directionDelta, findBalloonAt, mapIndex, mulberry32, tileAt, traceSplash, TILE } from "@splash/shared";
import type { BotDifficulty, CardinalDirection, Direction, GameState, PlayerInput, PlayerState } from "@splash/shared";
import { buildDangerMap, isSafeAt, type DangerMap } from "./dangerMap.js";

interface PathNode {
  x: number;
  y: number;
  steps: number;
  path: CardinalDirection[];
}

interface Hypothetical {
  x: number;
  y: number;
  cells: Set<number>;
}

const CARDINALS: CardinalDirection[] = ["up", "down", "left", "right"];

function seedFor(id: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function intervalFor(difficulty: BotDifficulty): number {
  if (difficulty === "easy") return CONFIG.BOTS.EASY_INTERVAL_TICKS;
  if (difficulty === "medium") return CONFIG.BOTS.MEDIUM_INTERVAL_TICKS;
  return CONFIG.BOTS.HARD_INTERVAL_TICKS;
}

function errorFor(difficulty: BotDifficulty): number {
  if (difficulty === "easy") return CONFIG.BOTS.EASY_ERROR_RATE;
  if (difficulty === "medium") return CONFIG.BOTS.MEDIUM_ERROR_RATE;
  return CONFIG.BOTS.HARD_ERROR_RATE;
}

function passable(state: GameState, x: number, y: number, startX: number, startY: number, hypothetical: Hypothetical | null): boolean {
  if (tileAt(state.map, x, y) !== TILE.FLOOR) return false;
  if (findBalloonAt(state, x, y)) return false;
  if (hypothetical?.x === x && hypothetical.y === y && (x !== startX || y !== startY)) return false;
  return true;
}

export class BotBrain {
  private readonly random: () => number;
  private nextThink = 0;
  private sequence = 0;
  private direction: Direction = "none";
  private plannedPath: CardinalDirection[] = [];
  private pathTarget: { x: number; y: number } | null = null;
  private escaping = false;
  private round = 0;

  constructor(readonly playerId: string, readonly difficulty: BotDifficulty, matchSeed: number) {
    this.random = mulberry32(seedFor(playerId, matchSeed));
  }

  private awarenessHorizon(): number {
    return this.difficulty === "easy" ? CONFIG.SPLASH_LINGER_TICKS : CONFIG.BALLOON_FUSE_TICKS;
  }

  private safe(danger: DangerMap, index: number, arrival: number, linger = 0): boolean {
    const safe = isSafeAt(danger, index, arrival, linger);
    if (!safe && this.random() < errorFor(this.difficulty)) return true;
    return safe;
  }

  private extraSafe(state: GameState, extra: Hypothetical | null, index: number, arrival: number, linger = 0): boolean {
    if (!extra?.cells.has(index)) return true;
    const burst = CONFIG.BALLOON_FUSE_TICKS;
    return arrival + linger < burst || arrival > burst + CONFIG.SPLASH_LINGER_TICKS;
  }

  private escape(state: GameState, player: PlayerState, danger: DangerMap, hypothetical: Hypothetical | null): CardinalDirection[] | null {
    const startX = Math.round(player.x);
    const startY = Math.round(player.y);
    const tileTicks = Math.max(1, Math.ceil(CONFIG.TICK_RATE / player.speed));
    const queue: PathNode[] = [{ x: startX, y: startY, steps: 0, path: [] }];
    const visited = new Set([`${startX},${startY}`]);
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) break;
      const arrival = node.steps * tileTicks;
      const index = mapIndex(state.map, node.x, node.y);
      const remaining = Math.max(CONFIG.SPLASH_LINGER_TICKS, CONFIG.BALLOON_FUSE_TICKS + CONFIG.SPLASH_LINGER_TICKS - arrival);
      if (node.steps > 0 && this.safe(danger, index, arrival, remaining) && this.extraSafe(state, hypothetical, index, arrival, remaining)) return node.path;
      if (node.steps >= 14) continue;
      for (const direction of CARDINALS) {
        const delta = directionDelta(direction);
        const x = node.x + delta.x;
        const y = node.y + delta.y;
        const key = `${x},${y}`;
        if (visited.has(key) || !passable(state, x, y, startX, startY, hypothetical)) continue;
        const nextArrival = (node.steps + 1) * tileTicks;
        const nextIndex = mapIndex(state.map, x, y);
        if (!this.safe(danger, nextIndex, nextArrival) || !this.extraSafe(state, hypothetical, nextIndex, nextArrival)) continue;
        visited.add(key);
        queue.push({ x, y, steps: node.steps + 1, path: [...node.path, direction] });
      }
    }
    return null;
  }

  private pathTo(state: GameState, player: PlayerState, danger: DangerMap, goals: Set<number>): CardinalDirection[] | null {
    if (goals.size === 0) return null;
    const startX = Math.round(player.x);
    const startY = Math.round(player.y);
    const tileTicks = Math.max(1, Math.ceil(CONFIG.TICK_RATE / player.speed));
    const queue: PathNode[] = [{ x: startX, y: startY, steps: 0, path: [] }];
    const visited = new Set([`${startX},${startY}`]);
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) break;
      const index = mapIndex(state.map, node.x, node.y);
      if (node.steps > 0 && goals.has(index)) return node.path;
      if (node.steps >= 20) continue;
      for (const direction of CARDINALS) {
        const delta = directionDelta(direction);
        const x = node.x + delta.x;
        const y = node.y + delta.y;
        const key = `${x},${y}`;
        if (visited.has(key) || !passable(state, x, y, startX, startY, null)) continue;
        const nextIndex = mapIndex(state.map, x, y);
        if (!this.safe(danger, nextIndex, (node.steps + 1) * tileTicks, this.awarenessHorizon())) continue;
        visited.add(key);
        queue.push({ x, y, steps: node.steps + 1, path: [...node.path, direction] });
      }
    }
    return null;
  }

  private setPath(path: CardinalDirection[], escaping = false): void {
    this.plannedPath = [...path];
    this.pathTarget = null;
    this.escaping = escaping;
  }

  private followPath(player: PlayerState): void {
    if (this.pathTarget) {
      const atTarget = Math.round(player.x) === this.pathTarget.x && Math.round(player.y) === this.pathTarget.y && Math.abs(player.x - this.pathTarget.x) < 0.24 && Math.abs(player.y - this.pathTarget.y) < 0.24;
      if (!atTarget) return;
      this.pathTarget = null;
    }
    const next = this.plannedPath.shift();
    if (!next) {
      this.direction = "none";
      this.escaping = false;
      return;
    }
    this.direction = next;
    const delta = directionDelta(next);
    this.pathTarget = { x: Math.round(player.x) + delta.x, y: Math.round(player.y) + delta.y };
  }

  private canDrop(state: GameState, player: PlayerState): boolean {
    const x = Math.round(player.x);
    const y = Math.round(player.y);
    if (findBalloonAt(state, x, y)) return false;
    return state.balloons.filter((balloon) => balloon.ownerId === player.id && !balloon.revenge).length < player.balloonCount;
  }

  private hypotheticalAt(state: GameState, player: PlayerState, x: number, y: number): Hypothetical {
    const cells = traceSplash(state.map, x, y, player.splashRange);
    return { x, y, cells: new Set(cells.map((cell) => mapIndex(state.map, cell.x, cell.y))) };
  }

  private hypothetical(state: GameState, player: PlayerState): Hypothetical {
    return this.hypotheticalAt(state, player, Math.round(player.x), Math.round(player.y));
  }

  private planBalloon(state: GameState, player: PlayerState): boolean {
    const virtual = cloneGameState(state);
    virtual.balloons.push({
      id: virtual.nextEntityId,
      ownerId: player.id,
      x: Math.round(player.x),
      y: Math.round(player.y),
      fuse: CONFIG.BALLOON_FUSE_TICKS,
      range: player.splashRange,
      passThrough: [player.id],
      kickDir: null,
      direction: "down",
      kickProgress: 0,
      straight: false,
      revenge: false
    });
    const path = this.escape(virtual, player, buildDangerMap(virtual), null);
    if (!path) return false;
    this.setPath(path, true);
    this.direction = "none";
    return true;
  }

  private nearestEnemy(state: GameState, player: PlayerState): PlayerState | undefined {
    return state.players.filter((candidate) => candidate.alive && candidate.id !== player.id).sort((a, b) => {
      const distanceA = Math.abs(Math.round(a.x) - Math.round(player.x)) + Math.abs(Math.round(a.y) - Math.round(player.y));
      const distanceB = Math.abs(Math.round(b.x) - Math.round(player.x)) + Math.abs(Math.round(b.y) - Math.round(player.y));
      return distanceA - distanceB;
    })[0];
  }

  private think(state: GameState, player: PlayerState, danger: DangerMap): boolean {
    if (state.config.tutorial) {
      const x = Math.round(player.x);
      const y = Math.round(player.y);
      const safeDirections = CARDINALS.filter((direction) => {
        const delta = directionDelta(direction);
        const nextX = x + delta.x;
        const nextY = y + delta.y;
        return passable(state, nextX, nextY, x, y, null) && this.safe(danger, mapIndex(state.map, nextX, nextY), 1);
      });
      this.direction = safeDirections.length ? safeDirections[Math.floor(this.random() * safeDirections.length)] : "none";
      this.setPath([]);
      return false;
    }
    const x = Math.round(player.x);
    const y = Math.round(player.y);
    const index = mapIndex(state.map, x, y);
    if (!this.safe(danger, index, 0)) {
      const escape = this.escape(state, player, danger, null);
      if (escape) {
        this.setPath(escape, true);
        this.followPath(player);
      } else {
        this.setPath([]);
        this.direction = "none";
      }
      return false;
    }
    const enemy = this.nearestEnemy(state, player);
    const extra = this.hypothetical(state, player);
    const hitsCastle = extra.cells.has(-1) || traceSplash(state.map, x, y, player.splashRange).some((cell) => tileAt(state.map, cell.x, cell.y) === TILE.CASTLE);
    const predictedEnemy = enemy && enemy.dir !== "none" ? directionDelta(enemy.dir) : null;
    const enemyIndex = enemy ? mapIndex(state.map, Math.round(enemy.x) + (this.difficulty === "hard" && predictedEnemy ? predictedEnemy.x : 0), Math.round(enemy.y) + (this.difficulty === "hard" && predictedEnemy ? predictedEnemy.y : 0)) : -1;
    const hitsEnemy = enemy ? extra.cells.has(enemyIndex) || extra.cells.has(mapIndex(state.map, Math.round(enemy.x), Math.round(enemy.y))) : false;
    const hitsChain = state.balloons.some((balloon) => extra.cells.has(mapIndex(state.map, Math.round(balloon.x), Math.round(balloon.y))));
    const enemyDistance = enemy ? Math.abs(Math.round(enemy.x) - x) + Math.abs(Math.round(enemy.y) - y) : Number.POSITIVE_INFINITY;
    const wantsAttack = this.difficulty === "hard" || (this.difficulty === "medium" && enemyDistance <= 4) || (this.difficulty === "easy" && (this.random() < 0.05 || ((state.tick - state.roundStartedTick) >= CONFIG.BOTS.HARD_AGGRESSION_TICKS * 2 && enemyDistance <= 4)));
    const wantsFarm = this.difficulty !== "easy" || this.random() < 0.45;
    const wantsChain = this.difficulty === "hard" && hitsChain;
    const trapsEnemy = this.difficulty !== "easy" && enemy ? !this.escape(state, enemy, danger, extra) : false;
    const hardZone = this.difficulty === "hard" && enemyDistance <= 6 && ((state.tick - state.roundStartedTick) >= CONFIG.BOTS.HARD_AGGRESSION_TICKS || player.balloonCount > 1 || player.splashRange > CONFIG.BASE_SPLASH_RANGE);
    if (this.canDrop(state, player) && (trapsEnemy || wantsChain || hardZone || (hitsEnemy && wantsAttack) || (hitsCastle && wantsFarm))) {
      if (this.planBalloon(state, player)) return true;
    }
    if (this.difficulty === "hard" && player.kick && enemy) {
      for (const direction of CARDINALS) {
        const delta = directionDelta(direction);
        const balloon = findBalloonAt(state, x + delta.x, y + delta.y);
        if (!balloon || balloon.kickDir) continue;
        const enemySide = Math.sign(Math.round(enemy.x) - x) === delta.x && Math.sign(Math.round(enemy.y) - y) === delta.y;
        if (enemySide) {
          this.direction = direction;
          this.setPath([]);
          return false;
        }
      }
    }
    if (this.difficulty === "hard" && enemy && enemyDistance <= 7 && !trapsEnemy) {
      const goals = new Set<number>();
      for (const direction of CARDINALS) {
        const delta = directionDelta(direction);
        const candidateX = x + delta.x;
        const candidateY = y + delta.y;
        if (!passable(state, candidateX, candidateY, x, y, null)) continue;
        const candidate = this.hypotheticalAt(state, player, candidateX, candidateY);
        if (!this.escape(state, enemy, danger, candidate)) goals.add(mapIndex(state.map, candidateX, candidateY));
      }
      const trapPath = this.pathTo(state, player, danger, goals);
      if (trapPath?.length) {
        this.setPath(trapPath);
        this.followPath(player);
        return false;
      }
    }
    if (state.powerups.length > 0 && (this.difficulty !== "hard" || (state.tick - state.roundStartedTick) < CONFIG.BOTS.HARD_AGGRESSION_TICKS * 2)) {
      const path = this.pathTo(state, player, danger, new Set(state.powerups.map((powerup) => mapIndex(state.map, powerup.x, powerup.y))));
      if (path?.length) {
        this.setPath(path);
        this.followPath(player);
        return false;
      }
    }
    if (enemy && ((this.difficulty === "hard" && (state.tick - state.roundStartedTick) >= CONFIG.BOTS.HARD_AGGRESSION_TICKS) || (this.difficulty !== "hard" && enemyDistance <= 4))) {
      const path = this.pathTo(state, player, danger, new Set([mapIndex(state.map, Math.round(enemy.x), Math.round(enemy.y))]));
      if (path?.length) {
        this.setPath(path);
        this.followPath(player);
        return false;
      }
    }
    const castleGoals = new Set<number>();
    for (let castleY = 1; castleY < state.map.height - 1; castleY += 1) {
      for (let castleX = 1; castleX < state.map.width - 1; castleX += 1) {
        if (tileAt(state.map, castleX, castleY) !== TILE.CASTLE) continue;
        for (const direction of CARDINALS) {
          const delta = directionDelta(direction);
          if (tileAt(state.map, castleX + delta.x, castleY + delta.y) === TILE.FLOOR) castleGoals.add(mapIndex(state.map, castleX + delta.x, castleY + delta.y));
        }
      }
    }
    const farmPath = this.pathTo(state, player, danger, castleGoals);
    if (farmPath?.length) {
      this.setPath(farmPath);
      this.followPath(player);
      return false;
    }
    if (this.difficulty === "hard" && enemy) {
      const predictedX = Math.round(enemy.x) + (predictedEnemy?.x ?? 0);
      const predictedY = Math.round(enemy.y) + (predictedEnemy?.y ?? 0);
      const huntPath = this.pathTo(state, player, danger, new Set([mapIndex(state.map, predictedX, predictedY)]));
      if (huntPath?.length) {
        this.setPath(huntPath);
        this.followPath(player);
        return false;
      }
    }
    const safeDirections = CARDINALS.filter((direction) => {
      const delta = directionDelta(direction);
      const nextX = x + delta.x;
      const nextY = y + delta.y;
      return passable(state, nextX, nextY, x, y, null) && this.safe(danger, mapIndex(state.map, nextX, nextY), 1, this.awarenessHorizon());
    });
    this.direction = safeDirections.length ? safeDirections[Math.floor(this.random() * safeDirections.length)] : "none";
    this.setPath([]);
    return false;
  }

  input(state: GameState, danger = buildDangerMap(state)): PlayerInput {
    this.sequence += 1;
    if (this.round !== state.round) {
      this.round = state.round;
      this.setPath([]);
      this.direction = "none";
      this.nextThink = state.tick;
    }
    const player = state.players.find((candidate) => candidate.id === this.playerId);
    if (!player || state.phase !== "playing") return { seq: this.sequence, dir: "none", balloonPressed: false };
    if (!player.alive) return { seq: this.sequence, dir: "none", balloonPressed: player.revengeCooldown === 0 };
    let balloonPressed = false;
    const index = mapIndex(state.map, Math.round(player.x), Math.round(player.y));
    const urgent = !this.safe(danger, index, 0);
    if (urgent) {
      balloonPressed = this.think(state, player, danger);
      this.nextThink = state.tick + intervalFor(this.difficulty);
    } else if (this.escaping && (this.pathTarget || this.plannedPath.length > 0)) {
      this.followPath(player);
    } else if (state.tick >= this.nextThink) {
      balloonPressed = this.think(state, player, danger);
      this.nextThink = state.tick + intervalFor(this.difficulty);
    } else if (this.pathTarget || this.plannedPath.length > 0) {
      this.followPath(player);
    }
    return { seq: this.sequence, dir: this.direction, balloonPressed };
  }
}
