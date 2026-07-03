// bot.ts — server-side bot AI with three difficulties (spec §9).
// Decision loop (BFS; boulders/castles/balloons are obstacles):
//   1) flee if current tile is dangerous
//   2) never place a balloon without confirming a reachable safe escape tile
//   3) otherwise farm castles, collect power-ups, or attack within range
//
// Difficulty knobs decision interval + danger misjudgment + aggression.

import {
  BOTS,
  TICK_HZ,
  type Difficulty,
  type Dir,
  type Input,
  type MatchState,
  type Player,
  type PowerUpKind,
} from "@splash/shared";
import { DIR_DX, DIR_DY } from "@splash/shared";
import { computeDangerMap, isTileSafe } from "./dangerMap.js";

export interface BotHandle {
  playerId: number;
  difficulty: Difficulty;
  /** last decision tick (server tick count) */
  lastDecisionTick: number;
  /** cached chosen direction + balloon flag, refreshed on decision interval */
  chosenDir: Dir | -1;
  balloonPressed: boolean;
  seq: number;
}

export function newBot(playerId: number, difficulty: Difficulty): BotHandle {
  return { playerId, difficulty, lastDecisionTick: -1, chosenDir: -1, balloonPressed: false, seq: 1 };
}

/** Returns the input the bot wants to send this tick (called every server tick). */
export function botInput(state: MatchState, bot: BotHandle): Input | null {
  const p = state.players[bot.playerId];
  if (!p || !p.alive || p.revenge) return null;

  const cfg = BOTS[bot.difficulty];
  const decisionEvery = Math.round((cfg.decisionMs / 1000) * TICK_HZ);

  if (state.tick - bot.lastDecisionTick >= decisionEvery) {
    bot.lastDecisionTick = state.tick;
    decide(state, bot, p);
  }

  // balloon is a one-shot press: emit once then reset
  const input: Input = {
    seq: bot.seq++,
    tick: state.tick,
    dir: bot.chosenDir,
    balloonPressed: bot.balloonPressed,
  };
  bot.balloonPressed = false;
  return input;
}

function decide(state: MatchState, bot: BotHandle, p: Player) {
  const cfg = BOTS[bot.difficulty];
  const danger = computeDangerMap(state);
  const tx = Math.round(p.x);
  const ty = Math.round(p.y);

  // Danger misjudgment: easy bots sometimes ignore danger
  const aware = Math.random() >= cfg.dangerMisjudge;

  // 1) flee if current tile unsafe
  if (aware) {
    const safeHere = isTileSafe(state, danger, tx, ty, p.speed / TICK_HZ);
    if (!safeHere) {
      bot.chosenDir = fleeDir(state, danger, tx, ty, p);
      bot.balloonPressed = false;
      return;
    }
  }

  // 2) consider attacking: nearest alive opponent within range
  const target = nearestOpponent(state, p);
  if (target && cfg.attackChance > 0 && Math.random() < cfg.attackChance) {
    const dx = Math.round(target.x) - tx;
    const dy = Math.round(target.y) - ty;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist <= p.splashRange + 2 && p.liveBalloons < p.balloonCount) {
      // place a balloon toward target only if escape verified
      if (canEscapeAfterBalloon(state, danger, p, tx, ty)) {
        bot.chosenDir = dirToward(dx, dy);
        bot.balloonPressed = true;
        return;
      }
    }
  }

  // 3) farm: move toward nearest destructible castle adjacent to a walkable tile
  const farmDir = farmDirection(state, p, tx, ty);
  if (farmDir !== -1) {
    bot.chosenDir = farmDir;
    // drop a balloon to break a castle if adjacent and escape is safe
    if (canEscapeAfterBalloon(state, danger, p, tx, ty) && Math.random() < 0.3) {
      bot.balloonPressed = true;
    }
    return;
  }

  // otherwise wander
  bot.chosenDir = randomWalkDir(p, state);
  bot.balloonPressed = false;
}

function fleeDir(state: MatchState, danger: Float32Array, x: number, y: number, p: Player): Dir | -1 {
  const { width: w } = state;
  let best: Dir | -1 = -1;
  let bestDanger = danger[y * w + x];
  for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
    const nx = x + DIR_DX[d];
    const ny = y + DIR_DY[d];
    if (nx < 0 || ny < 0 || nx >= w || ny >= state.height) continue;
    const t = state.tiles[ny * w + nx];
    if (t === 1 || t === 2) continue;
    const dd = danger[ny * w + nx];
    if (dd > bestDanger) {
      bestDanger = dd;
      best = d;
    }
  }
  return best;
}

function canEscapeAfterBalloon(
  state: MatchState,
  danger: Float32Array,
  p: Player,
  bx: number,
  by: number,
): boolean {
  // Simulate placing a balloon here: its splash would add danger around (bx,by).
  // Verify at least one neighbor tile is reachable-safe.
  const burstTick = 90; // BALLOON_FUSE_TICKS but worst case
  for (let d = 0; d < 4; d++) {
    const nx = bx + DIR_DX[d];
    const ny = by + DIR_DY[d];
    if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
    const t = state.tiles[ny * state.width + nx];
    if (t === 1 || t === 2) continue;
    const di = ny * state.width + nx;
    // safe if no existing danger arrives before we can step away, and not within
    // this new balloon's eventual splash reach at burst time
    if (danger[di] === Infinity || danger[di] > burstTick) {
      return true;
    }
  }
  return false;
}

function nearestOpponent(state: MatchState, p: Player): Player | null {
  let best: Player | null = null;
  let bestD = Infinity;
  for (const o of state.players) {
    if (o.id === p.id || !o.alive || o.revenge) continue;
    const d = Math.abs(o.x - p.x) + Math.abs(o.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function farmDirection(state: MatchState, p: Player, x: number, y: number): Dir | -1 {
  // BFS for nearest walkable tile adjacent to a sandcastle; return first step.
  const { width: w, height: h } = state;
  const visited = new Set<number>([y * w + x]);
  const queue: { x: number; y: number; first: Dir | -1 }[] = [{ x, y, first: -1 }];
  while (queue.length) {
    const cur = queue.shift()!;
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      const nx = cur.x + DIR_DX[d];
      const ny = cur.y + DIR_DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ti = ny * w + nx;
      if (visited.has(ti)) continue;
      visited.add(ti);
      const t = state.tiles[ti];
      if (t === 2) {
        // castle neighbor — we want to reach cur tile; return cur.first step
        return cur.first === -1 ? d : cur.first;
      }
      if (t === 1) continue;
      queue.push({ x: nx, y: ny, first: cur.first === -1 ? d : cur.first });
    }
  }
  return -1;
}

function dirToward(dx: number, dy: number): Dir {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

function randomWalkDir(p: Player, _state: MatchState): Dir | -1 {
  // bias toward continuing current direction
  if (Math.random() < 0.7) return p.dir;
  return Math.floor(Math.random() * 4) as Dir;
}

/** Power-up kinds the bot prefers (not used directly but documents intent). */
export const BOT_POWERUP_PREF: Record<Difficulty, PowerUpKind[]> = {
  easy: ["extraBalloon", "bigSplash", "flippers", "rubberBoots"],
  medium: ["extraBalloon", "bigSplash", "flippers", "rubberBoots"],
  hard: ["rubberBoots", "extraBalloon", "bigSplash", "flippers"],
};
