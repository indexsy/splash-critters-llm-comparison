import type { AnimalId, ArenaTheme, Dir, HatId, PowerupKind } from "@splash/shared";
import { COLORS } from "../ui.js";

interface Palette {
  body: string;
  dark: string;
  light: string;
  accent: string;
}

const PALETTES: Record<AnimalId, Palette> = {
  frog: { body: "#63d471", dark: "#2f9e55", light: "#b8ffb2", accent: "#ff8fab" },
  duck: { body: "#ffe066", dark: "#d6a72f", light: "#fff6bf", accent: "#ff9f43" },
  otter: { body: "#b47b52", dark: "#765035", light: "#e0b58d", accent: "#f5dfc0" },
  penguin: { body: "#385a7c", dark: "#213b54", light: "#eef6fb", accent: "#ffb347" },
  cat: { body: "#ffa94d", dark: "#c66c27", light: "#ffd7a8", accent: "#ff8fab" },
  raccoon: { body: "#8c99ad", dark: "#535f73", light: "#d2d8e2", accent: "#202937" },
  turtle: { body: "#7ecf78", dark: "#3f8f4d", light: "#c7f5b5", accent: "#c08a52" },
  capybara: { body: "#b9845c", dark: "#7d5538", light: "#e4bb93", accent: "#5f3b27" },
};

export function animalPalette(animal: AnimalId): Palette {
  return PALETTES[animal];
}

function rect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

export interface AnimalDraw {
  animal: AnimalId;
  hat: HatId;
  x: number;
  y: number;
  dir?: Dir;
  frame?: number;
  moving?: boolean;
  soaked?: boolean;
  scale?: number;
  time?: number;
  noHat?: boolean;
}

