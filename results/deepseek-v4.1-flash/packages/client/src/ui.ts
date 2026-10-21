import type { App } from "./main.js";
import { drawText, drawTextCentered, textWidth, wrapText } from "./render/font.js";

export const COLORS = {
  ink: "#07131d",
  deep: "#061726",
  navy: "#0b2b3e",
  blue: "#123f57",
  teal: "#2ec4b6",
  mint: "#7bf7e1",
  foam: "#d9fff8",
  white: "#f7fff9",
  coral: "#ff6b6b",
  orange: "#ffa94d",
  yellow: "#ffe066",
  green: "#63d471",
  purple: "#b28dff",
  pink: "#ff8fab",
  sand: "#f2d29b",
  shadow: "rgba(3, 10, 16, 0.55)",
} as const;

export const TIER_COLORS: Record<string, string> = {
  Puddle: "#8fb3c7",
  Pond: "#63d471",
  River: "#57c7ff",
  Lake: "#b28dff",
  Ocean: "#ffa94d",
  Tsunami: "#ff6b6b",
};

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export abstract class Screen {
  constructor(readonly app: App) {}
  enter(): void {}
  exit(): void {}
  update(_dt: number): void {}
  render(_ctx: CanvasRenderingContext2D): void {}
  onKeyDown(_event: KeyboardEvent): boolean {
    return false;
  }
  onClick(_x: number, _y: number): void {}
  onRightClick(_x: number, _y: number): void {}
  onMouseMove(_x: number, _y: number): void {}
  cursorAt(_x: number, _y: number): string {
    return "default";
  }
}

export interface Button {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  action: string;
  disabled?: boolean;
  small?: boolean;
}

export function contains(button: Button, x: number, y: number): boolean {
  return x >= button.x && y >= button.y && x < button.x + button.w && y < button.y + button.h;
}

export function drawButton(
  ctx: CanvasRenderingContext2D,
  button: Button,
  hovered: boolean,
  selected = false,
): void {
  const base = button.disabled ? "#17303d" : selected ? "#155b62" : hovered ? "#1a5260" : "#0d3445";
  const border = button.disabled ? "#284451" : hovered || selected ? COLORS.mint : "#3a7d8b";
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(button.x + 2, button.y + 2, button.w, button.h);
  ctx.fillStyle = base;
  ctx.fillRect(button.x, button.y, button.w, button.h);
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(button.x + 0.5, button.y + 0.5, button.w - 1, button.h - 1);
  ctx.fillStyle = hovered || selected ? COLORS.foam : "#d7ecec";
  ctx.fillRect(button.x + 3, button.y + 3, 2, button.h - 6);
  const label = button.disabled ? button.label : button.label;
  const scale = button.small ? 1 : 1;
  drawTextCentered(
    ctx,
    label,
    button.x + button.w / 2 + 2,
    button.y + Math.round((button.h - 7 * scale) / 2),
    button.disabled ? "#557381" : hovered || selected ? COLORS.white : COLORS.foam,
    scale,
  );
}

export function drawPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill = "rgba(7, 27, 40, 0.94)",
  border = "#2e6b7b",
): void {
  ctx.fillStyle = "rgba(2, 8, 12, 0.55)";
  ctx.fillRect(x + 2, y + 3, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = border;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = border;
  ctx.fillRect(x + 2, y + 2, w - 4, 1);
}

export function drawInset(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill = "#071f2d",
): void {
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

export function drawOcean(ctx: CanvasRenderingContext2D, time: number, dark = false): void {
  const top = dark ? "#04131e" : "#082536";
  const bottom = dark ? "#02101a" : "#0b3445";
  for (let y = 0; y < 224; y += 4) {
    const t = y / 224;
    ctx.fillStyle = t < 0.45 ? top : bottom;
    ctx.fillRect(0, y, 256, 4);
  }
  ctx.fillStyle = dark ? "rgba(17, 62, 80, 0.35)" : "rgba(46, 196, 182, 0.13)";
  for (let row = 0; row < 8; row += 1) {
    const offset = ((time * (8 + row * 2)) % 48) - 48;
    for (let x = offset; x < 256; x += 48) {
      const y = 28 + row * 24;
      ctx.fillRect(Math.round(x), y, 18, 1);
      ctx.fillRect(Math.round(x + 7), y + 2, 12, 1);
    }
  }
  ctx.fillStyle = "rgba(123, 247, 225, 0.06)";
  for (let i = 0; i < 18; i += 1) {
    const y = (i * 13 + 7) % 224;
    ctx.fillRect((i * 47) % 248, y, 2, 2);
  }
}

export function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillStyle = COLORS.foam;
  ctx.fillRect(x + 2, y + 1, w - 4, h - 2);
  ctx.fillRect(x + 1, y + 2, w - 2, h - 4);
  ctx.fillStyle = COLORS.foam;
  ctx.fillRect(x + 5, y + h, 4, 1);
  ctx.fillRect(x + 7, y + h + 1, 2, 1);
}

export function drawTierBadge(
  ctx: CanvasRenderingContext2D,
  tier: string,
  x: number,
  y: number,
  scale = 1,
): void {
  const color = TIER_COLORS[tier] ?? COLORS.teal;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 5 * scale, 4 * scale);
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(x + scale, y + scale, scale, scale);
  drawText(ctx, tier, x + 7 * scale, y - scale, color, scale);
}

export function drawKeyCap(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
): number {
  const w = textWidth(label) + 8;
  ctx.fillStyle = "#123f57";
  ctx.fillRect(x, y, w, 11);
  ctx.strokeStyle = "#4c94a6";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 10);
  drawText(ctx, label, x + 4, y + 2, COLORS.foam);
  return w;
}

export function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  color: string,
  lineHeight = 9,
): number {
  const lines = wrapText(text, width);
  lines.forEach((line, index) => drawText(ctx, line, x, y + index * lineHeight, color));
  return lines.length * lineHeight;
}

export function drawProgress(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
  color = COLORS.teal,
): void {
  ctx.fillStyle = "#06151e";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#2d5966";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const filled = Math.round((w - 2) * clamp(value, 0, 1));
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, filled, h - 2);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(x + 1, y + 1, filled, 1);
}

export function drawCloud(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale = 1,
  color = "rgba(217, 255, 248, 0.12)",
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y + 3 * scale, 12 * scale, 4 * scale);
  ctx.fillRect(x + 3 * scale, y, 5 * scale, 7 * scale);
  ctx.fillRect(x + 8 * scale, y + 2 * scale, 4 * scale, 5 * scale);
}

export function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  ctx.fillStyle = "rgba(255, 224, 102, 0.16)";
  ctx.fillRect(x - 18, y - 18, 36, 36);
  ctx.fillStyle = "#ffe066";
  ctx.fillRect(x - 8, y - 8, 16, 16);
  ctx.fillStyle = "#fff3b0";
  ctx.fillRect(x - 5, y - 5, 10, 10);
  const pulse = Math.floor(time * 3) % 2;
  ctx.fillStyle = "rgba(255, 224, 102, 0.3)";
  ctx.fillRect(x - 14 - pulse, y - 1, 4, 2);
  ctx.fillRect(x + 10 + pulse, y - 1, 4, 2);
}
