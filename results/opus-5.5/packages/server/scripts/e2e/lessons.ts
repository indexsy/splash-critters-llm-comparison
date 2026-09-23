// LessonCoach: a new player following the tutorial's on-screen instructions. Lessons 1-3 (walk,
// splash a castle and dodge, grab a power-up) are ordinary play, done by the Hard bot brain.
// Lesson 4 follows its text literally: drop a balloon, take one step along a line, drop the
// second one, run out of both crosses. Lesson 5 plays like a beginner: walk up to the bot, drop
// when it is in the balloon's line, step out of the cross and wait.
import {
  ALL_DIRS,
  DIR_DX,
  DIR_DY,
  Dir,
  computeArms,
  idx,
  isSolidFor,
  splashTiles,
  tileOf,
  type DirCode,
  type PlayerInput,
  type RoundState,
  type S2C,
} from '@splash/shared';
import type { BotBrain } from '../../src/match/types';

/** Farthest escape (tiles) the chain plan accepts: well inside the 3 s fuse. */
const MAX_ESCAPE_STEPS = 5;
/** Ticks the step to the second tile may take before the chain attempt is abandoned. */
const STEP_TIMEOUT_TICKS = 30;

interface ChainPlan {
  first: number;
  second: number;
  dir: DirCode;
  pressedAt: number;
}

function hereOf(s: RoundState, slot: number): number {
  const p = s.players[slot];
  return idx(s.w, tileOf(p.x), tileOf(p.y));
}

function crossOf(s: RoundState, tile: number, range: number): number[] {
  const x = tile % s.w;
  const y = (tile - x) / s.w;
  return splashTiles(x, y, computeArms(s, x, y, range)).map((t) => idx(s.w, t.x, t.y));
}

/** Tiles to stay out of: every live balloon's cross, plus water that is still there next tick. */
function dangerTiles(s: RoundState): Set<number> {
  const danger = new Set<number>();
  for (const b of s.balloons) for (const t of crossOf(s, idx(s.w, b.tx, b.ty), b.range)) danger.add(t);
  for (let i = 0; i < s.splashUntil.length; i++) if (s.splashUntil[i] > s.tick + 1) danger.add(i);
  return danger;
}

/**
 * Breadth-first walk from `start` over tiles `slot` may enter (and not in `avoid`, the start
 * excepted) to the nearest `goal` tile: its first step and distance, or null when unreachable.
 */
