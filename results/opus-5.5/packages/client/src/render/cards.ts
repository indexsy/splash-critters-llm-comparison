// Full-card overlays: the match intro VS card (critters, names#tags, tiers and ratings for
// ranked, map theme) and the round result card shown between rounds (over the arena, or over
// the themed backdrop when a reload lands between rounds).
import { Dir, type DirCode, type MatchConfig, type MatchPlayerInfo } from '@splash/shared';
import { canvasThemeLabel, clip, displayName, headlineText, roundCardHeadline, type ResultHeadline } from '../game/labels';
import type { RoundResult } from '../game/scene';
import { SCREEN_H, SCREEN_W, type ArenaLayout } from './camera';
import { drawText } from './font';
import { dim, drawPips } from './hud-parts';
import { drawLabel } from './label';
import { PAL, THEME_PALETTES, slotColor } from './palette';
import { PORTRAIT_SIZE, getCritter, getPortrait, getShadow, getTierBadge } from './sprites';
import { fitLabel, headlineLines, labelHeight, labelWidth } from './textFit';

function modeTitle(c: MatchConfig): string {
  if (c.tutorial) return 'TUTORIAL';
  if (c.practice) return 'PRACTICE';
  const mode = c.mode === 'duel' ? 'DUEL' : 'FREE-FOR-ALL';
  return `${c.ranked ? 'RANKED' : 'CASUAL'} ${mode}`;
}

/** Backdrop with diagonal pixel stripes in the match theme's colour. */
function drawBackdrop(ctx: CanvasRenderingContext2D, c: MatchConfig, nowMs: number): void {
  const base = c.theme === 'random' ? PAL.navy : THEME_PALETTES[c.theme].backdrop;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.fillStyle = PAL.ink;
  ctx.globalAlpha = 0.35;
  const shift = Math.floor(nowMs / 60) % 16;
  for (let y = 0; y < SCREEN_H; y += 2) {
    for (let x = ((y + shift) % 16) - 16; x < SCREEN_W; x += 16) ctx.fillRect(x, y, 6, 2);
  }
  ctx.globalAlpha = 1;
}

/** Rating line for a player on the VS card. */
function subtitle(p: MatchPlayerInfo, ranked: boolean): string {
  if (p.isBot) return p.difficulty ? `BOT ${p.difficulty.toUpperCase()}` : 'BOT';
  if (ranked && p.rating !== undefined) return String(Math.round(p.rating));
  return `LV ${p.level}`;
}

/** One contender: big critter on a shadow, name, #tag and tier/level line. */
function drawContender(ctx: CanvasRenderingContext2D, p: MatchPlayerInfo, cx: number, top: number, scale: number, facing: DirCode, c: MatchConfig, colorblind: boolean, nameMax: number): void {
  const critter = getCritter(p.animal, p.hat, facing, 0, p.slot, colorblind);
  const w = critter.width * scale;
  const h = critter.height * scale;
  ctx.drawImage(getShadow(12), cx - 6 * scale, top + h - 2 * scale, 12 * scale, 4 * scale);
  ctx.drawImage(critter, cx - w / 2, top, w, h);
  const color = slotColor(p.slot, colorblind);
  let y = top + h + 4;
  drawLabel(ctx, clip(displayName(p), nameMax), cx, y, { color: color.light });
  y += 10;
  if (!p.isBot && p.tag) drawText(ctx, `#${p.tag}`, cx, y, { font: 'small', color: PAL.greyLight, align: 'center' });
  y += 8;
  const line = subtitle(p, c.ranked);
  if (c.ranked && p.tier && !p.isBot) {
    const badge = getTierBadge(p.tier, 'small');
    const tw = drawText(ctx, line, cx + 8, y + 3, { color: PAL.yellow, align: 'center', shadow: PAL.ink });
    ctx.drawImage(badge, Math.round(cx + 8 - tw / 2 - 15), y);
  } else {
    drawText(ctx, line, cx, y + 2, { font: 'small', color: p.isBot ? PAL.aqua : PAL.cloud, align: 'center' });
  }
}

/** Match intro: VS card for MATCH_INTRO_MS after match_start (until the first round_start). */
export function drawIntroCard(ctx: CanvasRenderingContext2D, c: MatchConfig, elapsedMs: number, nowMs: number, colorblind: boolean): void {
  drawBackdrop(ctx, c, nowMs);
  drawLabel(ctx, modeTitle(c), SCREEN_W / 2, 10, { scale: 2, bands: [PAL.yellowLight, PAL.yellow, PAL.orange] });
  const players = [...c.players].sort((a, b) => a.slot - b.slot);
  const slide = Math.max(0, 1 - elapsedMs / 300);
  if (players.length <= 2) {
    const [a, b] = players;
    const offset = Math.round(slide * 90);
    if (a) drawContender(ctx, a, 64 - offset, 52, 3, Dir.Right, c, colorblind, 14);
    if (b) drawContender(ctx, b, 192 + offset, 52, 3, Dir.Left, c, colorblind, 14);
    const punch = elapsedMs < 380 ? 3 : 2;
    if (elapsedMs > 250) drawLabel(ctx, 'VS', SCREEN_W / 2, 90 - 9 * punch, { scale: punch, bold: true, bands: [PAL.white, PAL.skyLight, PAL.sky] });
  } else {
    players.forEach((p, i) => {
      const dir = i % 2 === 0 ? Dir.Right : Dir.Left;
      drawContender(ctx, p, 32 + i * 64, 50 + Math.round(slide * (i % 2 ? -60 : 60)), 2, dir, c, colorblind, 9);
    });
  }
  const footer = `FIRST TO ${c.roundsToWin}   ${canvasThemeLabel(c.theme)}`;
  drawLabel(ctx, footer, SCREEN_W / 2, SCREEN_H - 20, { color: PAL.sand });
}

