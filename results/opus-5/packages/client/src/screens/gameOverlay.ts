/**
 * The full-screen cards the match screen paints over (or instead of) the arena:
 * the VS intro, the round scoreboard during the end-of-round freeze, and the two
 * small status lines for spectators and revenge ducks.
 *
 * Everything here is pure drawing over the 256x224 stage. It owns no state and
 * reads nothing global, so the tutorial can reuse the same cards unchanged.
 */

import {
  Dir,
  themeDef,
  tierForRating,
  type MatchConfig,
  type MatchPlayerInfo,
} from '@splash/shared';
import { SLOT_COLORS, UI, shade } from '../render/palette';
import { drawCritter } from '../render/sprites';
import { drawText, ellipsize, textWidth } from '../render/text';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage';

/** How long the entries take to slide into place, in seconds. */
const SLIDE_SECONDS = 0.45;
const SLIDE_DISTANCE = 70;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function slotColor(slot: number): string {
  const count = SLOT_COLORS.length;
  return SLOT_COLORS[((Math.floor(slot) % count) + count) % count];
}

/** Chunky bordered panel, matching the DOM shell's look on the canvas. */
function panelBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = UI.shadow;
  ctx.fillRect(x + 2, y + 2, w, h);
  ctx.fillStyle = UI.panel;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = UI.panelEdge;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

