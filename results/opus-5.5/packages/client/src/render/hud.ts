// In-match HUD: one chip per player (portrait with hat, name, live stats, round-score pips,
// ping bars, soaked/disconnected state) and a centre block with the round number and the
// rising-tide countdown (TIDE! once it floods). Compact 16 px strip for FFA, roomier chips for
// Duel and the tutorial.
import { CONFIG, maxTideLevel, type MatchPlayerInfo, type PlayerState } from '@splash/shared';
import { displayName, formatClockSeconds } from '../game/labels';
import type { Scene } from '../game/scene';
import type { ArenaLayout } from './camera';
import { SCREEN_W } from './camera';
import { drawText } from './font';
import { MINI_ICON, dim, drawChipPanel, drawPingBars, drawPips, miniIcon, type StatIcon } from './hud-parts';
import { drawLabel } from './label';
import { PAL, slotColor } from './palette';
import { PORTRAIT_SIZE, getGlyph, getPortrait } from './sprites';
import { fitText } from './textFit';

/** Seconds before the tide during which the countdown blinks red. */
const TIDE_WARN_SECONDS = 10;

interface ChipData {
  slot: number;
  info: MatchPlayerInfo;
  player: PlayerState | undefined;
  local: boolean;
  score: number;
  ping: number | null;
  state: 'ok' | 'soaked' | 'dc' | 'out' | 'bot';
}

function chipState(scene: Scene, slot: number, player: PlayerState | undefined): ChipData['state'] {
  const st = scene.status.get(slot);
  // A seated slot missing from the round has forfeited (its player_status may predate a reload).
  if (st?.forfeited || (player && !player.present)) return 'out';
  if (st && !st.connected && !st.replacedByBot) return 'dc';
  if (player && player.present && !player.alive) return 'soaked';
  if (st?.replacedByBot) return 'bot';
  return 'ok';
}

function chips(scene: Scene): ChipData[] {
  return [...scene.config.players]
    .sort((a, b) => a.slot - b.slot)
    .map((info) => {
      const player = scene.world?.players[info.slot];
      const rtt = scene.pings[info.slot];
      return {
        slot: info.slot,
        info,
        player,
        local: info.slot === scene.mySlot,
        score: scene.scores[info.slot] ?? 0,
        ping: scene.showPing && !info.isBot && rtt !== undefined && rtt >= 0 ? rtt : null,
        state: chipState(scene, info.slot, player),
      };
    });
}

function stats(p: PlayerState | undefined): [StatIcon, number][] {
  return [
    ['balloon', p?.maxBalloons ?? CONFIG.BALLOONS_BASE],
    ['range', p?.range ?? CONFIG.RANGE_BASE],
    ['speed', 1 + (p?.speedUps ?? 0)],
  ];
}

/** Stat row: icon + value per stat. Returns the x after the row. */
function drawStats(ctx: CanvasRenderingContext2D, x: number, y: number, p: PlayerState | undefined, gap: number): number {
  let cx = x;
  for (const [icon, value] of stats(p)) {
    ctx.drawImage(miniIcon(icon), cx, y);
    cx += MINI_ICON + 1;
    cx += drawText(ctx, String(value), cx, y, { font: 'small', color: PAL.cloud }) + gap;
  }
  return cx;
}

/** Portrait with the boots badge and the state overlay (soaked / DC / out / bot). */
function drawPortrait(ctx: CanvasRenderingContext2D, c: ChipData, x: number, y: number, colorblind: boolean, nowMs: number): void {
  ctx.drawImage(getPortrait(c.info.animal, c.info.hat, c.slot, colorblind), x, y);
  if (c.player?.canKick) ctx.drawImage(miniIcon('boots'), x + PORTRAIT_SIZE - 5, y + PORTRAIT_SIZE - 5);
  if (c.state === 'soaked') {
    dim(ctx, x, y, PORTRAIT_SIZE, PORTRAIT_SIZE, 0.45);
    ctx.drawImage(getGlyph('soaked'), x + 3, y + 3);
  } else if (c.state === 'dc' || c.state === 'out') {
    dim(ctx, x, y, PORTRAIT_SIZE, PORTRAIT_SIZE, 0.6);
    if (c.state === 'out' || Math.floor(nowMs / 400) % 2 === 0) drawLabel(ctx, c.state === 'dc' ? 'DC' : 'OUT', x + 7, y + 4, { font: 'small', color: PAL.pink });
  } else if (c.state === 'bot') {
    ctx.drawImage(getGlyph('bot'), x + PORTRAIT_SIZE - 7, y - 2);
  }
}

function frameColor(c: ChipData, colorblind: boolean): string {
  const color = slotColor(c.slot, colorblind);
  return c.local ? color.main : color.dark;
}

const COMPACT_CHIP_W = 55;

/** 55x16 chip: portrait | name + ping / stats | vertical pips. */
function drawCompactChip(ctx: CanvasRenderingContext2D, c: ChipData, x: number, scene: Scene): void {
  const cb = scene.colorblind;
  drawChipPanel(ctx, x, 0, COMPACT_CHIP_W, 16, frameColor(c, cb));
  drawPortrait(ctx, c, x + 1, 1, cb, scene.nowMs);
  const textX = x + 16;
  const nameMax = (c.ping !== null ? x + 43 : x + 51) - textX;
  drawText(ctx, fitText(displayName(c.info), nameMax, 'small'), textX, 2, { font: 'small', color: c.local ? PAL.white : PAL.cloud });
  if (c.ping !== null) drawPingBars(ctx, x + 44, 2, c.ping);
  drawStats(ctx, textX, 9, c.player, 2);
  const total = scene.config.roundsToWin;
  const pipH = total * 3 - 1;
  drawPips(ctx, x + 52, Math.max(1, Math.floor((16 - pipH) / 2)), c.score, total, c.slot, cb, { size: 2, vertical: true });
  if (c.state !== 'ok' && c.state !== 'bot') dim(ctx, textX, 1, COMPACT_CHIP_W - 17, 14, 0.35);
}