export function drawAnimal(ctx: CanvasRenderingContext2D, draw: AnimalDraw): void {
  const scale = draw.scale ?? 1;
  const dir = draw.dir ?? "down";
  const frame = draw.frame ?? 0;
  const time = draw.time ?? 0;
  const palette = PALETTES[draw.animal];
  const bob = draw.moving ? (frame % 2 === 0 ? 0 : 1) : Math.floor(time * 2) % 2 === 0 ? 0 : 1;
  ctx.save();
  ctx.translate(Math.round(draw.x), Math.round(draw.y + bob * scale));
  ctx.scale(scale, scale);
  if (draw.soaked) {
    ctx.globalAlpha = 0.92;
  }
  rect(ctx, 3, 13, 8, 1, "rgba(0,0,0,0.28)");
  const foot = frame % 2 === 0 ? 0 : 1;
  rect(ctx, 2, 12 - foot, 3, 2, palette.dark);
  rect(ctx, 9, 12 + foot - 1, 3, 2, palette.dark);

  switch (draw.animal) {
    case "frog":
      rect(ctx, 1, 0, 3, 3, palette.body);
      rect(ctx, 10, 0, 3, 3, palette.body);
      rect(ctx, 2, 5, 10, 7, palette.body);
      rect(ctx, 3, 6, 8, 5, palette.light);
      rect(ctx, 4, 8, 6, 2, palette.dark);
      rect(ctx, 2, 3, 3, 3, "#ffffff");
      rect(ctx, 9, 3, 3, 3, "#ffffff");
      break;
    case "duck":
      rect(ctx, 3, 2, 9, 9, palette.body);
      rect(ctx, 1, 6, 4, 4, palette.light);
      rect(ctx, 4, 5, 7, 6, palette.body);
      rect(ctx, 7, 8, 4, 2, palette.accent);
      rect(ctx, 2, 4, 2, 3, palette.dark);
      break;
    case "otter":
      rect(ctx, 2, 1, 3, 3, palette.dark);
      rect(ctx, 9, 1, 3, 3, palette.dark);
      rect(ctx, 2, 3, 10, 10, palette.body);
      rect(ctx, 3, 5, 8, 7, palette.light);
      rect(ctx, 1, 8, 2, 4, palette.dark);
      rect(ctx, 11, 8, 2, 4, palette.dark);
      break;
    case "penguin":
      rect(ctx, 2, 2, 10, 10, palette.body);
      rect(ctx, 1, 4, 2, 6, palette.dark);
      rect(ctx, 11, 4, 2, 6, palette.dark);
      rect(ctx, 4, 5, 6, 6, palette.light);
      rect(ctx, 6, 8, 3, 2, palette.accent);
      rect(ctx, 3, 12, 3, 2, palette.accent);
      rect(ctx, 8, 12, 3, 2, palette.accent);
      break;
    case "cat":
      rect(ctx, 2, 0, 3, 4, palette.body);
      rect(ctx, 9, 0, 3, 4, palette.body);
      rect(ctx, 3, 1, 1, 2, palette.accent);
      rect(ctx, 10, 1, 1, 2, palette.accent);
      rect(ctx, 2, 4, 10, 9, palette.body);
      rect(ctx, 4, 7, 6, 4, palette.light);
      rect(ctx, 3, 9, 4, 1, palette.accent);
      rect(ctx, 8, 9, 4, 1, palette.accent);
      break;
    case "raccoon":
      rect(ctx, 2, 1, 3, 3, palette.dark);
      rect(ctx, 9, 1, 3, 3, palette.dark);
      rect(ctx, 2, 3, 10, 10, palette.body);
      rect(ctx, 3, 5, 8, 3, palette.accent);
      rect(ctx, 5, 7, 4, 3, palette.light);
      rect(ctx, 2, 9, 3, 4, palette.light);
      rect(ctx, 9, 9, 3, 4, palette.light);
      break;
    case "turtle":
      rect(ctx, 2, 2, 10, 9, palette.accent);
      rect(ctx, 3, 3, 8, 7, palette.dark);
      rect(ctx, 4, 4, 2, 2, palette.body);
      rect(ctx, 8, 4, 2, 2, palette.body);
      rect(ctx, 6, 6, 2, 2, palette.body);
      rect(ctx, 4, 9, 2, 2, palette.body);
      rect(ctx, 8, 9, 2, 2, palette.body);
      rect(ctx, 3, 1, 8, 4, palette.body);
      rect(ctx, 4, 2, 6, 2, palette.light);
      break;
    case "capybara":
      rect(ctx, 2, 1, 10, 11, palette.body);
      rect(ctx, 1, 2, 2, 3, palette.dark);
      rect(ctx, 11, 2, 2, 3, palette.dark);
      rect(ctx, 3, 5, 8, 6, palette.light);
      rect(ctx, 5, 7, 6, 4, palette.body);
      rect(ctx, 8, 8, 2, 1, palette.accent);
      rect(ctx, 5, 10, 3, 1, palette.accent);
      break;
  }

  if (draw.soaked) {
    rect(ctx, 1, 5, 12, 6, "rgba(63, 192, 255, 0.25)");
    rect(ctx, 2, 3, 1, 2, "#9ee8ff");
    rect(ctx, 11, 7, 1, 2, "#9ee8ff");
  }

  const eyeY = draw.animal === "frog" ? 4 : draw.animal === "capybara" ? 6 : 6;
  const leftEye = dir === "right" ? 5 : dir === "left" ? 3 : 4;
  const rightEye = dir === "right" ? 9 : dir === "left" ? 7 : 8;
  if (draw.soaked) {
    rect(ctx, leftEye, eyeY, 2, 1, palette.accent);
    rect(ctx, leftEye, eyeY, 1, 2, palette.accent);
    rect(ctx, rightEye, eyeY, 2, 1, palette.accent);
    rect(ctx, rightEye + 1, eyeY, 1, 2, palette.accent);
  } else if (dir !== "up") {
    rect(ctx, leftEye, eyeY, 1, 2, "#101820");
    rect(ctx, rightEye, eyeY, 1, 2, "#101820");
    if (draw.animal !== "frog") {
      rect(ctx, leftEye, eyeY, 1, 1, "#ffffff");
      rect(ctx, rightEye, eyeY, 1, 1, "#ffffff");
    }
  }

  if (!draw.noHat) drawHat(ctx, draw.hat, draw.animal, frame, time);
  ctx.restore();
}

