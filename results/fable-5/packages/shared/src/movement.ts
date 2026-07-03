import { CONFIG } from "./config.js";
import {
  DIR_VECS,
  TILE,
  tileAt,
  type Dir,
  type SimBalloon,
  type SimPlayer,
  type SimState,
} from "./types.js";

const HW = CONFIG.PLAYER_HALF_WIDTH;
const EPS = 1e-6;

/** true = open, false = wall (boulder/castle), SimBalloon = blocked by a balloon. */
function passable(state: SimState, p: SimPlayer, tx: number, ty: number): boolean | SimBalloon {
  const t = tileAt(state, tx, ty);
  if (t === TILE.BOULDER || t === TILE.CASTLE) return false;
  const b = state.balloons.find((bb) => bb.x === tx && bb.y === ty);
  if (b && !(b.ownerCanPass && b.ownerSlot === p.slot)) return b;
  return true;
}

/** Rows (or columns) the player's body currently spans on the perpendicular axis. */
function spanned(v: number): number[] {
  const lo = Math.floor(v - HW + EPS);
  const hi = Math.floor(v + HW - EPS);
  return lo === hi ? [lo] : [lo, hi];
}

interface AxisResult {
  moved: boolean;
  blockedBy: SimBalloon | "wall" | null;
}

function axisMove(state: SimState, p: SimPlayer, dir: Dir, dist: number): AxisResult {
  const [dx, dy] = DIR_VECS[dir];
  if (dx !== 0) {
    const targetX = p.x + dx * dist;
    const edgeCol = Math.floor(targetX + dx * HW - (dx < 0 ? -EPS : EPS) * 0);
    let blockedBy: SimBalloon | "wall" | null = null;
    for (const row of spanned(p.y)) {
      const r = passable(state, p, edgeCol, row);
      if (r === false) {
        blockedBy = "wall";
        break;
      }
      if (r !== true) {
        blockedBy = r;
        break;
      }
    }
    if (!blockedBy) {
      p.x = targetX;
      return { moved: true, blockedBy: null };
    }
    // Clamp flush against the blocking column (never pulls the player backward:
    // pass-through balloons are the only overlap case and they stay passable
    // until the player has fully left the tile).
    const clamped = dx > 0 ? edgeCol - HW : edgeCol + 1 + HW;
    if ((dx > 0 && clamped > p.x) || (dx < 0 && clamped < p.x)) p.x = clamped;
    return { moved: false, blockedBy };
  }
  const targetY = p.y + dy * dist;
  const edgeRow = Math.floor(targetY + dy * HW);
  let blockedBy: SimBalloon | "wall" | null = null;
  for (const col of spanned(p.x)) {
    const r = passable(state, p, col, edgeRow);
    if (r === false) {
      blockedBy = "wall";
      break;
    }
    if (r !== true) {
      blockedBy = r;
      break;
    }
  }
  if (!blockedBy) {
    p.y = targetY;
    return { moved: true, blockedBy: null };
  }
  const clamped = dy > 0 ? edgeRow - HW : edgeRow + 1 + HW;
  if ((dy > 0 && clamped > p.y) || (dy < 0 && clamped < p.y)) p.y = clamped;
  return { moved: false, blockedBy };
}

/** While moving freely, glide the perpendicular axis back to the lane center. */
function alignPerp(p: SimPlayer, dir: Dir, dist: number): void {
  const [dx] = DIR_VECS[dir];
  if (dx !== 0) {
    const center = Math.floor(p.y) + 0.5;
    if (p.y < center) p.y = Math.min(center, p.y + dist);
    else if (p.y > center) p.y = Math.max(center, p.y - dist);
  } else {
    const center = Math.floor(p.x) + 0.5;
    if (p.x < center) p.x = Math.min(center, p.x + dist);
    else if (p.x > center) p.x = Math.max(center, p.x - dist);
  }
}

/**
 * Blocked head-on but offset within the lane: slide sideways toward the open
 * diagonal so corners feel forgiving (classic grid-battler corner assist).
 */
function cornerAssist(state: SimState, p: SimPlayer, dir: Dir, dist: number): void {
  const [dx, dy] = DIR_VECS[dir];
  if (dx !== 0) {
    const aheadCol = Math.floor(p.x) + dx;
    const row = Math.floor(p.y);
    const off = p.y - (row + 0.5);
    // Straddling into a blocked neighbor lane while our own lane is open
    // ahead: re-center into our lane (otherwise players deadlock on pillar
    // corners while holding a direction).
    if (Math.abs(off) > 1e-9 && passable(state, p, aheadCol, row) === true) {
      p.y = off > 0 ? Math.max(row + 0.5, p.y - dist) : Math.min(row + 0.5, p.y + dist);
      return;
    }
    if (off > 0.08 && passable(state, p, aheadCol, row + 1) === true && passable(state, p, Math.floor(p.x), row + 1) === true) {
      p.y = Math.min(p.y + dist, row + 1.5);
    } else if (off < -0.08 && passable(state, p, aheadCol, row - 1) === true && passable(state, p, Math.floor(p.x), row - 1) === true) {
      p.y = Math.max(p.y - dist, row - 0.5);
    }
  } else {
    const aheadRow = Math.floor(p.y) + dy;
    const col = Math.floor(p.x);
    const off = p.x - (col + 0.5);
    if (Math.abs(off) > 1e-9 && passable(state, p, col, aheadRow) === true) {
      p.x = off > 0 ? Math.max(col + 0.5, p.x - dist) : Math.min(col + 0.5, p.x + dist);
      return;
    }
    if (off > 0.08 && passable(state, p, col + 1, aheadRow) === true && passable(state, p, col + 1, Math.floor(p.y)) === true) {
      p.x = Math.min(p.x + dist, col + 1.5);
    } else if (off < -0.08 && passable(state, p, col - 1, aheadRow) === true && passable(state, p, col - 1, Math.floor(p.y)) === true) {
      p.x = Math.max(p.x - dist, col - 0.5);
    }
  }
}

/**
 * Advance one player one tick. Returns a balloon the player pushed into IF
 * kicking applies (caller starts the slide); otherwise handles blocking and
 * corner assist internally. Used identically by the server sim and by client
 * prediction for the local player.
 */
export function movePlayer(state: SimState, p: SimPlayer, dir: Dir, canKick: boolean): SimBalloon | null {
  if (dir !== 0) p.dir = dir;
  p.moving = dir !== 0;
  if (dir === 0) return null;
  const dist = p.speed / CONFIG.TICK_RATE;
  const res = axisMove(state, p, dir, dist);
  if (res.moved) {
    alignPerp(p, dir, dist);
    return null;
  }
  if (res.blockedBy !== "wall" && res.blockedBy && canKick && !res.blockedBy.slide) {
    return res.blockedBy; // kick it — no corner assist while booting a balloon
  }
  cornerAssist(state, p, dir, dist);
  return null;
}

/** Does the player's body overlap the given tile at all? */
export function overlapsTile(p: { x: number; y: number }, tx: number, ty: number): boolean {
  return p.x + HW > tx && p.x - HW < tx + 1 && p.y + HW > ty && p.y - HW < ty + 1;
}
