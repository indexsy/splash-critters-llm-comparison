// sprites.ts — procedural pixel-art sprites (spec §10). All art is embedded pixel
// data: animal bodies, hats, balloons, splashes, tiles, power-up icons. Drawn at
// the internal 256×224 resolution with integer scaling done by the canvas CSS.

import type { Animal, Hat, PowerUpKind, Theme } from "@splash/shared";

const PAL: Record<string, string> = {
  // NES-ish palette
  black: "#1a1c2c", dark: "#29366f", purple: "#4a5294", blue: "#41a6f6",
  lblue: "#73eff7", green: "#38b764", lgreen: "#a7f070", brown: "#73380a",
  tan: "#ffcd75", peach: "#f4f4f4", red: "#b13e53", pink: "#ef7d57",
  orange: "#ffcd75", yellow: "#f4f4f4", grey: "#94b0c2", white: "#f4f4f4",
  sand: "#f0d8a0", sand2: "#e0c080", water: "#41a6f6", water2: "#73eff7",
};

// 8x8 base critter body (a rounded blob); 2-frame walk via leg offset
const BODY: number[] = [
  0,0,1,1,1,1,0,0,
  0,1,1,1,1,1,1,0,
  1,1,1,1,1,1,1,1,
  1,1,2,1,1,2,1,1,
  1,1,1,1,1,1,1,1,
  1,1,1,1,1,1,1,1,
  1,3,1,1,1,1,3,1,
  0,0,1,1,1,1,0,0,
];

const ANIMAL_COLOR: Record<Animal, [string, string, string]> = {
  // [body, eye, accent]
  frog: ["#38b764", "#1a1c2c", "#a7f070"],
  duck: ["#ffcd75", "#1a1c2c", "#ef7d57"],
  otter: ["#73380a", "#1a1c2c", "#f0d8a0"],
  penguin: ["#1a1c2c", "#ffcd75", "#f4f4f4"],
  cat: ["#94b0c2", "#1a1c2c", "#ef7d57"],
  raccoon: ["#4a5294", "#1a1c2c", "#f4f4f4"],
  turtle: ["#38b764", "#1a1c2c", "#73380a"],
  capybara: ["#73380a", "#1a1c2c", "#f0d8a0"],
};

export function drawCritter(
  ctx: CanvasRenderingContext2D,
  px: number, py: number, // pixel coords (already scaled into 256x224 space)
  scale: number,
  animal: Animal,
  hat: Hat,
  frame: number, dir: number,
) {
  const [body, eye, accent] = ANIMAL_COLOR[animal] ?? ANIMAL_COLOR.frog;
  for (let i = 0; i < BODY.length; i++) {
    const v = BODY[i];
    if (v === 0) continue;
    const x = (i % 8) * scale + px;
    const y = Math.floor(i / 8) * scale + py;
    const color = v === 1 ? body : v === 2 ? eye : accent;
    // walk bob: legs (v=3) shift down 1px on frame 1
    if (v === 3 && frame % 2 === 1) ctx.fillStyle = body;
    else ctx.fillStyle = color;
    ctx.fillRect(x, y, scale, scale);
  }
  // facing: flip eye positions for left/right (subtle) — omitted for size
  void dir;
  drawHat(ctx, px, py, scale, hat);
}

function drawHat(ctx: CanvasRenderingContext2D, px: number, py: number, scale: number, hat: Hat) {
  const s = scale;
  switch (hat) {
    case "crown":
      ctx.fillStyle = "#ffcd75";
      ctx.fillRect(px + 2 * s, py - 1 * s, 4 * s, 1 * s);
      ctx.fillRect(px + 2 * s, py - 2 * s, 1 * s, 1 * s);
      ctx.fillRect(px + 4 * s, py - 2 * s, 1 * s, 1 * s);
      break;
    case "bucket":
      ctx.fillStyle = "#ef7d57";
      ctx.fillRect(px + 1 * s, py - 1 * s, 6 * s, 2 * s);
      break;
    case "snorkel":
      ctx.fillStyle = "#41a6f6";
      ctx.fillRect(px + 5 * s, py - 2 * s, 1 * s, 2 * s);
      break;
    case "bandana":
      ctx.fillStyle = "#b13e53";
      ctx.fillRect(px + 1 * s, py + 0, 6 * s, 1 * s);
      break;
    case "propeller":
      ctx.fillStyle = "#ef7d57";
      ctx.fillRect(px + 2 * s, py - 1 * s, 4 * s, 1 * s);
      ctx.fillStyle = "#1a1c2c";
      ctx.fillRect(px + 3 * s, py - 2 * s, 2 * s, 1 * s);
      break;
    case "none":
    default:
      break;
  }
}