function drawHat(
  ctx: CanvasRenderingContext2D,
  hat: HatId,
  animal: AnimalId,
  frame: number,
  time: number,
): void {
  if (hat === "none") return;
  const top = animal === "frog" ? -3 : animal === "penguin" ? -1 : 0;
  if (hat === "bucket") {
    rect(ctx, 1, top + 1, 12, 2, "#708a43");
    rect(ctx, 3, top - 3, 8, 4, "#95ad5d");
    rect(ctx, 3, top - 3, 8, 1, "#c0d77f");
  } else if (hat === "snorkel") {
    rect(ctx, 2, top + 3, 10, 2, "#42c4d9");
    rect(ctx, 3, top + 3, 2, 3, "#bff7ff");
    rect(ctx, 10, top - 2, 2, 7, "#ffe066");
    rect(ctx, 10, top - 2, 1, 2, "#fff6bf");
  } else if (hat === "crown") {
    rect(ctx, 3, top, 8, 2, "#ffe066");
    rect(ctx, 3, top - 2, 2, 2, "#ffe066");
    rect(ctx, 6, top - 3, 2, 3, "#ffe066");
    rect(ctx, 9, top - 2, 2, 2, "#ffe066");
    rect(ctx, 6, top, 1, 1, "#ff6b6b");
  } else if (hat === "bandana") {
    rect(ctx, 2, top + 1, 10, 2, "#e94f64");
    rect(ctx, 1, top + 2, 2, 1, "#b93248");
    rect(ctx, 10, top + 3, 2, 2, "#e94f64");
    rect(ctx, 11, top + 5, 1, 2, "#b93248");
  } else if (hat === "propeller") {
    rect(ctx, 3, top + 1, 8, 3, "#ff6b6b");
    rect(ctx, 4, top, 6, 1, "#ff9d9d");
    const spin = Math.floor(time * 12 + frame) % 2 === 0;
    rect(ctx, 7, top - 2, 1, 3, "#ffe066");
    if (spin) rect(ctx, 4, top - 2, 7, 1, "#ffe066");
    else rect(ctx, 7, top - 3, 1, 3, "#ffe066");
  }
}

export function drawDuckie(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale = 1,
  time = 0,
): void {
  const bob = Math.floor(time * 4) % 2;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y + bob * scale));
  ctx.scale(scale, scale);
  rect(ctx, 1, 5, 11, 5, "#ffe066");
  rect(ctx, 8, 1, 4, 6, "#ffe066");
  rect(ctx, 11, 4, 3, 2, "#ff9f43");
  rect(ctx, 9, 2, 1, 1, "#101820");
  rect(ctx, 3, 4, 4, 2, "#fff6bf");
  rect(ctx, 1, 10, 10, 1, "rgba(10, 40, 60, 0.3)");
  ctx.restore();
}

export function drawBalloon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fuseRatio: number,
  time: number,
  size = 1,
): void {
  const urgency = fuseRatio > 0.72;
  const wobble = urgency ? Math.floor(time * 24) % 2 : Math.floor(time * 8) % 2;
  const offset = wobble * size;
  ctx.save();
  ctx.translate(Math.round(x + offset), Math.round(y));
  ctx.scale(size, size);
  rect(ctx, 3, 13, 8, 1, "rgba(0,0,0,0.25)");
  rect(ctx, 2, 2, 10, 10, "#bff6ff");
  rect(ctx, 3, 1, 8, 12, "#e8fdff");
  rect(ctx, 2, 4, 10, 6, "#74e3f2");
  rect(ctx, 3, 5, 8, 5, "#41c4df");
  rect(ctx, 4, 3, 3, 2, "#ffffff");
  rect(ctx, 4, 11, 6, 2, "#2387a6");
  rect(ctx, 6, 13, 2, 1, "#0b3445");
  rect(ctx, 5, 14, 4, 1, "#1e6b80");
  if (urgency) rect(ctx, 5, 4, 4, 2, "rgba(255, 107, 107, 0.45)");
  ctx.restore();
}

export function drawSplash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  progress: number,
  colorblind: boolean,
  kind: "splash" | "revenge" = "splash",
): void {
  const centerX = Math.round(x + tileSize / 2);
  const centerY = Math.round(y + tileSize / 2);
  const foam = colorblind ? "#f6f3c8" : "#d9fff8";
  const water = kind === "revenge" ? "#ff8fab" : colorblind ? "#ffd34d" : "#57c7ff";
  const deep = kind === "revenge" ? "#c94f71" : colorblind ? "#d9932c" : "#237fbd";
  const grow = Math.min(1, progress * 2.6);
  const half = Math.max(2, Math.round((tileSize / 2) * grow));
  rect(ctx, centerX - half, centerY - 1, half * 2, 3, deep);
  rect(ctx, centerX - 1, centerY - half, 3, half * 2, deep);
  rect(ctx, centerX - half + 1, centerY, half * 2 - 2, 2, water);
  rect(ctx, centerX, centerY - half + 1, 2, half * 2 - 2, water);
  rect(ctx, centerX - 3, centerY - 3, 6, 6, foam);
  if (progress > 0.25) {
    rect(ctx, centerX - half - 1, centerY - 2, 1, 2, foam);
    rect(ctx, centerX + half, centerY, 1, 2, foam);
    rect(ctx, centerX - 2, centerY - half - 1, 2, 1, foam);
    rect(ctx, centerX, centerY + half, 2, 1, foam);
  }
  if (progress > 0.55) {
    rect(ctx, centerX - half + 2, centerY - 3, 2, 1, water);
    rect(ctx, centerX + half - 4, centerY + 2, 2, 1, water);
  }
}