/** Short enough to sit on one line of the 5x7 font. */
export function shortKeyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM${code.slice(6)}`;
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  if (code === 'Space') return 'SPACE';
  if (code === 'Escape') return 'ESC';
  return code.toUpperCase();
}

// ------------------------------------------------------------------- VS intro

function backdrop(ctx: CanvasRenderingContext2D, seconds: number): void {
  ctx.fillStyle = UI.bg;
  ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  // Slow diagonal bands so the card never reads as a frozen frame.
  ctx.fillStyle = shade(UI.water, 0.72);
  const drift = Math.floor((seconds * 18) % 24);
  for (let y = -24 + drift; y < STAGE_HEIGHT; y += 24) {
    ctx.fillRect(0, y, STAGE_WIDTH, 8);
  }
}

function entryLine(info: MatchPlayerInfo, ranked: boolean): string {
  if (ranked && info.rating !== null) return `${tierForRating(info.rating).name} ${info.rating}`;
  if (info.isBot) return `BOT ${info.difficulty ?? ''}`.trim();
  return `LEVEL ${info.level}`;
}

function drawEntry(
  ctx: CanvasRenderingContext2D,
  info: MatchPlayerInfo,
  cx: number,
  cy: number,
  ranked: boolean,
): void {
  drawCritter(ctx, { slot: info.slot, animal: info.animal, hat: info.hat }, cx, cy, Dir.DOWN, 0);
  drawText(ctx, ellipsize(info.nickname, 12), cx, cy + 12, slotColor(info.slot), {
    align: 'center',
    shadow: UI.shadow,
  });
  drawText(ctx, entryLine(info, ranked), cx, cy + 21, UI.inkDim, {
    align: 'center',
    shadow: UI.shadow,
  });
}

/** Grid centres for the roster, laid out so both sizes stay inside the stage. */
function entrySpots(count: number): Array<{ x: number; y: number }> {
  if (count <= 2) {
    return [
      { x: 64, y: 118 },
      { x: 192, y: 118 },
    ];
  }
  return [
    { x: 64, y: 96 },
    { x: 192, y: 96 },
    { x: 64, y: 158 },
    { x: 192, y: 158 },
  ];
}

/** The pre-match card. `seconds` is time since the card appeared. */
export function drawVsCard(
  ctx: CanvasRenderingContext2D,
  config: MatchConfig,
  seconds: number,
): void {
  backdrop(ctx, seconds);

  const mode = config.mode === 'duel' ? 'DUEL' : 'FREE-FOR-ALL';
  drawText(ctx, config.ranked ? `RANKED ${mode}` : mode, STAGE_WIDTH / 2, 26, UI.gold, {
    align: 'center',
    shadow: UI.shadow,
    scale: 2,
  });
  drawText(ctx, `${themeDef(config.theme).name} - first to ${config.roundsToWin}`, STAGE_WIDTH / 2, 48, UI.ink, {
    align: 'center',
    shadow: UI.shadow,
  });

  // Ease-out so the critters arrive with a little weight behind them.
  const t = clamp01(seconds / SLIDE_SECONDS);
  const slide = (1 - (1 - t) * (1 - t) * (1 - t)) * SLIDE_DISTANCE - SLIDE_DISTANCE;
  const spots = entrySpots(config.players.length);

  for (let i = 0; i < config.players.length && i < spots.length; i++) {
    const spot = spots[i];
    const fromLeft = spot.x < STAGE_WIDTH / 2;
    drawEntry(ctx, config.players[i], spot.x + (fromLeft ? slide : -slide), spot.y, config.ranked);
  }

  if (config.players.length <= 2) {
    drawText(ctx, 'VS', STAGE_WIDTH / 2, 106, UI.danger, {
      align: 'center',
      shadow: UI.shadow,
      scale: 3,
    });
  }

  drawText(ctx, 'Get ready', STAGE_WIDTH / 2, STAGE_HEIGHT - 24, UI.inkDim, {
    align: 'center',
    shadow: UI.shadow,
  });
}

// ------------------------------------------------------------ round scoreboard

export interface RoundBoardInfo {
  roundNo: number;
  players: MatchPlayerInfo[];
  scores: number[];
  winners: number[];
  roundsToWin: number;
}

/** The brief standings card during the freeze between rounds. */
export function drawRoundBoard(ctx: CanvasRenderingContext2D, info: RoundBoardInfo): void {
  const rows = info.players.length;
  const width = 168;
  const height = 30 + rows * 10;
  const x = Math.floor((STAGE_WIDTH - width) / 2);
  const y = 56;

  panelBox(ctx, x, y, width, height);
  drawText(ctx, `Round ${info.roundNo}`, STAGE_WIDTH / 2, y + 5, UI.inkDim, { align: 'center' });

  const winner = info.players.find((p) => p.slot === info.winners[0]);
  const headline = info.winners.length === 0 ? 'Drawn round' : `${ellipsize(winner?.nickname ?? 'Nobody', 14)} wins it`;
  drawText(ctx, headline, STAGE_WIDTH / 2, y + 15, UI.gold, { align: 'center' });

  let rowY = y + 28;
  for (const player of info.players) {
    const score = info.scores[player.slot] ?? 0;
    drawText(ctx, ellipsize(player.nickname, 14), x + 8, rowY, slotColor(player.slot));
    drawText(ctx, `${score}/${info.roundsToWin}`, x + width - 8, rowY, UI.ink, { align: 'right' });
    rowY += 10;
  }
}

// ------------------------------------------------------------- status ribbons

/** One centred line on a dark strip, so it reads over any theme. */
function ribbon(ctx: CanvasRenderingContext2D, text: string, y: number, color: string): void {
  const width = textWidth(text) + 8;
  const x = Math.floor((STAGE_WIDTH - width) / 2);
  ctx.fillStyle = UI.shadow;
  ctx.fillRect(x, y - 2, width, 11);
  drawText(ctx, text, STAGE_WIDTH / 2, y, color, { align: 'center' });
}

export function drawSpectatorBadge(ctx: CanvasRenderingContext2D): void {
  ribbon(ctx, 'Spectating', STAGE_HEIGHT - 12, UI.inkDim);
}

/** Shown to a soaked critter riding its revenge duck around the border. */
export function drawDuckHint(ctx: CanvasRenderingContext2D, dropLabel: string): void {
  ribbon(ctx, 'Soaked! Paddle with left and right', STAGE_HEIGHT - 22, UI.ink);
  ribbon(ctx, `${dropLabel} lobs a balloon in`, STAGE_HEIGHT - 11, UI.gold);
}

/** Placeholder while the match config is still on its way. */
export function drawWaiting(ctx: CanvasRenderingContext2D, text: string, seconds: number): void {
  backdrop(ctx, seconds);
  drawText(ctx, text, STAGE_WIDTH / 2, 104, UI.ink, { align: 'center', shadow: UI.shadow, scale: 2 });
  const dots = '.'.repeat(1 + (Math.floor(seconds * 2) % 3));
  drawText(ctx, dots, STAGE_WIDTH / 2, 126, UI.inkDim, { align: 'center', shadow: UI.shadow });
}
