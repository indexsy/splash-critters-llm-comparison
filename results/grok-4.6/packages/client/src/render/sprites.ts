import type { AnimalId, HatId, ResolvedTheme } from "@splash/shared";

export const PAL = {
  ink: "#1a1430",
  paper: "#f4e8c1",
  grass: "#3d8c40",
  grassDark: "#2a6b2e",
  sand: "#e0c070",
  sandDark: "#c9a04a",
  pool: "#3aa0c8",
  poolDark: "#2b7a9a",
  boulder: "#6b6b78",
  boulderHi: "#9a9aa8",
  castle: "#d4a574",
  castleHi: "#f0d0a0",
  water: "#3d9ee8",
  water2: "#7ec8ff",
  waterCb: "#e8c03d",
  waterCb2: "#ffe87e",
  balloon: "#5ec4ff",
  balloonDark: "#2a7fbf",
  ui: "#241c3c",
  accent: "#ff7eb6",
  gold: "#f4d35e",
  danger: "#ef476f",
};

export const ANIMAL_COLORS: Record<AnimalId, { body: string; belly: string; eye: string }> = {
  frog: { body: "#5cb85c", belly: "#b6e388", eye: "#fff" },
  duck: { body: "#f4d35e", belly: "#fff3b0", eye: "#222" },
  otter: { body: "#c48a5a", belly: "#e8c9a0", eye: "#222" },
  penguin: { body: "#2c3e50", belly: "#ecf0f1", eye: "#fff" },
  cat: { body: "#c9a66b", belly: "#f3e2c0", eye: "#2ecc71" },
  raccoon: { body: "#7f8c8d", belly: "#d5d8dc", eye: "#111" },
  turtle: { body: "#1e8449", belly: "#82e0aa", eye: "#111" },
  capybara: { body: "#a67c52", belly: "#d2b48c", eye: "#111" },
};

export function themeColors(theme: ResolvedTheme): { floor: string; floor2: string } {
  if (theme === "beach") return { floor: PAL.sand, floor2: PAL.sandDark };
  if (theme === "pool") return { floor: PAL.pool, floor2: PAL.poolDark };
  return { floor: PAL.grass, floor2: PAL.grassDark };
}

export function drawAnimal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  animal: AnimalId,
  hat: HatId,
  frame: number,
  soaked = false,
): void {
  const c = ANIMAL_COLORS[animal] ?? ANIMAL_COLORS.frog;
  const bob = frame % 2 === 0 ? 0 : 1;
  ctx.fillStyle = soaked ? "#7ec8ff" : c.body;
  ctx.fillRect(x + 2, y + 4 + bob, 12, 10);
  ctx.fillStyle = soaked ? "#cfefff" : c.belly;
  ctx.fillRect(x + 4, y + 8 + bob, 8, 5);
  ctx.fillStyle = c.eye;
  ctx.fillRect(x + 4, y + 6 + bob, 2, 2);
  ctx.fillRect(x + 10, y + 6 + bob, 2, 2);
  ctx.fillStyle = "#111";
  ctx.fillRect(x + 5, y + 6 + bob, 1, 1);
  ctx.fillRect(x + 11, y + 6 + bob, 1, 1);
  if (animal === "duck") {
    ctx.fillStyle = "#e67e22";
    ctx.fillRect(x + 6, y + 8 + bob, 4, 2);
  }
  if (animal === "cat") {
    ctx.fillStyle = c.body;
    ctx.fillRect(x + 3, y + 2 + bob, 3, 3);
    ctx.fillRect(x + 10, y + 2 + bob, 3, 3);
  }
  drawHat(ctx, x, y + bob, hat);
}

export function drawHat(ctx: CanvasRenderingContext2D, x: number, y: number, hat: HatId): void {
  if (hat === "none") return;
  if (hat === "bucket") {
    ctx.fillStyle = "#27ae60";
    ctx.fillRect(x + 3, y + 1, 10, 3);
    ctx.fillRect(x + 2, y + 3, 12, 2);
  } else if (hat === "snorkel") {
    ctx.fillStyle = "#2980b9";
    ctx.fillRect(x + 3, y + 6, 10, 2);
    ctx.fillRect(x + 13, y + 2, 2, 6);
  } else if (hat === "crown") {
    ctx.fillStyle = PAL.gold;
    ctx.fillRect(x + 4, y + 1, 8, 3);
    ctx.fillRect(x + 4, y, 2, 2);
    ctx.fillRect(x + 7, y - 1, 2, 2);
    ctx.fillRect(x + 10, y, 2, 2);
  } else if (hat === "bandana") {
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(x + 3, y + 3, 10, 3);
    ctx.fillRect(x + 1, y + 4, 3, 2);
  } else if (hat === "propeller") {
    ctx.fillStyle = "#8e44ad";
    ctx.fillRect(x + 6, y + 1, 4, 3);
    ctx.fillStyle = "#ecf0f1";
    ctx.fillRect(x + 2, y, 12, 2);
  }
}

export function drawBalloon(ctx: CanvasRenderingContext2D, x: number, y: number, fuse: number, wobble: number): void {
  const s = 1 + Math.sin(wobble) * 0.12 + (1 - fuse / 90) * 0.15;
  const w = 10 * s;
  const h = 12 * s;
  ctx.fillStyle = PAL.balloon;
  ctx.fillRect(x + 8 - w / 2, y + 6 - h / 2, w, h);
  ctx.fillStyle = PAL.balloonDark;
  ctx.fillRect(x + 8 - w / 2 + 2, y + 6 - h / 2 + 2, 3, 3);
  ctx.fillStyle = "#5a3a1a";
  ctx.fillRect(x + 7, y + 6 + h / 2, 2, 3);
}

export function drawCastle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = PAL.castle;
  ctx.fillRect(x + 2, y + 6, 12, 10);
  ctx.fillStyle = PAL.castleHi;
  ctx.fillRect(x + 2, y + 4, 3, 4);
  ctx.fillRect(x + 7, y + 3, 3, 5);
  ctx.fillRect(x + 11, y + 4, 3, 4);
}

export function drawBoulder(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = PAL.boulder;
  ctx.fillRect(x + 1, y + 2, 14, 13);
  ctx.fillStyle = PAL.boulderHi;
  ctx.fillRect(x + 3, y + 4, 4, 3);
}

export function drawPowerup(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, t: number): void {
  const bob = Math.sin(t / 8) * 1;
  ctx.fillStyle = PAL.ui;
  ctx.fillRect(x + 3, y + 3 + bob, 10, 10);
  if (kind === "extraBalloon") ctx.fillStyle = PAL.balloon;
  else if (kind === "bigSplash") ctx.fillStyle = PAL.water2;
  else if (kind === "flippers") ctx.fillStyle = "#9b59b6";
  else ctx.fillStyle = "#e67e22";
  ctx.fillRect(x + 5, y + 5 + bob, 6, 6);
}

export function drawDuck(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = "#f4d35e";
  ctx.fillRect(x + 2, y + 8, 12, 6);
  ctx.fillStyle = "#e67e22";
  ctx.fillRect(x + 12, y + 9, 3, 2);
  ctx.fillStyle = "#222";
  ctx.fillRect(x + 5, y + 9, 2, 2);
}
