/**
 * The in-canvas HUD: a 16px strip along the top of the 256x224 stage, plus the
 * three overlay helpers the game screen drives (kill feed, announcer, shake).
 *
 * Layout note: the round counter and the round timer own a fixed gutter in the
 * middle of the strip, and the player cells are laid out either side of it. A
 * naive even split would put a 4-player cell boundary exactly under the centred
 * timer, so the gutter is what keeps the two from ever colliding.
 */

import { CONFIG, type AnimalId, type HatId, type RoundPhase } from '@splash/shared';
import { getSettings } from '../settings';
import { STAGE_WIDTH } from '../stage';
import { drawCritterIcon } from './sprites';
import { HUD_HEIGHT, SLOT_COLORS, SLOT_DARK, UI } from './palette';
import { drawText, ellipsize, textWidth } from './text';

export interface HudPlayer {
  slot: number;
  nickname: string;
  animal: AnimalId;
  hat: HatId;
  alive: boolean;
  balloons: number;
  range: number;
  speed: number;
  kick: boolean;
  score: number;
  soaks: number;
  ping: number;
}

export interface HudState {
  players: HudPlayer[];
  roundNo: number;
  roundsToWin: number;
  phase: RoundPhase;
  countdownTicks: number;
  /** Ticks until the tide starts; negative once it has. */
  ticksUntilTide: number;
  tideActive: boolean;
  showPing: boolean;
}

// ------------------------------------------------------------------- geometry

/** Width reserved in the middle of the strip for the round and the timer. */
const GUTTER_WIDTH = 36;
const GUTTER_X = Math.floor((STAGE_WIDTH - GUTTER_WIDTH) / 2);
/** Row A holds the portrait, name and pips; row B the stats, ping and timer. */
const ROW_A_Y = 0;
const ROW_B_Y = 9;
const PORTRAIT = 8;
/** Each round pip is a 2px square with a 1px gap. */
const PIP_STEP = 3;

interface Cell {
  x: number;
  w: number;
}

/**
 * Splits the strip either side of the centre gutter. Two players get one wide
 * cell each; four players get two per side.
 */
function cellsFor(count: number): Cell[] {
  const side = GUTTER_X;
  const perSide = Math.max(1, Math.ceil(count / 2));
  const width = Math.floor(side / perSide);
  const cells: Cell[] = [];
  for (let i = 0; i < count; i++) {
    const onRight = i >= perSide;
    const indexInSide = onRight ? i - perSide : i;
    const originX = onRight ? GUTTER_X + GUTTER_WIDTH : 0;
    cells.push({ x: originX + indexInSide * width, w: width });
  }
  return cells;
}

// ----------------------------------------------------------------- tiny icons

/** 3x5 pictograms, one number per row, three bits each with the MSB on the left. */
const ICON_BALLOON = [0b010, 0b111, 0b111, 0b111, 0b010];
const ICON_RANGE = [0b010, 0b010, 0b111, 0b010, 0b010];
const ICON_SPEED = [0b100, 0b110, 0b111, 0b110, 0b100];
const ICON_BOOT = [0b110, 0b100, 0b100, 0b111, 0b111];
const ICON_WIDTH = 3;
const ICON_HEIGHT = 5;

function drawIcon(ctx: CanvasRenderingContext2D, rows: number[], x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  for (let row = 0; row < ICON_HEIGHT; row++) {
    const bits = rows[row];
    if (bits === 0) continue;
    for (let col = 0; col < ICON_WIDTH; col++) {
      if ((bits & (1 << (ICON_WIDTH - 1 - col))) === 0) continue;
      ctx.fillRect(x + col, y + row, 1, 1);
    }
  }
}

/**
 * Stat counts get exactly one character: a 4-player cell has no room for two
 * digits, so anything past 9 collapses to "+", which reads as "maxed out".
 */
function compactCount(value: number): string {
  const n = Math.max(0, Math.round(value));
  return n > 9 ? '+' : String(n);
}

function pingColor(ping: number): string {
  if (ping <= 80) return UI.good;
  if (ping <= 160) return UI.gold;
  return UI.danger;
}

/** Ping is clamped to three characters so it cannot push into the stat row. */
function pingLabel(ping: number): string {
  const value = Math.max(0, Math.round(ping));
  return value > 999 ? '999' : String(value);
}

// -------------------------------------------------------------------- flashing

/** Shared blink phase so every flashing element pulses together. */
function blinkOn(periodMs: number): boolean {
  return Math.floor(performance.now() / periodMs) % 2 === 0;
}

// ------------------------------------------------------------------ the strip

function drawStripBackground(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = UI.bg;
  ctx.fillRect(0, 0, STAGE_WIDTH, HUD_HEIGHT);
  ctx.fillStyle = UI.panelEdge;
  ctx.fillRect(0, HUD_HEIGHT - 1, STAGE_WIDTH, 1);
}

