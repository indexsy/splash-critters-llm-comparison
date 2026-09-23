// Pure spatial navigation: which box lies next in an arrow-key direction (console-style menus).

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type NavDir = 'up' | 'down' | 'left' | 'right';

/** Weight of the sideways gap versus the forward distance (keeps columns/rows together). */
const CROSS_WEIGHT = 4;
/** Minimum centre shift that counts as "further along" the pressed direction. */
const MIN_ADVANCE = 2;

function centre(b: Box): { x: number; y: number } {
  return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
}

/** Gap between two 1-D intervals (0 when they overlap). */
function intervalGap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));
}

function score(from: Box, to: Box, dir: NavDir): number {
  const f = centre(from);
  const t = centre(to);
  const vertical = dir === 'up' || dir === 'down';
  const sign = dir === 'down' || dir === 'right' ? 1 : -1;
  const advance = (vertical ? t.y - f.y : t.x - f.x) * sign;
  if (advance < MIN_ADVANCE) return Infinity;
  const forwardGap = vertical
    ? Math.max(0, sign > 0 ? to.top - from.bottom : from.top - to.bottom)
    : Math.max(0, sign > 0 ? to.left - from.right : from.left - to.right);
  const crossGap = vertical ? intervalGap(from.left, from.right, to.left, to.right) : intervalGap(from.top, from.bottom, to.top, to.bottom);
  // Sideways drift: centre offset, or leading-edge offset when that is smaller, so moving from a
  // wide control onto a row of buttons lands on the first one (reading order), like a console menu.
  const centreDrift = Math.abs(vertical ? t.x - f.x : t.y - f.y);
  const edgeDrift = Math.abs(vertical ? to.left - from.left : to.top - from.top);
  return forwardGap + crossGap * CROSS_WEIGHT + Math.min(centreDrift, edgeDrift) * 0.05;
}

/** Index of the best candidate in direction `dir` from `from`, or -1 when nothing lies that way. */
export function pickNeighbor(from: Box, candidates: readonly Box[], dir: NavDir): number {
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((c, i) => {
    const s = score(from, c, dir);
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return best;
}

export function arrowDir(code: string): NavDir | null {
  switch (code) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}