function route(
  s: RoundState,
  slot: number,
  start: number,
  goal: (tile: number) => boolean,
  avoid: ReadonlySet<number>,
  solid: ReadonlySet<number> = new Set(),
): { dir: DirCode; steps: number } | null {
  if (goal(start)) return { dir: Dir.None, steps: 0 };
  const first = new Map<number, { dir: DirCode; steps: number }>([[start, { dir: Dir.None, steps: 0 }]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const tile = queue[head];
    const x = tile % s.w;
    const y = (tile - x) / s.w;
    const from = first.get(tile)!;
    for (const dir of ALL_DIRS) {
      const nx = x + DIR_DX[dir];
      const ny = y + DIR_DY[dir];
      const next = idx(s.w, nx, ny);
      if (first.has(next) || avoid.has(next) || solid.has(next) || isSolidFor(s, slot, nx, ny)) continue;
      const reached = { dir: tile === start ? dir : from.dir, steps: from.steps + 1 };
      if (goal(next)) return reached;
      first.set(next, reached);
      queue.push(next);
    }
  }
  return null;
}

export class LessonCoach implements BotBrain {
  readonly difficulty = 'hard' as const;
  private lesson = 1;
  private chain: ChainPlan | null = null;

  constructor(
    readonly slot: number,
    private readonly brain: BotBrain,
  ) {}

  /** Lesson progress comes from the server's tutorial_step messages. */
  observe(m: S2C): void {
    if (m.type === 'tutorial_step' && !m.done) this.lesson = m.step;
  }

  reset(): void {
    this.brain.reset();
    this.chain = null;
  }

  /** The brain decides every tick (its plan stays current); lessons 4 and 5 override it. */
  nextInput(s: RoundState): PlayerInput {
    const decided = this.brain.nextInput(s);
    const me = s.players[this.slot];
    if (!me?.alive || this.lesson < 4) return decided;
    const dir = this.lesson === 4 ? this.chainLesson(s, decided.dir) : this.soakLesson(s);
    return { seq: decided.seq, dir: dir === 'drop' ? Dir.None : dir, balloon: dir === 'drop' };
  }

  private ownBalloons(s: RoundState): number[] {
    return s.balloons.filter((b) => b.owner === this.slot && !b.fromDuck).map((b) => idx(s.w, b.tx, b.ty));
  }

  /** Nearest tile outside `danger` (and not a balloon's), walking only through what `slot` may enter. */
  private flee(s: RoundState, danger: ReadonlySet<number>): DirCode {
    return route(s, this.slot, hereOf(s, this.slot), (t) => !danger.has(t), new Set())?.dir ?? Dir.None;
  }

  /** Until the second balloon is in hand (`maxBalloons` 2) the brain's move stands. */
  private chainLesson(s: RoundState, brainDir: DirCode): DirCode | 'drop' {
    const here = hereOf(s, this.slot);
    const mine = this.ownBalloons(s);
    const plan = this.chain;
    if (plan && mine.length === 1 && mine[0] === plan.first && s.tick - plan.pressedAt <= STEP_TIMEOUT_TICKS) {
      return here === plan.second ? 'drop' : plan.dir;
    }
    if (mine.length > 0 || dangerTiles(s).has(here)) {
      this.chain = null;
      return this.flee(s, dangerTiles(s));
    }
    if (s.players[this.slot].maxBalloons < 2) return brainDir;
    const found = this.chainFrom(s, here);
    if (found) {
      this.chain = { ...found, pressedAt: s.tick };
      return 'drop';
    }
    const danger = dangerTiles(s);
    return route(s, this.slot, here, (t) => t !== here && this.chainFrom(s, t) !== null, danger)?.dir ?? Dir.None;
  }

  /** A line of two free tiles starting at `first`, with a short escape out of both crosses. */
  private chainFrom(s: RoundState, first: number): Omit<ChainPlan, 'pressedAt'> | null {
    const me = s.players[this.slot];
    const x = first % s.w;
    const y = (first - x) / s.w;
    for (const dir of ALL_DIRS) {
      const sx = x + DIR_DX[dir];
      const sy = y + DIR_DY[dir];
      if (isSolidFor(s, this.slot, sx, sy) || s.splashUntil[idx(s.w, sx, sy)] > s.tick) continue;
      const second = idx(s.w, sx, sy);
      const danger = new Set([...dangerTiles(s), ...crossOf(s, first, me.range), ...crossOf(s, second, me.range)]);
      const escape = route(s, this.slot, second, (t) => !danger.has(t), new Set(), new Set([first]));
      if (escape && escape.steps <= MAX_ESCAPE_STEPS) return { first, second, dir };
    }
    return null;
  }

  private soakLesson(s: RoundState): DirCode | 'drop' {
    const here = hereOf(s, this.slot);
    const danger = dangerTiles(s);
    if (this.ownBalloons(s).length > 0 || danger.has(here)) return this.flee(s, danger);
    const bot = s.players.find((p) => p.present && p.slot !== this.slot);
    if (!bot?.alive) return Dir.None;
    const target = hereOf(s, bot.slot);
    const cross = crossOf(s, here, s.players[this.slot].range);
    const gap = Math.abs(tileOf(bot.x) - (here % s.w)) + Math.abs(tileOf(bot.y) - Math.floor(here / s.w));
    if (gap <= 2 && cross.includes(target)) {
      const blast = new Set([...danger, ...cross]);
      const escape = route(s, this.slot, here, (t) => !blast.has(t), new Set());
      if (escape && escape.steps <= MAX_ESCAPE_STEPS) return 'drop';
    }
    return route(s, this.slot, here, (t) => t === target, danger)?.dir ?? Dir.None;
  }
}