function drawPips(
  ctx: CanvasRenderingContext2D,
  player: HudPlayer,
  roundsToWin: number,
  right: number,
  y: number,
): number {
  const total = Math.max(1, Math.min(CONFIG.MAX_ROUNDS, roundsToWin));
  const width = total * PIP_STEP - 1;
  const originX = right - width;
  const filled = SLOT_COLORS[player.slot % SLOT_COLORS.length];
  const empty = SLOT_DARK[player.slot % SLOT_DARK.length];
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = i < player.score ? filled : empty;
    ctx.fillRect(originX + i * PIP_STEP, y, 2, 2);
    // A one-pixel notch under a filled pip keeps score readable without colour.
    if (i < player.score) ctx.fillRect(originX + i * PIP_STEP, y + 3, 2, 1);
  }
  return width;
}

function drawStats(ctx: CanvasRenderingContext2D, player: HudPlayer, x: number, y: number): void {
  const ink = player.alive ? UI.ink : UI.inkDim;
  const digitY = y - 1;
  let cursor = x;

  const entries: Array<[number[], string]> = [
    [ICON_BALLOON, compactCount(player.balloons)],
    [ICON_RANGE, compactCount(player.range)],
    [ICON_SPEED, compactCount(player.speed)],
  ];
  for (const [icon, label] of entries) {
    drawIcon(ctx, icon, cursor, y, UI.inkDim);
    cursor += ICON_WIDTH + 1;
    drawText(ctx, label, cursor, digitY, ink);
    // One pixel between groups: a 55px cell has exactly enough room for three
    // icon+count pairs, the boot glyph and a three-digit ping.
    cursor += textWidth(label) + 1;
  }
  if (player.kick) drawIcon(ctx, ICON_BOOT, cursor, y, UI.gold);
}

function drawCell(ctx: CanvasRenderingContext2D, cell: Cell, player: HudPlayer, hud: HudState): void {
  const slotColor = SLOT_COLORS[player.slot % SLOT_COLORS.length];
  // A slot-coloured spine plus the portrait identifies the player; the nickname
  // carries the same information for anyone who cannot separate the colours.
  ctx.fillStyle = player.alive ? slotColor : SLOT_DARK[player.slot % SLOT_DARK.length];
  ctx.fillRect(cell.x, ROW_A_Y, 1, HUD_HEIGHT - 2);

  // drawCritterIcon takes the centre of the 8x8 portrait, not its corner.
  const portraitX = cell.x + 2;
  drawCritterIcon(
    ctx,
    { slot: player.slot, animal: player.animal, hat: player.hat },
    portraitX + PORTRAIT / 2,
    ROW_A_Y + PORTRAIT / 2,
  );

  const right = cell.x + cell.w - 2;
  const pipWidth = drawPips(ctx, player, hud.roundsToWin, right, ROW_A_Y + 1);

  const nameX = portraitX + PORTRAIT + 2;
  const nameSpace = right - pipWidth - 2 - nameX;
  const maxChars = Math.max(1, Math.floor((nameSpace + 1) / 6));
  const name = ellipsize(player.nickname, maxChars);
  drawText(ctx, name, nameX, ROW_A_Y, player.alive ? UI.ink : UI.inkDim);

  drawStats(ctx, player, cell.x + 2, ROW_B_Y);

  if (hud.showPing) {
    const label = pingLabel(player.ping);
    drawText(ctx, label, right, ROW_B_Y - 1, pingColor(player.ping), { align: 'right' });
  }

  if (!player.alive) {
    // Dim the whole cell rather than recolouring each element, so a soaked
    // player's row reads as inactive at a glance.
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = UI.bg;
    ctx.fillRect(cell.x + 1, 0, cell.w - 1, HUD_HEIGHT - 1);
    ctx.globalAlpha = 1;
  }
}

