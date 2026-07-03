import type { Difficulty, InputState, Player, RoundState, Vec2 } from "@splash/shared";
import { CONFIG, hashString, mulberry32 } from "@splash/shared";
import {
  buildDangerMap,
  directionTo,
  directionToTile,
  isSafe,
  nearestSafeTile,
  reachableSafeNeighbors,
} from "./dangerMap.js";
import { isBoulder } from "@splash/shared";

export type BotController = {
  playerId: string;
  difficulty: Difficulty;
  nextDecisionTick: number;
  currentDir: Vec2;
  currentBalloon: boolean;
};

export function createBot(playerId: string, difficulty: Difficulty): BotController {
  return {
    playerId,
    difficulty,
    nextDecisionTick: 0,
    currentDir: { x: 0, y: 0 },
    currentBalloon: false,
  };
}

export function getBotInput(state: RoundState, bot: BotController, tick: number): InputState {
  const player = state.players.find((p) => p.id === bot.playerId);
  if (!player || !player.alive) {
    return { seq: tick, tick, dir: { x: 0, y: 0 }, balloonPressed: false, kickPressed: false };
  }

  const intervalTicks = Math.ceil(
    (difficultyMs(bot.difficulty) / 1000) * CONFIG.TICK_RATE
  );
  const reactionTicks =
    bot.difficulty === "easy"
      ? CONFIG.BOT_REACTION_EASY_TICKS
      : bot.difficulty === "medium"
      ? CONFIG.BOT_REACTION_MEDIUM_TICKS
      : CONFIG.BOT_REACTION_HARD_TICKS;

  if (tick >= bot.nextDecisionTick) {
    bot.nextDecisionTick = tick + intervalTicks;
    const rng = mulberry32(hashString(bot.playerId) + tick);
    const decision = decide(state, player, bot, reactionTicks, rng);
    bot.currentDir = decision.dir;
    bot.currentBalloon = decision.balloon;
  }

  return {
    seq: tick,
    tick,
    dir: bot.currentDir,
    balloonPressed: bot.currentBalloon,
    kickPressed: false,
  };
}

function difficultyMs(d: Difficulty): number {
  if (d === "easy") return CONFIG.BOT_DECISION_EASY_MS;
  if (d === "medium") return CONFIG.BOT_DECISION_MEDIUM_MS;
  return CONFIG.BOT_DECISION_HARD_MS;
}

type Decision = { dir: Vec2; balloon: boolean };

function decide(state: RoundState, player: Player, bot: BotController, reactionTicks: number, rng: () => number): Decision {
  const danger = buildDangerMap(state);
  const { tx, ty } = { tx: Math.floor(player.pos.x), ty: Math.floor(player.pos.y) };

  // 1. Flee if in danger
  if (!isSafe(state, danger, tx, ty, reactionTicks)) {
    const safe = nearestSafeTile(state, danger, tx, ty, reactionTicks);
    if (safe) {
      return { dir: directionTo(player.pos, safe), balloon: false };
    }
    // Panic: move to any reachable neighbor
    const neighbors = reachableSafeNeighbors(state, danger, tx, ty, reactionTicks);
    if (neighbors.length > 0) {
      return { dir: directionTo(player.pos, neighbors[0]), balloon: false };
    }
    return { dir: { x: 0, y: 0 }, balloon: false };
  }

  // 2. Easy bots sometimes misjudge danger
  const errorRoll = rng();
  const errorChance =
    bot.difficulty === "easy"
      ? CONFIG.BOT_ERROR_EASY
      : bot.difficulty === "medium"
      ? CONFIG.BOT_ERROR_MEDIUM
      : CONFIG.BOT_ERROR_HARD;
  if (bot.difficulty === "easy" && errorRoll < errorChance) {
    return { dir: randomDir(rng), balloon: false };
  }

  // 3. Attack: try to place balloon if an enemy is in range and we can escape
  const enemy = nearestEnemy(state, player);
  const attackRange = bot.difficulty === "hard" ? 6 : bot.difficulty === "medium" ? 4 : 3;
  if (enemy && manhattan(tx, ty, Math.floor(enemy.pos.x), Math.floor(enemy.pos.y)) <= attackRange) {
    if (canPlaceSafeBalloon(state, player, danger, reactionTicks)) {
      return { dir: { x: 0, y: 0 }, balloon: true };
    }
  }

  // 4. Collect powerups
  const pu = nearest(state.powerUps, player.pos);
  if (pu) {
    const path = safeStepToward(state, danger, player, pu.tx, pu.ty, reactionTicks);
    if (path) return { dir: path, balloon: false };
  }

  // 5. Farm castles (prefer nearest)
  let target: { tx: number; ty: number } | null = null;
  let bestDist = Infinity;
  for (let x = 0; x < state.width; x++) {
    for (let y = 0; y < state.height; y++) {
      if (state.castles[x][y]?.hasCastle) {
        const d = manhattan(tx, ty, x, y);
        if (d < bestDist) {
          bestDist = d;
          target = { tx: x, ty: y };
        }
      }
    }
  }
  if (target) {
    const step = safeStepToward(state, danger, player, target.tx, target.ty, reactionTicks);
    if (step) return { dir: step, balloon: false };
  }

  // 6. Wander
  return { dir: randomDir(rng), balloon: false };
}

