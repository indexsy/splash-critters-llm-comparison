// Keyboard "pilot" for the acceptance scripts: reads where critters are drawn from the opt-in
// diagnostics trace (window.splashNetStats, enabled with ?netstats=1: the same thing a player
// sees on screen) and moves the local critter by holding real arrow keys for as long as it
// takes, like a player would. Nothing here writes game state: every action is a key press.
import { sleep } from './lib.mjs';

export const TILE = 16;
export const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const AXIS = { up: 'y', down: 'y', left: 'x', right: 'x' };
const SIGN = { up: -1, down: 1, left: -1, right: 1 };

export const tileOf = (px) => Math.floor(px / TILE);
export const centerOf = (t) => t * TILE + TILE / 2;

/** Newest traced frame, or null before the match view drew anything. */
export async function lastFrame(page) {
  return page.evaluate(() => {
    const frames = window.splashNetStats?.frames(performance.now() - 500) ?? [];
    return frames.length ? frames[frames.length - 1] : null;
  });
}

/** Where the local critter is drawn: arena pixels plus its tile. */
export async function myPos(page) {
  const f = await lastFrame(page);
  if (!f?.local) return null;
  return { x: f.local.x, y: f.local.y, tx: tileOf(f.local.x), ty: tileOf(f.local.y) };
}

/** Where remote critter `slot` is drawn (null when absent). */
export async function remotePos(page, slot) {
  const f = await lastFrame(page);
  const r = f?.remote.find((p) => p.slot === slot);
  return r ? { x: r.x, y: r.y, tx: tileOf(r.x), ty: tileOf(r.y) } : null;
}

/**
 * Hold the arrow key for `dir` until the critter reaches the center of tile `target` on that
 * axis, stops making progress (a wall) or `timeoutMs` passes. Returns the final position.
 */
export async function moveAxis(page, dir, target, timeoutMs = 4000) {
  const axis = AXIS[dir];
  const sign = SIGN[dir];
  const goal = centerOf(target);
  const start = await myPos(page);
  if (start && sign * (start[axis] - goal) >= -2) return start;
  await page.keyboard.down(KEYS[dir]);
  const deadline = Date.now() + timeoutMs;
  let last = start?.[axis] ?? null;
  let stuckSince = Date.now();
  try {
    while (Date.now() < deadline) {
      const p = await myPos(page);
      if (p) {
        if (sign * (p[axis] - goal) >= -2) break;
        if (p[axis] !== last) {
          last = p[axis];
          stuckSince = Date.now();
        } else if (Date.now() - stuckSince > 700) break;
      }
      await sleep(8);
    }
  } finally {
    await page.keyboard.up(KEYS[dir]);
  }
  await sleep(90);
  return myPos(page);
}

/** Walk a tile path (list of {x, y}, starting next to the critter) one axis move at a time. */
export async function walkPath(page, path) {
  let pos = await myPos(page);
  for (const step of path) {
    if (!pos) return null;
    const dir = step.x > pos.tx ? 'right' : step.x < pos.tx ? 'left' : step.y > pos.ty ? 'down' : step.y < pos.ty ? 'up' : null;
    if (!dir) continue;
    pos = await moveAxis(page, dir, AXIS[dir] === 'x' ? step.x : step.y, 1500);
    if (!pos || pos.tx !== step.x || pos.ty !== step.y) return pos;
  }
  return pos;
}

/** Drop a balloon: one real press of the balloon key. */
export async function dropBalloon(page) {
  await page.keyboard.down('Space');
  await sleep(70);
  await page.keyboard.up('Space');
}

/**
 * The arena as the player sees it: '#' boulder, 'C' castle, '.' floor. Updated by the pilot
 * itself when its own splashes wash castles (only the player's balloons change the map here).
 */
export class ArenaModel {
  constructor(rows) {
    this.grid = rows.map((r) => r.replace(/[0-9B]/g, (c) => (c === 'B' ? 'C' : '.')).split(''));
    this.h = this.grid.length;
    this.w = this.grid[0].length;
  }

  at(x, y) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? '#' : this.grid[y][x];
  }

  open(x, y) {
    return this.at(x, y) === '.';
  }

  /** Tiles a balloon at (x, y) with `range` splashes (castles included, they stop the arm). */
  splash(x, y, range) {
    const out = [{ x, y }];
    for (const [dx, dy] of Object.values(STEP)) {
      for (let i = 1; i <= range; i++) {
        const t = this.at(x + dx * i, y + dy * i);
        if (t === '#') break;
        out.push({ x: x + dx * i, y: y + dy * i });
        if (t === 'C') break;
      }
    }
    return out;
  }

  /** Apply a burst to the model: the first castle on each arm is washed away. */
  burst(x, y, range) {
    for (const t of this.splash(x, y, range)) if (this.at(t.x, t.y) === 'C') this.grid[t.y][t.x] = '.';
  }

  /**
   * Shortest walkable path from `from` to the first tile satisfying `goal`, avoiding `blocked`
   * (a Set of "x,y"). Returns the path without the start tile, [] when already there, or null.
   */
  path(from, goal, blocked = new Set()) {
    const key = (x, y) => `${x},${y}`;
    const prev = new Map([[key(from.x, from.y), null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      if (goal(cur.x, cur.y)) {
        const out = [];
        for (let k = key(cur.x, cur.y), c = cur; prev.get(k); c = prev.get(k), k = key(c.x, c.y)) out.unshift(c);
        return out;
      }
      for (const [dx, dy] of Object.values(STEP)) {
        const n = { x: cur.x + dx, y: cur.y + dy };
        const k = key(n.x, n.y);
        if (prev.has(k) || !this.open(n.x, n.y) || blocked.has(k)) continue;
        prev.set(k, cur);
        queue.push(n);
      }
    }
    return null;
  }
}