function timerText(hud: HudState): string {
  const seconds = Math.max(0, Math.ceil(hud.ticksUntilTide / CONFIG.TICK_RATE));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

function drawCentre(ctx: CanvasRenderingContext2D, hud: HudState): void {
  const centreX = GUTTER_X + Math.floor(GUTTER_WIDTH / 2);
  drawText(ctx, `R${hud.roundNo}/${hud.roundsToWin}`, centreX, ROW_A_Y, UI.inkDim, { align: 'center' });

  if (hud.tideActive || hud.ticksUntilTide <= 0) {
    // The timer is gone once the water starts climbing: the warning replaces it.
    const on = blinkOn(220);
    drawText(ctx, 'TIDE!', centreX, ROW_B_Y - 1, on ? UI.danger : UI.ink, { align: 'center' });
    return;
  }

  const warning = hud.ticksUntilTide <= CONFIG.TIDE_WARNING_TICKS;
  const color = warning && !blinkOn(180) ? UI.danger : UI.ink;
  drawText(ctx, timerText(hud), centreX, ROW_B_Y - 1, color, { align: 'center' });
}

/** Draws the whole HUD strip. Leaves the context transform untouched. */
export function drawHud(ctx: CanvasRenderingContext2D, hud: HudState): void {
  drawStripBackground(ctx);
  const players = hud.players.slice(0, 4);
  const cells = cellsFor(Math.max(1, players.length));
  for (let i = 0; i < players.length; i++) drawCell(ctx, cells[i], players[i], hud);
  drawCentre(ctx, hud);
}

// ------------------------------------------------------------------ kill feed

interface FeedLine {
  text: string;
  color: string;
  /** Milliseconds of life remaining. */
  ttl: number;
}

const FEED_TTL_MS = 3500;
const FEED_FADE_MS = 600;
const FEED_MAX = 4;
const FEED_LINE_HEIGHT = 8;

/** The last few "X soaked Y" lines, right-aligned under the HUD strip. */
export class KillFeed {
  private lines: FeedLine[] = [];

  push(text: string, color = UI.ink): void {
    this.lines.push({ text, color, ttl: FEED_TTL_MS });
    if (this.lines.length > FEED_MAX) this.lines.splice(0, this.lines.length - FEED_MAX);
  }

  update(dtMs: number): void {
    if (this.lines.length === 0) return;
    for (const line of this.lines) line.ttl -= dtMs;
    this.lines = this.lines.filter((line) => line.ttl > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.lines.length === 0) return;
    const right = STAGE_WIDTH - 3;
    let y = HUD_HEIGHT + 3;
    for (const line of this.lines) {
      const alpha = line.ttl < FEED_FADE_MS ? Math.max(0, line.ttl / FEED_FADE_MS) : 1;
      ctx.globalAlpha = alpha;
      drawText(ctx, line.text, right, y, line.color, { align: 'right', shadow: UI.shadow });
      y += FEED_LINE_HEIGHT;
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.lines = [];
  }
}

// ------------------------------------------------------------------- announcer

interface Pop {
  text: string;
  color: string;
  scale: number;
  /** Milliseconds of life remaining. */
  ttl: number;
  ttlTotal: number;
  /** Milliseconds since the pop appeared, used for the scale-in. */
  age: number;
}

const POP_IN_MS = 120;
const POP_FADE_MS = 300;
const ANNOUNCE_Y = 96;

/** Big centred text that pops in, holds, then fades. */
export class Announcer {
  private pop: Pop | null = null;

  show(text: string, color = UI.ink, ttlMs = 1200, scale = 2): void {
    this.pop = { text, color, scale: Math.max(1, Math.round(scale)), ttl: ttlMs, ttlTotal: ttlMs, age: 0 };
  }

  update(dtMs: number): void {
    if (!this.pop) return;
    this.pop.age += dtMs;
    this.pop.ttl -= dtMs;
    if (this.pop.ttl <= 0) this.pop = null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const pop = this.pop;
    if (!pop) return;
    // Overshoot slightly on the way in, which is what gives the text its snap.
    const t = Math.min(1, pop.age / POP_IN_MS);
    const grow = t < 1 ? 0.4 + 0.75 * t : 1 + 0.15 * Math.max(0, 1 - (pop.age - POP_IN_MS) / 90);
    const alpha = pop.ttl < POP_FADE_MS ? Math.max(0, pop.ttl / POP_FADE_MS) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(STAGE_WIDTH / 2, ANNOUNCE_Y);
    ctx.scale(grow, grow);
    drawText(ctx, pop.text, 0, 0, pop.color, { align: 'center', scale: pop.scale, shadow: UI.shadow });
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.pop = null;
  }
}

// --------------------------------------------------------------------- shake

const SHAKE_DECAY_PER_MS = 0.006;
const SHAKE_MAX = 6;

/** Decaying random camera offset. Honours the reduced-shake setting live. */
export class Shaker {
  private strength = 0;
  private x = 0;
  private y = 0;

  kick(strength: number): void {
    this.strength = Math.min(SHAKE_MAX, Math.max(this.strength, strength));
  }

  update(dtMs: number): void {
    if (this.reduced()) {
      this.strength = 0;
      this.x = 0;
      this.y = 0;
      return;
    }
    if (this.strength <= 0) {
      this.x = 0;
      this.y = 0;
      return;
    }
    this.strength = Math.max(0, this.strength - this.strength * SHAKE_DECAY_PER_MS * dtMs - 0.004 * dtMs);
    const amount = this.strength;
    this.x = Math.round((Math.random() * 2 - 1) * amount);
    this.y = Math.round((Math.random() * 2 - 1) * amount);
  }

  get offsetX(): number {
    return this.reduced() ? 0 : this.x;
  }

  get offsetY(): number {
    return this.reduced() ? 0 : this.y;
  }

  /** Read live rather than cached, so the settings toggle applies instantly. */
  private reduced(): boolean {
    return getSettings().reducedShake;
  }
}
