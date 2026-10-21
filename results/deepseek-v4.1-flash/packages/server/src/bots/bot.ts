import {
  CONFIG,
  playerTile,
  type Dir,
  type Difficulty,
  type PlayerInput,
  type PlayerState,
  type RoundState,
  type Vec,
} from "@splash/shared";
import { mulberry32, type Rng } from "@splash/shared";
import {
  buildDangerMap,
  directionToNextTile,
  isImmediateDanger,
  nearestSafeTile,
  pathToTarget,
  tileKey,
  type Danger,
  type ExtraBalloon,
} from "./dangerMap.js";

const CARDINALS: Array<{ dir: Dir; dx: number; dy: number }> = [
  { dir: "up", dx: 0, dy: -1 },
  { dir: "down", dx: 0, dy: 1 },
  { dir: "left", dx: -1, dy: 0 },
  { dir: "right", dx: 1, dy: 0 },
];

function manhattan(a: Vec, b: Vec): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function blastSet(state: RoundState, tile: Vec, range: number): Set<string> {
  const result = new Set<string>([tileKey(tile.x, tile.y)]);
  for (const vector of CARDINALS) {
    for (let step = 1; step <= range; step += 1) {
      const x = tile.x + vector.dx * step;
      const y = tile.y + vector.dy * step;
      if (x < 0 || y < 0 || x >= state.arena.w || y >= state.arena.h) break;
      if (state.arena.boulders[y]?.[x]) break;
      result.add(tileKey(x, y));
      if (state.arena.castles[y]?.[x] === 1) break;
    }
  }
  return result;
}

function tileWalkableForBot(state: RoundState, player: PlayerState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.arena.w || y >= state.arena.h) return false;
  if (state.arena.boulders[y]?.[x]) return false;
  if (state.arena.castles[y]?.[x] === 1) return false;
  if (state.balloons.some((balloon) => balloon.x === x && balloon.y === y)) return false;
  const tide = state.tide;
  if (
    tide.active &&
    (x < tide.ring || y < tide.ring || x >= state.arena.w - tide.ring || y >= state.arena.h - tide.ring)
  ) {
    return false;
  }
  void player;
  return true;
}

function nearestCastleTarget(
  state: RoundState,
  player: PlayerState,
  danger: Map<string, Danger>,
): Vec | null {
  const from = playerTile(player);
  const castles: Vec[] = [];
  for (let y = 1; y < state.arena.h - 1; y += 1) {
    for (let x = 1; x < state.arena.w - 1; x += 1) {
      if (state.arena.castles[y]?.[x] === 1) castles.push({ x, y });
    }
  }
  castles.sort((a, b) => manhattan(a, from) - manhattan(b, from));
  for (const castle of castles.slice(0, 20)) {
    const candidates = CARDINALS.map((vector) => ({
      x: castle.x + vector.dx,
      y: castle.y + vector.dy,
    }))
      .filter((tile) => tileWalkableForBot(state, player, tile.x, tile.y))
      .sort((a, b) => manhattan(a, from) - manhattan(b, from));
    for (const candidate of candidates) {
      if (pathToTarget(state, player, candidate, danger)) return candidate;
    }
  }
  return null;
}

function nearestPowerupTarget(
  state: RoundState,
  player: PlayerState,
  danger: Map<string, Danger>,
): Vec | null {
  const from = playerTile(player);
  const sorted = [...state.powerups].sort(
    (a, b) => manhattan(a, from) - manhattan(b, from),
  );
  for (const powerup of sorted) {
    if (pathToTarget(state, player, { x: powerup.x, y: powerup.y }, danger)) {
      return { x: powerup.x, y: powerup.y };
    }
  }
  return null;
}

export class BotBrain {
  readonly playerId: string;
  readonly difficulty: Difficulty;
  private readonly rng: Rng;
  private nextDecision = 0;
  private path: Vec[] = [];
  private evadeUntil = 0;
  private seq = 0;
  private lastX = -1;
  private lastY = -1;
  private stuckTicks = 0;
  private lastDropTick = -999;

  constructor(playerId: string, difficulty: Difficulty, seed: number) {
    this.playerId = playerId;
    this.difficulty = difficulty;
    this.rng = mulberry32(seed);
    this.nextDecision = 0;
  }

