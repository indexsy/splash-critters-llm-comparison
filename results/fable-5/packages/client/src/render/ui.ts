// Minimal immediate-mode canvas UI: panels, buttons, toggles, text fields.
// Everything is pixel-styled and driven by app.mouse each frame.

import { app } from "../app.js";
import { PAL } from "./palette.js";
import { drawText, drawTextCentered, textWidth } from "./font.js";

export function panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title?: string): void {
  g.fillStyle = PAL.uiPanel;
  g.fillRect(x, y, w, h);
  g.strokeStyle = PAL.uiEdge;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (title) {
    g.fillStyle = PAL.uiEdge;
    g.fillRect(x, y, w, 9);
    drawText(g, title, x + 3, y + 2, PAL.white);
  }
}

export function hover(x: number, y: number, w: number, h: number): boolean {
  const m = app.mouse;
  return m.x >= x && m.x < x + w && m.y >= y && m.y < y + h;
}

export function button(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  opts: { disabled?: boolean; selected?: boolean; color?: string } = {}
): boolean {
  const hov = !opts.disabled && hover(x, y, w, h);
  g.fillStyle = opts.disabled ? PAL.darkgray : opts.selected ? PAL.uiEdge : hov ? "#2a5480" : PAL.uiPanel;
  g.fillRect(x, y, w, h);
  g.strokeStyle = opts.selected ? PAL.gold : PAL.uiEdge;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const color = opts.disabled ? PAL.gray : (opts.color ?? PAL.white);
  drawTextCentered(g, label, x + w / 2, y + Math.floor((h - 5) / 2), color);
  const clicked = hov && app.mouse.clicked;
  if (clicked) app.audio.sfx("click");
  return clicked;
}

export function toggle(g: CanvasRenderingContext2D, x: number, y: number, label: string, value: boolean): boolean {
  const w = 12 + textWidth(label) + 6;
  const hov = hover(x, y, w, 9);
  g.fillStyle = value ? PAL.green : PAL.darkgray;
  g.fillRect(x, y, 9, 9);
  g.strokeStyle = hov ? PAL.gold : PAL.uiEdge;
  g.strokeRect(x + 0.5, y + 0.5, 8, 8);
  if (value) drawText(g, "!", x + 3, y + 2, PAL.black);
  drawText(g, label, x + 12, y + 2, PAL.white);
  const clicked = hov && app.mouse.clicked;
  if (clicked) app.audio.sfx("click");
  return clicked;
}

/** Horizontal slider 0..1; returns the new value while dragging. */
export function slider(g: CanvasRenderingContext2D, x: number, y: number, w: number, value: number): number {
  const h = 7;
  g.fillStyle = PAL.darkgray;
  g.fillRect(x, y + 2, w, 3);
  g.fillStyle = PAL.water;
  g.fillRect(x, y + 2, Math.round(w * value), 3);
  const knobX = x + Math.round(w * value) - 2;
  g.fillStyle = PAL.white;
  g.fillRect(knobX, y, 4, h);
  if (app.mouse.down && hover(x - 3, y - 2, w + 6, h + 4)) {
    return Math.max(0, Math.min(1, (app.mouse.x - x) / w));
  }
  return value;
}

/** Simple focused-text-field renderer; caller owns the string state. */
export function textField(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  value: string,
  focused: boolean,
  placeholder = ""
): boolean {
  g.fillStyle = PAL.black;
  g.fillRect(x, y, w, 11);
  g.strokeStyle = focused ? PAL.gold : PAL.uiEdge;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, 10);
  if (value) {
    drawText(g, value, x + 3, y + 3, PAL.white);
  } else {
    drawText(g, placeholder, x + 3, y + 3, PAL.gray);
  }
  if (focused && Math.floor(performance.now() / 400) % 2 === 0) {
    const cx = x + 3 + textWidth(value) + (value ? 1 : 0);
    g.fillStyle = PAL.gold;
    g.fillRect(cx, y + 2, 1, 7);
  }
  return hover(x, y, w, 11) && app.mouse.clicked;
}

/** Fullscreen dim + centered panel; returns content origin. */
export function modal(g: CanvasRenderingContext2D, w: number, h: number, title: string): { x: number; y: number } {
  g.fillStyle = "rgba(15,15,27,0.75)";
  g.fillRect(0, 0, 256, 224);
  const x = Math.floor((256 - w) / 2);
  const y = Math.floor((224 - h) / 2);
  panel(g, x, y, w, h, title);
  return { x, y: y + 12 };
}
