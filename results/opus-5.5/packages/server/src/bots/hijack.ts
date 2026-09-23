// Chain hijacks: an opponent can make one of our balloons burst long before its fuse ends by
// dropping (or lobbing) a balloon where an earlier-bursting splash sets it off and whose own
// splash then reaches ours, directly or through other waiting balloons. Careful bots budget their
// escapes and routes against the earliest such tick. A revenge duck can also lob a balloon into
// one of our cascades at the last moment, widening its splash (see lobbedSplashes).
import { CONFIG, Tile } from '@splash/shared';
import { duckLobTicks, opponentTicks, type BotContext } from './context';
import type { DangerMap } from './dangerMap';
import { splashCross } from './motion';

/** Splash tiles from `tile` with arms stopping at castles and at any tile in `balloons` (both included). */
function crossWith(ctx: BotContext, tile: number, range: number, balloons: ReadonlySet<number>): number[] {
  const { s } = ctx;
  const out = [tile];
  const x0 = tile % s.w;
  const y0 = (tile - x0) / s.w;
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    for (let k = 1; k <= range; k++) {
      const x = x0 + dx * k;
      const y = y0 + dy * k;
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) break;
      const t = y * s.w + x;
      if (s.tiles[t] === Tile.Boulder) break;
      out.push(t);
      if (s.tiles[t] === Tile.Castle || balloons.has(t)) break;
    }
  }
  return out;
}

/**
 * The earliest tick an opponent could make a new balloon on `tile` burst. Balloons that would set
 * it off (directly or through other balloons) form its feeder set; an opponent who drops or lobs
 * a balloon inside the splash path of an earlier-bursting balloon, from where that balloon's own
 * splash reaches a feeder, pulls the whole chain forward. `own` is the current effective burst.
 */
export function hijackTick(ctx: BotContext, hypo: DangerMap, tile: number, own: number): number {
  const { s } = ctx;
  let reach = 0;
  for (const o of ctx.opponents) reach = Math.max(reach, o.range);
  if (s.rules.revengeDucks && s.players.some((p) => p.present && !p.alive && p.duckPos >= 0)) {
    reach = Math.max(reach, CONFIG.DUCK_BALLOON_RANGE);
  }
  if (reach === 0) return own;
  const balloonTiles = new Set(s.balloons.map((b) => b.ty * s.w + b.tx));
  balloonTiles.add(tile);
  const pending = s.balloons.map((b) => ({ tile: b.ty * s.w + b.tx, range: b.range, at: hypo.burstTickOf(b.id) }));
  const feeders = new Set([tile]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of pending) {
      if (feeders.has(p.tile) || !crossWith(ctx, p.tile, p.range, balloonTiles).some((t) => feeders.has(t))) continue;
      feeders.add(p.tile);
      grew = true;
    }
  }
  const opp = opponentTicks(ctx);
  let best = own;
  for (const e of pending) {
    if (e.at >= best || feeders.has(e.tile)) continue;
    for (const x of crossWith(ctx, e.tile, e.range, balloonTiles)) {
      if (balloonTiles.has(x) || s.tiles[x] !== Tile.Floor || opp[x] >= e.at - 1) continue;
      if (crossWith(ctx, x, reach, balloonTiles).some((t) => feeders.has(t))) {
        best = e.at;
        break;
      }
    }
  }
  return best;
}

/**
 * The splash of every balloon an opponent's revenge duck could still lob into one of the bot's
 * pending cascades in `danger`, as extra wet windows by tile (see withExtraWater): landing on a
 * tile that cascade will wet, it bursts along with it, however late it came, and wets the tiles
 * around its landing when the cascade does. Soaked there by a cascade its own balloon seeded, the
 * bot would have soaked itself, with no time left to react.
 */
export function lobbedSplashes(ctx: BotContext, danger: DangerMap): Map<number, number[]> {
  const extra = new Map<number, number[]>();
  const lobs = duckLobTicks(ctx);
  if (lobs.size === 0) return extra;
  const own = new Set(danger.tilesWetBy(ctx.slot));
  for (const [landing, at] of lobs) {
    if (!own.has(landing)) continue;
    const burst = danger.firstWetFrom(landing, at + 1);
    if (burst === Infinity) continue;
    for (const t of splashCross(ctx.s, landing, CONFIG.DUCK_BALLOON_RANGE)) {
      const windows = extra.get(t);
      if (windows) windows.push(burst, burst + CONFIG.SPLASH_TICKS);
      else extra.set(t, [burst, burst + CONFIG.SPLASH_TICKS]);
    }
  }
  return extra;
}