function canPlaceSafeBalloon(state: RoundState, player: Player, danger: any, reactionTicks: number): boolean {
  if (player.activeBalloons >= player.stats.balloonCount) return false;
  const tx = Math.floor(player.pos.x);
  const ty = Math.floor(player.pos.y);
  if (isBoulder(state.width, state.height, tx, ty)) return false;
  if (state.castles[tx]?.[ty]?.hasCastle) return false;
  if (state.balloons.some((b) => Math.floor(b.tx) === tx && Math.floor(b.ty) === ty)) return false;

  // Simulate blast tiles
  const blastTiles = new Set<string>();
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (const d of dirs) {
    for (let step = 1; step <= player.stats.splashRange; step++) {
      const nx = tx + d.x * step;
      const ny = ty + d.y * step;
      if (isBoulder(state.width, state.height, nx, ny)) break;
      blastTiles.add(`${nx},${ny}`);
      if (state.castles[nx]?.[ny]?.hasCastle) break;
    }
  }

  // We need a safe tile reachable after placing (not in blast)
  const neighbors = reachableSafeNeighbors(state, danger, tx, ty, reactionTicks).filter(
    (n) => !blastTiles.has(`${n.tx},${n.ty}`)
  );
  return neighbors.length > 0;
}

function nearestEnemy(state: RoundState, player: Player): Player | null {
  let best: Player | null = null;
  let bestDist = Infinity;
  for (const p of state.players) {
    if (p.id === player.id || !p.alive || p.revengeDuck) continue;
    const d = Math.hypot(p.pos.x - player.pos.x, p.pos.y - player.pos.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function nearest(items: { tx: number; ty: number }[], pos: Vec2): { tx: number; ty: number } | null {
  let best: { tx: number; ty: number } | null = null;
  let bestDist = Infinity;
  for (const it of items) {
    const d = Math.hypot(it.tx + 0.5 - pos.x, it.ty + 0.5 - pos.y);
    if (d < bestDist) {
      bestDist = d;
      best = it;
    }
  }
  return best;
}

function safeStepToward(
  state: RoundState,
  danger: any,
  player: Player,
  tx: number,
  ty: number,
  reactionTicks: number
): Vec2 | null {
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (const d of dirs) {
    const nx = Math.floor(player.pos.x) + d.x;
    const ny = Math.floor(player.pos.y) + d.y;
    if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
    if (isBoulder(state.width, state.height, nx, ny)) continue;
    if (state.castles[nx]?.[ny]?.hasCastle) continue;
    if (!isSafe(state, danger, nx, ny, reactionTicks)) continue;
    const dist = manhattan(nx, ny, tx, ty);
    if (dist < bestScore) {
      bestScore = dist;
      best = d;
    }
  }
  if (!best) return null;
  return directionToTile(player.pos, Math.floor(player.pos.x) + best.x, Math.floor(player.pos.y) + best.y);
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function randomDir(rng: () => number): Vec2 {
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 0, y: 0 },
  ];
  return dirs[Math.floor(rng() * dirs.length)];
}
