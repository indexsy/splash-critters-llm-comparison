// Per-tick view of the world a bot decides from: its own player, the exact and the perceived
// danger maps, the obstacle grid and its opponents. Built once per tick, shared by all tactics.
import {
  CONFIG,
  Tile,
  balloonAt,
  borderLoopLength,
  isFlooded,
  speedUnitsPerTick,
  tileCenter,
  tileOf,
  type BotTuning,
  type Difficulty,
  type PlayerState,
  type RoundState,
} from '@splash/shared';
import type { DangerMap } from './dangerMap';
import { lobLanding, loopTiles } from './duck';
import { buildBlocked, moverOf, neighbours, playerTileIndex, stepTicks } from './motion';
import type { Mover } from './pathing';

/** A dry window that lasts this long covers every pending fuse plus its splash: safe to camp. */
export const CAMP_HORIZON = CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS + 20;
/** Path searches never look further ahead than this. */
export const SEARCH_HORIZON = CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS + 60;
/** Ticks of slack kept between the bot and water in normal planning. */
export const SAFETY_MARGIN = 1;
/**
 * A balloon blocks the bot only if dropped at least this many ticks before the bot crosses into
 * its tile: from then on the bot's box overlaps the tile, and a balloon dropped under an
 * overlapping player lets that player through.
 */
export const BLOCK_LEAD_TICKS = 2;

export interface BotContext {
  readonly s: RoundState;
  readonly me: PlayerState;
  readonly slot: number;
  readonly tick: number;
  /** Tile index of the bot's center. */
  readonly here: number;
  readonly mover: Mover;
  readonly tuning: BotTuning;
  readonly difficulty: Difficulty;
  readonly passive: boolean;
  readonly rng: () => number;
  /** The true danger picture (own balloons are always judged with it). */
  readonly exact: DangerMap;
  /** What this bot believes for this decision (Easy sometimes misjudges others' timing). */
  readonly view: DangerMap;
  /** Tiles that cannot be entered right now. */
  readonly blocked: Uint8Array;
  readonly opponents: PlayerState[];
  /** Lazily computed: earliest tick any opponent could stand on each tile (danger ignored). */
  oppTicks?: Float64Array;
  /** Lazily computed: earliest tick an opponent's revenge duck could lob a balloon onto each landing tile. */
  duckLobs?: Map<number, number>;
  /** Lazily computed: the latest tick the bot may cross into each tile before an opponent could block it. */
  enterBy?: Float64Array;
  /** Lazily computed: pressure each opponent is under from the current danger, by slot. */
  basePressure?: Map<number, number>;
  /** Lazily computed (tide end game): how long each player can stay dry as things stand, by slot. */
  survival?: Map<number, number>;
  /** Lazily computed: the splash cross of a balloon of the bot's range on each tile. */
  crosses?: Map<number, readonly number[]>;
}

export interface ContextInput {
  s: RoundState;
  slot: number;
  tuning: BotTuning;
  difficulty: Difficulty;
  passive: boolean;
  rng: () => number;
  exact: DangerMap;
  view: DangerMap;
}

/**
 * Until when a tile must stay dry (from tick `from`) to count as campable. Normally CAMP_HORIZON
 * ahead; in the tide's end game nothing outlives the last flood, so staying dry past the
 * second-to-last flood (being inside the innermost ring by then) is as safe as it gets (asking for
 * more, bots would stop playing entirely; asking for less, they would idle in the second ring
 * until it floods under them).
 */
export function campUntil(ctx: BotContext, from: number): number {
  const tideCap = ctx.exact.lastFloodTick - CONFIG.TIDE_INTERVAL_TICKS + 1;
  return Math.max(from + CONFIG.SPLASH_TICKS, Math.min(from + CAMP_HORIZON, tideCap));
}

export function makeContext(input: ContextInput): BotContext {
  const { s, slot, exact } = input;
  const me = s.players[slot];
  return {
    ...input,
    me,
    tick: s.tick,
    here: playerTileIndex(s, me),
    mover: moverOf(me),
    blocked: buildBlocked(s, exact.balloonTiles()),
    opponents: s.players.filter((p) => p.present && p.alive && p.slot !== slot),
  };
}

/** Revenge ducks paddle this many sub-units per tick along the border. */
const DUCK_UNITS_PER_TICK = Math.round((CONFIG.DUCK_SPEED * CONFIG.SUB) / CONFIG.TICK_RATE);

/**
 * The earliest tick an opponent could put a balloon on each tile: alive opponents walking there
 * (danger ignored; the first step from where each one stands right now, which may be most of the
 * way into a neighbour tile already) and revenge ducks paddling to a border tile and lobbing.
 */