export function drawBalloon(ctx: CanvasRenderingContext2D, px: number, py: number, scale: number, wobble: number) {
  const s = scale;
  ctx.fillStyle = "#41a6f6";
  // 6x6 balloon with wobble offset
  const off = Math.sin(wobble) * 0.5 * s;
  ctx.fillRect(px + 1 * s + off, py + 0, 6 * s, 6 * s);
  ctx.fillStyle = "#73eff7";
  ctx.fillRect(px + 2 * s + off, py + 1 * s, 1 * s, 1 * s);
  ctx.fillStyle = "#1a1c2c";
  ctx.fillRect(px + 3 * s + off, py + 6 * s, 2 * s, 1 * s);
}

export function drawSplash(ctx: CanvasRenderingContext2D, sx: number, sy: number, s: number, color = "#73eff7") {
  ctx.fillStyle = color;
  ctx.fillRect(sx, sy, s, s);
}

export function drawPowerUp(ctx: CanvasRenderingContext2D, px: number, py: number, scale: number, kind: PowerUpKind) {
  const s = scale;
  // background
  ctx.fillStyle = "#1a1c2c";
  ctx.fillRect(px, py, 8 * s, 8 * s);
  ctx.fillStyle = "#ffcd75";
  ctx.fillRect(px + 1 * s, py + 1 * s, 6 * s, 6 * s);
  ctx.fillStyle = "#1a1c2c";
  switch (kind) {
    case "extraBalloon":
      ctx.fillRect(px + 3 * s, py + 2 * s, 2 * s, 3 * s);
      break;
    case "bigSplash":
      ctx.fillRect(px + 2 * s, py + 4 * s, 4 * s, 1 * s);
      ctx.fillRect(px + 3 * s, py + 3 * s, 2 * s, 1 * s);
      break;
    case "flippers":
      ctx.fillRect(px + 2 * s, py + 4 * s, 4 * s, 1 * s);
      ctx.fillRect(px + 2 * s, py + 3 * s, 1 * s, 1 * s);
      ctx.fillRect(px + 5 * s, py + 3 * s, 1 * s, 1 * s);
      break;
    case "rubberBoots":
      ctx.fillRect(px + 2 * s, py + 2 * s, 4 * s, 2 * s);
      ctx.fillRect(px + 2 * s, py + 4 * s, 2 * s, 2 * s);
      break;
  }
}

export function tileColors(theme: Theme): { floor: string; floor2: string; boulder: string; boulder2: string } {
  switch (theme) {
    case "beach":
      return { floor: "#f0d8a0", floor2: "#e0c080", boulder: "#94b0c2", boulder2: "#566c86" };
    case "pool":
      return { floor: "#73eff7", floor2: "#41a6f6", boulder: "#f4f4f4", boulder2: "#94b0c2" };
    case "backyard":
    default:
      return { floor: "#38b764", floor2: "#257179", boulder: "#73380a", boulder2: "#4a3310" };
  }
}

export function drawCastle(ctx: CanvasRenderingContext2D, px: number, py: number, scale: number) {
  const s = scale;
  ctx.fillStyle = PAL.sand;
  ctx.fillRect(px + 0, py + 1 * s, 8 * s, 7 * s);
  ctx.fillStyle = PAL.sand2;
  // crenellations
  ctx.fillRect(px + 0, py + 0, 2 * s, 1 * s);
  ctx.fillRect(px + 3 * s, py + 0, 2 * s, 1 * s);
  ctx.fillRect(px + 6 * s, py + 0, 2 * s, 1 * s);
  // door
  ctx.fillStyle = PAL.brown;
  ctx.fillRect(px + 3 * s, py + 5 * s, 2 * s, 3 * s);
}

export function drawBoulder(ctx: CanvasRenderingContext2D, px: number, py: number, scale: number, c1: string, c2: string) {
  const s = scale;
  ctx.fillStyle = c1;
  ctx.fillRect(px, py, 8 * s, 8 * s);
  ctx.fillStyle = c2;
  ctx.fillRect(px + 1 * s, py + 1 * s, 2 * s, 2 * s);
  ctx.fillRect(px + 5 * s, py + 5 * s, 2 * s, 2 * s);
}

export function drawWater(ctx: CanvasRenderingContext2D, px: number, py: number, scale: number, t: number) {
  const s = scale;
  ctx.fillStyle = PAL.water;
  ctx.fillRect(px, py, 8 * s, 8 * s);
  ctx.fillStyle = PAL.water2;
  const off = (Math.floor(t / 10) % 2) * s;
  ctx.fillRect(px + 1 * s + off, py + 2 * s, 2 * s, s);
  ctx.fillRect(px + 5 * s - off, py + 5 * s, 2 * s, s);
}