const CARD_W = 184;
/** The featured critter's column on the left of the card; the headline is centred beside it. */
const HERO_COL = 44;
const TITLE_LINE_GAP = 2;
const HEADLINE_BANDS: Record<ResultHeadline['tone'], readonly string[]> = {
  mine: [PAL.yellowLight, PAL.yellow, PAL.orange],
  theirs: [PAL.foam, PAL.skyLight, PAL.sky],
  neutral: [PAL.white, PAL.cloud],
};

/** Headline lines centred on (`cx`, `cy`), stacked when a long name took its own line. */
function drawHeadlineBeside(ctx: CanvasRenderingContext2D, lines: readonly string[], cx: number, cy: number, bands: readonly string[]): void {
  const lineH = labelHeight();
  const total = lines.length * lineH + (lines.length - 1) * TITLE_LINE_GAP;
  lines.forEach((line, i) => drawLabel(ctx, line, cx, Math.round(cy - total / 2) + i * (lineH + TITLE_LINE_GAP), { bands }));
}

/** A headline with no critter beside it: bold when it fits the card, plain (clipped) otherwise. */
function drawHeadlineAlone(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, bands: readonly string[]): void {
  const maxW = CARD_W - 8;
  if (labelWidth(text, { bold: true }) <= maxW) drawLabel(ctx, text, cx, top, { bold: true, bands });
  else drawLabel(ctx, fitLabel(text, maxW), cx, top + 4, { bands });
}

/** Result card between rounds: headline, winner critter and every player's round pips. */
export function drawRoundResult(
  ctx: CanvasRenderingContext2D,
  r: RoundResult,
  c: MatchConfig,
  layout: ArenaLayout,
  nowMs: number,
  colorblind: boolean,
): void {
  const players = [...c.players].sort((a, b) => a.slot - b.slot);
  const nameOf = (slot: number) => displayName(players.find((p) => p.slot === slot)).toUpperCase();
  const head = roundCardHeadline(r, c.yourSlot, nameOf);
  const rowH = PORTRAIT_SIZE + 2;
  const w = CARD_W;
  const hero = players.find((p) => p.slot === head.hero);
  const rowsTop = hero ? 56 : 40;
  const h = rowsTop + 2 + players.length * rowH;
  const x = Math.round(layout.ax + (layout.aw - w) / 2);
  const y = Math.round(layout.ay + (layout.ah - h) / 2);
  dim(ctx, layout.ax, layout.ay, layout.aw, layout.ah, 0.45);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = PAL.shadow;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = PAL.slate;
  ctx.fillRect(x, y, w, 1);
  drawText(ctx, r.matchOver ? 'FINAL ROUND' : `ROUND ${r.roundNo}`, x + w / 2, y + 4, { font: 'small', color: PAL.sand, align: 'center' });
  const bands = HEADLINE_BANDS[head.tone];
  const bounce = Math.floor(nowMs / 200) % 2;
  if (hero) {
    const critter = getCritter(hero.animal, hero.hat, Dir.Down, 1 + bounce, hero.slot, colorblind);
    ctx.drawImage(critter, x + 8, y + 12, critter.width * 2, critter.height * 2);
    const titleW = w - HERO_COL - 4;
    drawHeadlineBeside(ctx, headlineLines(head, titleW), x + HERO_COL + titleW / 2, y + 12 + critter.height, bands);
  } else {
    drawHeadlineAlone(ctx, headlineText(head), x + w / 2, y + 14, bands);
  }
  players.forEach((p, i) => {
    const ry = y + rowsTop + i * rowH;
    const color = slotColor(p.slot, colorblind);
    ctx.drawImage(getPortrait(p.animal, p.hat, p.slot, colorblind), x + 10, ry);
    drawText(ctx, clip(displayName(p), 14), x + 28, ry + 4, { color: p.slot === head.hero ? color.light : PAL.cloud });
    drawPips(ctx, x + w - 10 - (c.roundsToWin * 5 - 1), ry + 4, r.scores[p.slot] ?? 0, c.roundsToWin, p.slot, colorblind, { size: 4, vertical: false });
  });
}

/** The round result card over the match's themed backdrop (no arena to draw behind it). */
export function drawResultBetweenRounds(
  ctx: CanvasRenderingContext2D,
  r: RoundResult,
  c: MatchConfig,
  layout: ArenaLayout,
  nowMs: number,
  colorblind: boolean,
): void {
  drawBackdrop(ctx, c, nowMs);
  drawRoundResult(ctx, r, c, layout, nowMs, colorblind);
}