const ROOMY_CHIP_W = 100;
const ROOMY_CHIP_H = 22;

/** 100x22 chip: portrait | big name + pips / stats + boots + ping. */
function drawRoomyChip(ctx: CanvasRenderingContext2D, c: ChipData, x: number, y: number, scene: Scene): void {
  const cb = scene.colorblind;
  drawChipPanel(ctx, x, y, ROOMY_CHIP_W, ROOMY_CHIP_H, frameColor(c, cb));
  drawPortrait(ctx, c, x + 3, y + 4, cb, scene.nowMs);
  const total = scene.config.roundsToWin;
  const pipsW = total * 5 - 1;
  const pipsX = x + ROOMY_CHIP_W - 4 - pipsW;
  drawPips(ctx, pipsX, y + 4, c.score, total, c.slot, cb, { size: 4, vertical: false });
  const textX = x + 20;
  const name = fitText(displayName(c.info), pipsX - 3 - textX, 'big');
  drawText(ctx, name, textX, y + 3, { color: c.local ? PAL.white : PAL.cloud, shadow: PAL.ink });
  const after = drawStats(ctx, textX, y + 13, c.player, 4);
  if (c.player?.canKick) ctx.drawImage(miniIcon('boots'), after, y + 13);
  if (c.ping !== null) drawPingBars(ctx, x + ROOMY_CHIP_W - 11, y + 13, c.ping);
  if (c.state !== 'ok' && c.state !== 'bot') dim(ctx, textX, y + 2, ROOMY_CHIP_W - 22, ROOMY_CHIP_H - 4, 0.35);
}

/** Round number plus the tide countdown / TIDE! warning, centred on `cx`. */
function drawCenterBlock(ctx: CanvasRenderingContext2D, scene: Scene, cx: number, y: number): void {
  const round = scene.round;
  const world = scene.world;
  if (!round || !world || !world.rules.tide) {
    // No round yet after a reload between rounds: name the round whose result is showing.
    const roundNo = round?.roundNo ?? scene.result?.roundNo;
    const label = scene.config.tutorial ? 'TUTORIAL' : roundNo ? `ROUND ${roundNo}` : 'READY';
    drawText(ctx, label, cx, y + 4, { font: 'small', color: PAL.sand, align: 'center' });
    return;
  }
  drawText(ctx, `ROUND ${round.roundNo}`, cx, y, { font: 'small', color: PAL.sand, align: 'center' });
  const blink = Math.floor(scene.nowMs / 250) % 2 === 0;
  if (world.tideLevel > 0) {
    const full = world.tideLevel >= maxTideLevel(world.w, world.h);
    drawText(ctx, 'TIDE!', cx, y + 7, { color: full || blink ? PAL.sky : PAL.white, shadow: PAL.blueDark, align: 'center' });
    return;
  }
  const seconds = (round.tideStartTick - Math.max(0, scene.estTick)) / CONFIG.TICK_RATE;
  const warn = seconds <= TIDE_WARN_SECONDS && scene.phase === 'live';
  drawText(ctx, formatClockSeconds(seconds), cx, y + 7, { color: warn && blink ? PAL.red : PAL.white, shadow: PAL.ink, align: 'center' });
}

function drawStrip(ctx: CanvasRenderingContext2D, y: number, h: number): void {
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, y, SCREEN_W, h);
}

/** Roomy layouts: a dark 2 px frame separating the arena from the themed backdrop. */
function drawArenaFrame(ctx: CanvasRenderingContext2D, layout: ArenaLayout): void {
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(layout.ax - 2, layout.ay - 2, layout.aw + 4, 2);
  ctx.fillRect(layout.ax - 2, layout.ay + layout.ah, layout.aw + 4, 2);
  ctx.fillRect(layout.ax - 2, layout.ay, 2, layout.ah);
  ctx.fillRect(layout.ax + layout.aw, layout.ay, 2, layout.ah);
}

const CENTER_W = 44;

/** Roomy layouts: backing plate for the round / tide block between the two chips. */
function drawCenterPanel(ctx: CanvasRenderingContext2D, y: number): void {
  drawChipPanel(ctx, (SCREEN_W - CENTER_W) / 2, y, CENTER_W, ROOMY_CHIP_H, PAL.slate);
}

export function drawHud(ctx: CanvasRenderingContext2D, scene: Scene, layout: ArenaLayout): void {
  const list = chips(scene);
  if (layout.hud === 'compact') {
    drawStrip(ctx, 0, layout.topH);
    const xs = [1, 57, 145, 201];
    list.slice(0, 4).forEach((c, i) => drawCompactChip(ctx, c, xs[i], scene));
    drawCenterBlock(ctx, scene, SCREEN_W / 2, 1);
    return;
  }
  const chipY = Math.max(1, Math.floor((layout.topH - ROOMY_CHIP_H) / 2));
  drawArenaFrame(ctx, layout);
  drawCenterPanel(ctx, chipY);
  const left = list.slice(0, Math.ceil(list.length / 2));
  const right = list.slice(left.length);
  left.forEach((c, i) => drawRoomyChip(ctx, c, 4 + i * (ROOMY_CHIP_W + 2), chipY, scene));
  right.forEach((c, i) => drawRoomyChip(ctx, c, SCREEN_W - 4 - ROOMY_CHIP_W - i * (ROOMY_CHIP_W + 2), chipY, scene));
  drawCenterBlock(ctx, scene, SCREEN_W / 2, chipY + 3);
}