export function drawPowerup(
  ctx: CanvasRenderingContext2D,
  kind: PowerupKind,
  x: number,
  y: number,
  time: number,
  tileSize: number,
): void {
  const bob = Math.floor(time * 4) % 2;
  const cx = Math.round(x + tileSize / 2);
  const cy = Math.round(y + tileSize / 2 + bob);
  rect(ctx, cx - 7, cy - 7, 14, 14, "#07131d");
  rect(ctx, cx - 6, cy - 6, 12, 12, "#fff3c4");
  rect(ctx, cx - 5, cy - 5, 10, 10, "#ffe066");
  if (kind === "balloon") {
    rect(ctx, cx - 3, cy - 3, 6, 6, "#63c7ff");
    rect(ctx, cx - 2, cy - 3, 2, 2, "#ffffff");
    rect(ctx, cx - 1, cy + 3, 2, 2, "#237fbd");
  } else if (kind === "splash") {
    rect(ctx, cx - 4, cy - 1, 8, 2, "#237fbd");
    rect(ctx, cx - 1, cy - 4, 2, 8, "#237fbd");
    rect(ctx, cx - 2, cy - 2, 4, 4, "#bff6ff");
  } else if (kind === "flippers") {
    rect(ctx, cx - 4, cy - 3, 3, 6, "#2ec4b6");
    rect(ctx, cx + 1, cy - 3, 3, 6, "#2ec4b6");
    rect(ctx, cx - 5, cy + 2, 5, 2, "#2ec4b6");
    rect(ctx, cx, cy + 2, 5, 2, "#2ec4b6");
  } else {
    rect(ctx, cx - 4, cy - 4, 4, 6, "#a9744f");
    rect(ctx, cx, cy - 3, 4, 7, "#a9744f");
    rect(ctx, cx - 5, cy + 2, 5, 2, "#5f3b27");
    rect(ctx, cx, cy + 4, 5, 2, "#5f3b27");
  }
}

function hashCell(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return (h ^ (h >> 16)) >>> 0;
}

export function drawThemeTile(
  ctx: CanvasRenderingContext2D,
  theme: ArenaTheme,
  x: number,
  y: number,
  size: number,
  tx: number,
  ty: number,
): void {
  const variation = hashCell(tx, ty) % 4;
  if (theme === "backyard") {
    rect(ctx, x, y, size, size, variation === 0 ? "#3f9c55" : "#3b9350");
    rect(ctx, x, y, size, 2, "#4eb463");
    rect(ctx, x + 2, y + 4, 1, 2, "#2e7d46");
    rect(ctx, x + size - 4, y + size - 5, 1, 2, "#2e7d46");
    if (variation === 0) {
      rect(ctx, x + 5, y + 7, 1, 1, "#ffe066");
      rect(ctx, x + 7, y + 6, 1, 1, "#fff3b0");
    }
  } else if (theme === "beach") {
    rect(ctx, x, y, size, size, variation === 0 ? "#e4c583" : "#dfbf7b");
    rect(ctx, x, y, size, 1, "#f2d99d");
    rect(ctx, x + 2, y + size - 4, 3, 1, "#c9a563");
    if (variation === 1) {
      rect(ctx, x + size - 5, y + 4, 2, 1, "#fff0ce");
      rect(ctx, x + size - 4, y + 5, 1, 1, "#b58b53");
    }
  } else {
    rect(ctx, x, y, size, size, variation === 0 ? "#76d5de" : "#6bcdd8");
    rect(ctx, x + 1, y + 1, size - 2, size - 2, "#8be2e9");
    rect(ctx, x, y, size, 1, "#b8f6f7");
    if (variation === 2) {
      rect(ctx, x + 3, y + 4, 4, 4, "rgba(255,255,255,0.25)");
    }
  }
  rect(ctx, x, y, size, 1, "rgba(255,255,255,0.08)");
}