export function opponentTicks(ctx: BotContext): Float64Array {
  if (ctx.oppTicks) return ctx.oppTicks;
  const out = new Float64Array(ctx.s.w * ctx.s.h).fill(Infinity);
  addDuckLobs(ctx, out);
  for (const o of ctx.opponents) addWalk(ctx, o, out);
  ctx.oppTicks = out;
  return out;
}

/** Lowers `out` to the earliest tick `o` could stand on each tile, walking from where it is. */
function addWalk(ctx: BotContext, o: PlayerState, out: Float64Array): void {
  const { s, blocked } = ctx;
  const speed = speedUnitsPerTick(o.speedUps);
  const step = stepTicks(speed);
  const start = tileOf(o.y) * s.w + tileOf(o.x);
  const at = new Float64Array(s.w * s.h).fill(Infinity);
  at[start] = ctx.tick;
  const queue: number[] = [];
  const offX = o.x - tileCenter(tileOf(o.x));
  const offY = o.y - tileCenter(tileOf(o.y));
  const half = CONFIG.SUB / 2;
  // [up, down, left, right]: perpendicular re-centering first, then the rest of the way out.
  const legs = [Math.abs(offX) + half + offY, Math.abs(offX) + half - offY, Math.abs(offY) + half + offX, Math.abs(offY) + half - offX];
  const firsts = [start - s.w, start + s.w, start - 1, start + 1];
  for (let a = 0; a < 4; a++) {
    const n = firsts[a];
    if (blocked[n] === 1) continue;
    at[n] = ctx.tick + Math.ceil(legs[a] / speed);
    queue.push(n);
  }
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    for (const n of neighbours(s.w, s.h, t)) {
      if (blocked[n] === 1 || at[t] + step >= at[n]) continue;
      at[n] = at[t] + step;
      queue.push(n);
    }
  }
  for (let t = 0; t < at.length; t++) if (at[t] < out[t]) out[t] = at[t];
}

/**
 * The latest tick the bot may cross into each tile before an opponent could have dropped a
 * balloon there in its way (see BLOCK_LEAD_TICKS and opponentTicks).
 */
export function unblockedUntil(ctx: BotContext): Float64Array {
  if (ctx.enterBy) return ctx.enterBy;
  const opp = opponentTicks(ctx);
  const out = new Float64Array(opp.length);
  for (let t = 0; t < opp.length; t++) out[t] = opp[t] + BLOCK_LEAD_TICKS - 1;
  ctx.enterBy = out;
  return out;
}

function addDuckLobs(ctx: BotContext, out: Float64Array): void {
  for (const [landing, at] of duckLobTicks(ctx)) if (at < out[landing]) out[landing] = at;
}

/**
 * The earliest tick an opponent's revenge duck could lob a balloon onto each landing tile: it
 * paddles there along the border and waits out its lob cooldown. Empty without revenge ducks.
 */
export function duckLobTicks(ctx: BotContext): Map<number, number> {
  if (ctx.duckLobs) return ctx.duckLobs;
  const { s } = ctx;
  const out = new Map<number, number>();
  ctx.duckLobs = out;
  if (!s.rules.revengeDucks) return out;
  const length = borderLoopLength(s.w, s.h);
  const tiles = loopTiles(s);
  for (const p of s.players) {
    if (!p.present || p.alive || p.duckPos < 0 || p.slot === ctx.slot) continue;
    for (let k = 0; k < tiles; k++) {
      const landing = lobLanding(s, k);
      if (landing < 0) continue;
      const cw = (((k * CONFIG.SUB - p.duckPos) % length) + length) % length;
      const paddle = Math.ceil(Math.min(cw, length - cw) / DUCK_UNITS_PER_TICK);
      const at = ctx.tick + 1 + Math.max(paddle, p.duckCooldownUntil - ctx.tick - 1);
      if (at < (out.get(landing) ?? Infinity)) out.set(landing, at);
    }
  }
  return out;
}

/** Manhattan distance between two tile indices. */
export function tileDistance(w: number, a: number, b: number): number {
  const ax = a % w;
  const bx = b % w;
  return Math.abs(ax - bx) + Math.abs((a - ax) / w - (b - bx) / w);
}

/** A balloon could be placed here: floor, empty, not flooded and not under lingering water. */
export function canDropOn(ctx: BotContext, tile: number): boolean {
  const { s } = ctx;
  if (s.tiles[tile] !== Tile.Floor) return false;
  const tx = tile % s.w;
  const ty = (tile - tx) / s.w;
  if (balloonAt(s, tx, ty) !== undefined || isFlooded(s, tx, ty)) return false;
  return s.splashUntil[tile] <= ctx.tick + 1;
}