  decide(state: RoundState): PlayerInput {
    this.seq += 1;
    const base: PlayerInput = {
      seq: this.seq,
      tick: state.tick + 1,
      dir: "none",
      balloonPressed: false,
    };
    const player = state.players.find((entry) => entry.id === this.playerId);
    if (!player || state.ended) return base;
    if (!player.alive) {
      if (
        state.enableRevengeDucks &&
        state.tick >= player.revengeReadyTick &&
        this.rng.chance(0.012)
      ) {
        return { ...base, balloonPressed: true };
      }
      return base;
    }

    const danger = buildDangerMap(state);
    const currentEntry = danger.get(
      tileKey(Math.floor(player.x), Math.floor(player.y)),
    );
    const ignoreDanger =
      this.difficulty === "easy" &&
      currentEntry !== undefined &&
      currentEntry.ownerId !== player.id &&
      this.rng.chance(CONFIG.BOTS.easy.dangerMistake);

    if (isImmediateDanger(state, player, danger) && !ignoreDanger) {
      this.evade(state, player, danger);
      return { ...base, dir: this.follow(player) };
    }

    if (state.tick < this.evadeUntil) {
      if (this.path.length === 0) this.evade(state, player, danger);
      if (this.path.length > 0) return { ...base, dir: this.follow(player) };
    }

    if (state.tick >= this.nextDecision) {
      const decision = this.plan(state, player, danger);
      if (decision) return { ...base, ...decision };
    }

    return { ...base, dir: this.follow(player) };
  }

  private plan(
    state: RoundState,
    player: PlayerState,
    danger: Map<string, Danger>,
  ): { dir: Dir; balloonPressed: boolean } | null {
    const config = CONFIG.BOTS[this.difficulty];
    this.nextDecision = state.tick + config.decisionTicks;
    const tile = playerTile(player);
    if (tile.x === this.lastX && tile.y === this.lastY) {
      this.stuckTicks += config.decisionTicks;
    } else {
      this.stuckTicks = 0;
      this.lastX = tile.x;
      this.lastY = tile.y;
    }
    if (this.stuckTicks > 45) {
      this.stuckTicks = 0;
      this.path = [];
      const random = this.randomStep(state, player);
      if (random) this.path = [random];
    }

    if (this.difficulty === "easy" && this.rng.chance(0.07)) {
      this.path = [];
    }

    const enemies = state.players.filter((entry) => entry.alive && entry.id !== player.id);
    let targetEnemy: PlayerState | null = null;
    let enemyDistance = Number.POSITIVE_INFINITY;
    for (const enemy of enemies) {
      const et = playerTile(enemy);
      let distance = manhattan(tile, et);
      if (this.difficulty === "hard") {
        const vector = CARDINALS.find((entry) => entry.dir === enemy.dir);
        if (vector) {
          distance = Math.max(0, distance - 1);
        }
      }
      if (distance < enemyDistance) {
        enemyDistance = distance;
        targetEnemy = enemy;
      }
    }

    const rangedDrop = this.shouldDrop(state, player, targetEnemy, enemyDistance);
    if (rangedDrop) {
      const extra: ExtraBalloon = {
        ownerId: player.id,
        x: tile.x,
        y: tile.y,
        range: player.splashRange,
      };
      const withDrop = buildDangerMap(state, extra);
      const escape = nearestSafeTile(state, player, withDrop);
      if (escape && escape.length > 0) {
        this.path = escape;
        this.evadeUntil = state.tick + 80;
        this.lastDropTick = state.tick;
        return { dir: "none", balloonPressed: true };
      }
    }

    let target: Vec | null = null;
    if (this.difficulty === "hard") {
      const kickDir = this.tryKickDirection(state, player, enemies);
      if (kickDir) {
        this.path = [];
        return { dir: kickDir, balloonPressed: false };
      }
    }

    const powerupTarget = nearestPowerupTarget(state, player, danger);
    if (powerupTarget) {
      target = powerupTarget;
    } else if (
      targetEnemy &&
      (this.difficulty === "hard" ||
        (this.difficulty === "medium" && enemyDistance <= 6) ||
        (this.difficulty === "easy" && enemyDistance <= 2 && this.rng.chance(0.18)))
    ) {
      const enemyTile = playerTile(targetEnemy);
      if (this.difficulty === "hard") {
        const vector = CARDINALS.find((entry) => entry.dir === targetEnemy.dir);
        target = vector
          ? { x: enemyTile.x + vector.dx, y: enemyTile.y + vector.dy }
          : enemyTile;
      } else {
        target = enemyTile;
      }
    } else {
      target = nearestCastleTarget(state, player, danger);
    }

    if (!target) {
      const center = { x: Math.floor(state.arena.w / 2), y: Math.floor(state.arena.h / 2) };
      target = tileWalkableForBot(state, player, center.x, center.y)
        ? center
        : this.randomStep(state, player);
    }

    if (target) {
      const nextPath = pathToTarget(state, player, target, danger);
      this.path = nextPath ?? [];
    }

    if (this.path.length === 0 && this.difficulty !== "easy") {
      const fallback =
        nearestCastleTarget(state, player, new Map()) ??
        this.randomStep(state, player);
      if (fallback) {
        this.path = pathToTarget(state, player, fallback, danger) ?? [];
      }
    }
    if (this.path.length === 0) {
      const random = this.randomStep(state, player);
      if (random) this.path = [random];
    }
    const dir = this.follow(player);
    return dir === "none" ? null : { dir, balloonPressed: false };
  }

