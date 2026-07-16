import {
  CONFIG,
  type BotDifficulty,
  type Dir,
  type GameState,
  type PlayerInput,
  type PlayerState,
  DIRS,
  DIR_DELTA,
} from '@splash/shared';
import {
  buildDangerMap,
  bfs,
  canEscapeAfterPlace,
  isTileDangerous,
  tileWalkable,
  type DangerMap,
} from './dangerMap.js';

export type BotController = {
  playerId: string;
  difficulty: BotDifficulty;
  lastDecisionTick: number;
  cachedDir: Dir;
  cachedBalloon: boolean;
};

export function createBot(playerId: string, difficulty: BotDifficulty): BotController {
  return {
    playerId,
    difficulty,
    lastDecisionTick: -999,
    cachedDir: 'none',
    cachedBalloon: false,
  };
}

function intervalTicks(diff: BotDifficulty): number {
  const ms = CONFIG.BOT_INTERVALS_MS[diff];
  return Math.max(1, Math.round((ms / 1000) * CONFIG.TICK_RATE));
}

function errorRate(diff: BotDifficulty): number {
  return CONFIG.BOT_ERROR_RATES[diff];
}

function rand(): number {
  return Math.random();
}

function nearestEnemy(state: GameState, me: PlayerState): PlayerState | null {
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.id === me.id || !p.alive || p.soaked || p.revenge) continue;
    const d = Math.abs(Math.floor(p.x) - Math.floor(me.x)) + Math.abs(Math.floor(p.y) - Math.floor(me.y));
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function decide(
  state: GameState,
  me: PlayerState,
  danger: DangerMap,
  difficulty: BotDifficulty,
): { dir: Dir; balloon: boolean } {
  const tx = Math.floor(me.x);
  const ty = Math.floor(me.y);
  const err = errorRate(difficulty);

  // 1) Flee if current tile dangerous
  const escapeNeed = 6;
  const hereDanger = isTileDangerous(danger, tx, ty, state.width, escapeNeed);
  if (hereDanger && rand() > err) {
    const safe = bfs(
      state,
      tx,
      ty,
      (x, y) => !isTileDangerous(danger, x, y, state.width, 10),
      30,
      danger,
      false,
    );
    if (safe && safe.firstDir !== 'none') {
      return { dir: safe.firstDir, balloon: false };
    }
    // Panic: random walkable dir
    for (const d of DIRS.sort(() => rand() - 0.5)) {
      const { dx, dy } = DIR_DELTA[d];
      if (tileWalkable(state, tx + dx, ty + dy)) return { dir: d, balloon: false };
    }
  }

  // 2) Attack logic
  const enemy = nearestEnemy(state, me);
  const enemyDist = enemy
    ? Math.abs(Math.floor(enemy.x) - tx) + Math.abs(Math.floor(enemy.y) - ty)
    : 999;

  const shouldAttack =
    difficulty === 'hard' ||
    (difficulty === 'medium' && enemyDist <= 4) ||
    (difficulty === 'easy' && enemyDist <= 2 && rand() < 0.3);

  // Power phase: early farm, late aggression for hard
  const lateGame = state.tick > CONFIG.TICK_RATE * 60;

  // Try place balloon if safe escape
  let wantBalloon = false;
  if (me.balloonsOut < me.balloonCount && me.alive && !me.soaked) {
    if (shouldAttack && enemyDist <= me.splashRange + 1) {
      if (canEscapeAfterPlace(state, tx, ty, me.splashRange, danger) || (difficulty === 'easy' && rand() < 0.2)) {
        wantBalloon = true;
      }
    } else if (difficulty !== 'easy' || rand() < 0.4) {
      // Farm: place near castles
      let nearCastle = false;
      for (const d of DIRS) {
        const { dx, dy } = DIR_DELTA[d];
        for (let r = 1; r <= me.splashRange; r++) {
          const nx = tx + dx * r;
          const ny = ty + dy * r;
          if (!tileWalkable(state, nx, ny, true)) {
            const t = state.grid[ny * state.width + nx];
            if (t === 2) nearCastle = true; // TILE_CASTLE
            break;
          }
        }
      }
      if (nearCastle && canEscapeAfterPlace(state, tx, ty, me.splashRange, danger)) {
        wantBalloon = difficulty === 'hard' ? true : rand() < 0.5;
      }
    }
  }

  // Movement goal
  let goal: ((x: number, y: number) => boolean) | null = null;

  // Collect powerups
  if (state.powerups.length > 0 && (difficulty !== 'easy' || rand() < 0.5)) {
    const pu = state.powerups[0]!;
    goal = (x, y) => x === pu.x && y === pu.y;
  }

  // Hunt enemy
  if ((!goal || (difficulty === 'hard' && lateGame)) && enemy && shouldAttack) {
    const ex = Math.floor(enemy.x);
    const ey = Math.floor(enemy.y);
    goal = (x, y) => Math.abs(x - ex) + Math.abs(y - ey) <= 1;
  }

  // Farm castles — walk adjacent to castles
  if (!goal) {
    goal = (x, y) => {
      for (const d of DIRS) {
        const { dx, dy } = DIR_DELTA[d];
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < state.width && ny < state.height) {
          if (state.grid[ny * state.width + nx] === 2) return true;
        }
      }
      return false;
    };
  }

  const path = bfs(state, tx, ty, goal, 40, danger, true);
  let dir: Dir = path?.firstDir ?? 'none';

  // Easy wanders
  if (difficulty === 'easy' && (dir === 'none' || rand() < 0.25)) {
    const opts = DIRS.filter((d) => {
      const { dx, dy } = DIR_DELTA[d];
      return tileWalkable(state, tx + dx, ty + dy);
    });
    if (opts.length) dir = opts[Math.floor(rand() * opts.length)]!;
  }

  // Hard: use boots kick toward enemy if available
  // (kick happens by walking into balloon — movement handles it)

  // Misjudge danger on easy
  if (difficulty === 'easy' && wantBalloon && rand() < err) {
    // place anyway (already might)
  }

  return { dir, balloon: wantBalloon };
}

export function botThink(bot: BotController, state: GameState, seq: number): PlayerInput {
  const me = state.players.find((p) => p.id === bot.playerId);
  if (!me || me.soaked || !me.alive) {
    return { seq, tick: state.tick, dir: 'none', balloonPressed: false };
  }

  const interval = intervalTicks(bot.difficulty);
  if (state.tick - bot.lastDecisionTick >= interval) {
    bot.lastDecisionTick = state.tick;
    const danger = buildDangerMap(state);
    const d = decide(state, me, danger, bot.difficulty);
    bot.cachedDir = d.dir;
    bot.cachedBalloon = d.balloon;
  }

  const balloon = bot.cachedBalloon;
  bot.cachedBalloon = false; // one-shot

  return {
    seq,
    tick: state.tick,
    dir: bot.cachedDir,
    balloonPressed: balloon,
  };
}
