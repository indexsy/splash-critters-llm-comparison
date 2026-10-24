import { xpForLevel } from "@splash/shared";
import type { App } from "../main.js";

export const C = {
  navy: "#10162f",
  dark: "#080d1f",
  panel: "#182142",
  panelLight: "#29345d",
  blue: "#3867d6",
  cyan: "#8be9fd",
  water: "#38bdf8",
  yellow: "#f9dc5c",
  cream: "#f7f3d5",
  green: "#56e39f",
  red: "#d64550",
  orange: "#f78c4b",
  muted: "#8a96bd",
  purple: "#9b7ede"
};

export function text(app: App, value: string, x: number, y: number, color = C.cream, size = 8, align: CanvasTextAlign = "left"): void {
  const ctx = app.canvas;
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px "Courier New", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillText(value, Math.round(x), Math.round(y));
}

export function centered(app: App, value: string, x: number, y: number, color = C.cream, size = 8): void {
  text(app, value, x, y, color, size, "center");
}

export function truncate(app: App, value: string, width: number): string {
  const ctx = app.canvas;
  ctx.font = "bold 8px \"Courier New\", monospace";
  if (ctx.measureText(value).width <= width) return value;
  let result = value;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > width) result = result.slice(0, -1);
  return `${result}…`;
}

export function panel(app: App, x: number, y: number, width: number, height: number, color = C.panel): void {
  const ctx = app.canvas;
  ctx.fillStyle = C.dark;
  ctx.fillRect(x + 2, y + 2, width, height);
  ctx.fillStyle = C.panelLight;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = color;
  ctx.fillRect(x + 2, y + 2, width - 4, height - 4);
}

export function background(app: App, time: number, beach = false): void {
  const ctx = app.canvas;
  ctx.fillStyle = beach ? "#16405c" : C.navy;
  ctx.fillRect(0, 0, 256, 224);
  ctx.fillStyle = beach ? "#1d5673" : "#151e3d";
  for (let y = 0; y < 224; y += 16) {
    for (let x = (y / 16 % 2) * 8; x < 256; x += 16) ctx.fillRect(x, y, 8, 8);
  }
  ctx.fillStyle = beach ? "#8be9fd22" : "#3867d622";
  const drift = Math.floor(time / 400) % 16;
  for (let x = -16; x < 272; x += 32) ctx.fillRect(x + drift, 196, 20, 2);
}

export function button(
  app: App,
  id: string,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  action: () => void,
  options: { disabled?: boolean; color?: string; small?: boolean } = {}
): void {
  const hovered = app.pointerX >= x && app.pointerX <= x + width && app.pointerY >= y && app.pointerY <= y + height && !options.disabled;
  const color = options.disabled ? C.panelLight : hovered ? C.cyan : options.color ?? C.blue;
  app.canvas.fillStyle = C.dark;
  app.canvas.fillRect(x + 2, y + 2, width, height);
  app.canvas.fillStyle = color;
  app.canvas.fillRect(x, y, width, height);
  app.canvas.fillStyle = hovered ? C.cream : "#ffffff33";
  app.canvas.fillRect(x + 2, y + 2, width - 4, 2);
  centered(app, label, x + width / 2, y + Math.floor((height - (options.small ? 7 : 8)) / 2), options.disabled ? C.muted : hovered || color === C.cyan ? C.navy : C.cream, options.small ? 7 : 8);
  app.addHitRegion({ id, x, y, width, height, action, disabled: Boolean(options.disabled) });
}

export function xpBar(app: App, x: number, y: number, width: number, xp: number, level: number, animatedXp?: number): void {
  const needed = xpForLevel(level);
  const currentLevelStart = level <= 1 ? 0 : Array.from({ length: level - 1 }, (_, index) => xpForLevel(index + 1)).reduce((a, b) => a + b, 0);
  const shown = animatedXp ?? xp;
  const progress = Math.max(0, Math.min(1, (shown - currentLevelStart) / needed));
  app.canvas.fillStyle = C.dark;
  app.canvas.fillRect(x, y, width, 7);
  app.canvas.fillStyle = C.green;
  app.canvas.fillRect(x + 1, y + 1, Math.floor((width - 2) * progress), 5);
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function openDialog(app: App, title: string): HTMLDivElement {
  app.closeDialog();
  const dialog = document.createElement("div");
  dialog.className = "dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const heading = document.createElement("h2");
  heading.textContent = title;
  dialog.append(heading);
  app.overlay.append(dialog);
  return dialog;
}

export function dialogButton(label: string, onClick: () => void, className = ""): HTMLButtonElement {
  const buttonElement = document.createElement("button");
  buttonElement.type = "button";
  buttonElement.textContent = label;
  buttonElement.className = className;
  buttonElement.addEventListener("click", onClick);
  return buttonElement;
}

export function addDialogActions(dialog: HTMLDivElement, ...buttons: HTMLButtonElement[]): void {
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(...buttons);
  dialog.append(actions);
}

export function textField(dialog: HTMLDivElement, label: string, value = "", maxLength = 24): HTMLInputElement {
  const labelElement = document.createElement("label");
  labelElement.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.maxLength = maxLength;
  labelElement.append(input);
  dialog.append(labelElement);
  return input;
}

export function selectField(dialog: HTMLDivElement, label: string, options: { value: string; label: string }[], value: string): HTMLSelectElement {
  const labelElement = document.createElement("label");
  labelElement.textContent = label;
  const select = document.createElement("select");
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  }
  select.value = value;
  labelElement.append(select);
  dialog.append(labelElement);
  return select;
}

export function checkField(dialog: HTMLDivElement, label: string, checked: boolean): HTMLInputElement {
  const row = document.createElement("div");
  row.className = "row";
  const labelElement = document.createElement("label");
  labelElement.textContent = label;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  labelElement.htmlFor = `check-${Math.random().toString(36).slice(2)}`;
  input.id = labelElement.htmlFor;
  row.append(labelElement, input);
  dialog.append(row);
  return input;
}

export function rangeField(dialog: HTMLDivElement, label: string, value: number, onInput: (value: number) => void): HTMLInputElement {
  const labelElement = document.createElement("label");
  labelElement.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "1";
  input.step = "0.05";
  input.value = String(value);
  input.addEventListener("input", () => onInput(Number(input.value)));
  labelElement.append(input);
  dialog.append(labelElement);
  return input;
}