  private shouldDrop(
    state: RoundState,
    player: PlayerState,
    enemy: PlayerState | null,
    enemyDistance: number,
  ): boolean {
    if (state.tick - this.lastDropTick < 8) return false;
    const tile = playerTile(player);
    if (state.balloons.some((balloon) => balloon.x === tile.x && balloon.y === tile.y)) {
      return false;
    }
    const active = state.balloons.filter((balloon) => balloon.ownerId === player.id).length;
    if (active >= player.balloonCount) return false;
    const blast = blastSet(state, tile, player.splashRange);
    let canHit = false;
    if (enemy) {
      const enemyTile = playerTile(enemy);
      canHit = blast.has(tileKey(enemyTile.x, enemyTile.y));
    }
    let canBreakCastle = false;
    for (const vector of CARDINALS) {
      for (let step = 1; step <= player.splashRange; step += 1) {
        const x = tile.x + vector.dx * step;
        const y = tile.y + vector.dy * step;
        if (x < 0 || y < 0 || x >= state.arena.w || y >= state.arena.h) break;
        if (state.arena.boulders[y]?.[x]) break;
        if (state.arena.castles[y]?.[x] === 1) {
          canBreakCastle = true;
          break;
        }
      }
    }
    let canChain = false;
    for (const balloon of state.balloons) {
      if (balloon.ownerId === player.id && balloon.x === tile.x && balloon.y === tile.y) continue;
      if (blast.has(tileKey(balloon.x, balloon.y))) {
        canChain = true;
        break;
      }
    }
    if (this.difficulty === "easy") {
      return (canHit && enemyDistance <= 2 && this.rng.chance(0.45)) || (canBreakCastle && this.rng.chance(0.45));
    }
    if (this.difficulty === "medium") {
      return (canHit && enemyDistance <= CONFIG.BOTS.medium.attackRange) ||
        (canBreakCastle && this.rng.chance(0.75)) ||
        canChain;
    }
    return canHit ||
      (enemyDistance <= 3 && this.rng.chance(0.4)) ||
      (canChain && this.rng.chance(0.6)) ||
      canBreakCastle;
  }

  private tryKickDirection(
    state: RoundState,
    player: PlayerState,
    enemies: PlayerState[],
  ): Dir | null {
    if (!state.enableKick || player.kickCharges <= 0) return null;
    const tile = playerTile(player);
    for (const vector of CARDINALS) {
      const balloon = state.balloons.find(
        (entry) =>
          entry.x === tile.x + vector.dx &&
          entry.y === tile.y + vector.dy &&
          entry.kickedDir === "none",
      );
      if (!balloon) continue;
      const enemyInLine = enemies.some((enemy) => {
        const et = playerTile(enemy);
        if (vector.dx !== 0) {
          return et.y === tile.y && Math.sign(et.x - tile.x) === vector.dx;
        }
        return et.x === tile.x && Math.sign(et.y - tile.y) === vector.dy;
      });
      if (enemyInLine && this.rng.chance(0.8)) return vector.dir;
    }
    return null;
  }

  private evade(
    state: RoundState,
    player: PlayerState,
    danger: Map<string, Danger>,
  ): void {
    const escape = nearestSafeTile(state, player, danger);
    if (escape && escape.length > 0) {
      this.path = escape;
      this.evadeUntil = state.tick + 40;
      return;
    }
    const random = this.randomStep(state, player);
    this.path = random ? [random] : [];
  }

  private follow(player: PlayerState): Dir {
    while (
      this.path[0] &&
      Math.floor(player.x) === this.path[0].x &&
      Math.floor(player.y) === this.path[0].y
    ) {
      this.path.shift();
    }
    const next = this.path[0];
    if (!next) return "none";
    return directionToNextTile(player, next);
  }

  private randomStep(state: RoundState, player: PlayerState): Vec | null {
    const tile = playerTile(player);
    const options = CARDINALS.map((vector) => ({
      x: tile.x + vector.dx,
      y: tile.y + vector.dy,
    })).filter((candidate) => tileWalkableForBot(state, player, candidate.x, candidate.y));
    if (options.length === 0) return null;
    return options[this.rng.int(0, options.length)] ?? null;
  }
}