export function drawBoulder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  tx: number,
  ty: number,
): void {
  const n = hashCell(tx, ty);
  rect(ctx, x + 1, y + size - 3, size - 2, 2, "rgba(0,0,0,0.25)");
  rect(ctx, x + 1, y + 2, size - 2, size - 4, "#5c6670");
  rect(ctx, x + 2, y + 1, size - 4, size - 2, "#7b8790");
  rect(ctx, x + 3, y + 3, size - 6, size - 7, "#96a2a9");
  rect(ctx, x + 3, y + 3, 3, 2, "#bcc5c9");
  rect(ctx, x + size - 5 - (n % 2), y + size - 5, 2, 1, "#4a535b");
}

export function drawCastle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  tx: number,
  ty: number,
): void {
  const variation = hashCell(tx, ty) % 3;
  const sand = variation === 0 ? "#f2d29b" : variation === 1 ? "#e8c488" : "#f7dca9";
  const shade = "#c79d61";
  const light = "#fff0c9";
  rect(ctx, x + 1, y + size - 2, size - 2, 1, "rgba(60,40,15,0.18)");
  rect(ctx, x + 2, y + 5, size - 4, size - 6, shade);
  rect(ctx, x + 2, y + 5, size - 4, size - 7, sand);
  rect(ctx, x + 3, y + 3, 3, 3, sand);
  rect(ctx, x + size - 6, y + 3, 3, 3, sand);
  rect(ctx, x + 2, y + 3, 1, 2, light);
  rect(ctx, x + size - 3, y + 3, 1, 3, light);
  rect(ctx, x + size / 2 - 1, y + size - 5, 2, 3, "#8a6538");
  rect(ctx, x + 4, y + 8, 1, 2, "#b98e56");
  rect(ctx, x + size - 5, y + 8, 1, 2, "#b98e56");
  if (variation === 2) rect(ctx, x + 3, y + size - 4, 2, 1, light);
}

export function drawFence(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  rect(ctx, x, y, w, h, "#9b744a");
  rect(ctx, x, y, w, 1, "#d8b27b");
  for (let px = x + 2; px < x + w; px += 6) {
    rect(ctx, px, y - 1, 2, h + 2, "#b88a55");
  }
}

export function isFlooded(ring: number, x: number, y: number, w: number, h: number): boolean {
  if (ring <= 0) return false;
  return x < ring || y < ring || x >= w - ring || y >= h - ring;
}

export function drawTideTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  time: number,
  edge: boolean,
): void {
  rect(ctx, x, y, size, size, "rgba(38, 153, 205, 0.64)");
  rect(ctx, x, y, size, 2, "rgba(191, 246, 255, 0.5)");
  const shimmer = Math.floor(time * 8 + x * 0.3 + y * 0.2) % 4;
  rect(ctx, x + 2 + shimmer, y + 5, 3, 1, "rgba(217, 255, 248, 0.5)");
  rect(ctx, x + size - 7, y + size - 6, 2, 1, "rgba(217, 255, 248, 0.35)");
  if (edge) {
    rect(ctx, x, y + size - 1, size, 1, "rgba(191, 246, 255, 0.8)");
    rect(ctx, x + 2, y + size, 3, 1, "rgba(191, 246, 255, 0.45)");
  }
}

export function drawHeart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  filled: boolean,
  scale = 1,
): void {
  const color = filled ? COLORS.coral : "#345263";
  rect(ctx, x + scale, y, scale, scale, color);
  rect(ctx, x + 3 * scale, y, scale, scale, color);
  rect(ctx, x, y + scale, 4 * scale, 2 * scale, color);
  rect(ctx, x + 4 * scale, y + scale, 4 * scale, 2 * scale, color);
  rect(ctx, x + scale, y + 3 * scale, 6 * scale, scale, color);
  rect(ctx, x + 2 * scale, y + 4 * scale, 4 * scale, scale, color);
  rect(ctx, x + 3 * scale, y + 5 * scale, 2 * scale, scale, color);
}
