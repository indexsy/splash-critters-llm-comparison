// Small HUD building blocks: 5x5 stat icons for the compact FFA strip, tiny ping bars, round
// score pips and a chip backing panel.
import { PAL, slotColor } from './palette';
import { PixelGrid, cached, type Legend } from './pixelart';

export type StatIcon = 'balloon' | 'range' | 'speed' | 'boots';

const MINI: Record<StatIcon, { rows: readonly string[]; legend: Legend }> = {
  balloon: { legend: { r: PAL.red, w: PAL.pinkLight, d: PAL.redDark }, rows: ['.rrr.', 'rwrrr', 'rrrrd', '.rdd.', '..d..'] },
  range: { legend: { b: PAL.sky, w: PAL.foam }, rows: ['..b..', '..b..', 'bbwbb', '..b..', '..b..'] },
  speed: { legend: { g: PAL.greenLight, d: PAL.greenDark }, rows: ['g.g.g', 'ggggg', '.ggg.', '..d..', '..d..'] },
  boots: { legend: { y: PAL.yellow, d: PAL.gold, r: PAL.red }, rows: ['.rr..', '.yy..', '.yy..', '.yyyy', 'ddddd'] },
};

export const MINI_ICON = 5;

/** Cached 5x5 stat icon (no outline: drawn on the dark HUD strip). */
export function miniIcon(name: StatIcon): HTMLCanvasElement {
  return cached(`hud-mini:${name}`, () => PixelGrid.fromRows(MINI[name].rows, MINI[name].legend).toCanvas());
}

/** Bars lit for a round-trip time (4 good ... 1 bad), matching icons.ts pingGlyph bands. */
function pingLevel(rttMs: number): number {
  return rttMs < 80 ? 4 : rttMs < 150 ? 3 : rttMs < 250 ? 2 : 1;
}

const PING_COLOR = [PAL.red, PAL.red, PAL.orange, PAL.yellow, PAL.green];

/** 7x5 ping bars (four 1 px bars of rising height). */
export function drawPingBars(ctx: CanvasRenderingContext2D, x: number, y: number, rttMs: number): void {
  const level = pingLevel(rttMs);
  for (let i = 0; i < 4; i++) {
    const h = i + 2;
    ctx.fillStyle = i < level ? PING_COLOR[level] : PAL.greyDark;
    ctx.fillRect(x + i * 2, y + 5 - h, 1, h);
  }
}

/**
 * Round score pips: `won` filled in the slot colour out of `total`. Vertical columns suit the
 * compact strip; `size` is the pip edge in pixels.
 */
export function drawPips(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  won: number,
  total: number,
  slot: number,
  colorblind: boolean,
  opts: { size: number; vertical: boolean },
): void {
  const color = slotColor(slot, colorblind);
  const step = opts.size + 1;
  const n = opts.size;
  for (let i = 0; i < total; i++) {
    const px = opts.vertical ? x : x + i * step;
    const py = opts.vertical ? y + i * step : y;
    if (i < won) {
      ctx.fillStyle = color.main;
      ctx.fillRect(px, py, n, n);
      if (n >= 3) {
        ctx.fillStyle = color.light;
        ctx.fillRect(px, py, n - 1, 1);
        ctx.fillStyle = color.dark;
        ctx.fillRect(px, py + n - 1, n, 1);
      }
      continue;
    }
    // Empty pip: a hollow socket (dark centre, grey rim) so unwon rounds still read as slots.
    ctx.fillStyle = PAL.greyDark;
    ctx.fillRect(px, py, n, n);
    if (n >= 3) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(px + 1, py + 1, n - 2, n - 2);
    }
  }
}

/** Chip backing: dark panel with a 1 px frame (slot colour for the local player). */
export function drawChipPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frame: string): void {
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = PAL.shadow;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = frame;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

/** Dim an area (soaked / disconnected players). */
export function dim(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha = 0.55): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
}
