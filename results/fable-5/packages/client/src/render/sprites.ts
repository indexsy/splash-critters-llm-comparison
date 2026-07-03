// Every sprite is generated at runtime from rect ops — no image assets.
// Sprites are cached on offscreen canvases keyed by their parameters.

import type { MapTheme } from "@splash/shared";
import { PAL } from "./palette.js";

type Ctx = CanvasRenderingContext2D;

const cache = new Map<string, HTMLCanvasElement>();

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  return { c, g };
}

function px(g: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

// ---------- Critters ----------

interface AnimalSpec {
  body: string;
  belly: string;
  drawExtras: (g: Ctx, frame: number) => void;
}

const ANIMAL_SPECS: Record<string, AnimalSpec> = {
  frog: {
    body: PAL.frog,
    belly: PAL.frogDark,
    drawExtras: (g) => {
      // eye bumps on top
      px(g, 3, 1, 3, 3, PAL.frog);
      px(g, 10, 1, 3, 3, PAL.frog);
    },
  },
  duck: {
    body: PAL.duck,
    belly: PAL.sandLight,
    drawExtras: (g) => {
      px(g, 6, 8, 4, 2, PAL.duckBill); // bill
      px(g, 2, 3, 2, 2, PAL.duck); // head tuft
    },
  },
  otter: {
    body: PAL.otter,
    belly: PAL.otterBelly,
    drawExtras: (g) => {
      px(g, 3, 2, 2, 2, PAL.otter); // ears
      px(g, 11, 2, 2, 2, PAL.otter);
      px(g, 6, 9, 4, 2, PAL.otterBelly); // muzzle
    },
  },
  penguin: {
    body: PAL.penguin,
    belly: PAL.penguinBelly,
    drawExtras: (g) => {
      px(g, 7, 8, 2, 2, PAL.duckBill); // beak
    },
  },
  cat: {
    body: PAL.cat,
    belly: PAL.catDark,
    drawExtras: (g) => {
      px(g, 3, 0, 2, 3, PAL.cat); // ears
      px(g, 11, 0, 2, 3, PAL.cat);
      px(g, 4, 1, 1, 1, PAL.pink);
      px(g, 11, 1, 1, 1, PAL.pink);
    },
  },
  raccoon: {
    body: PAL.raccoon,
    belly: PAL.gray,
    drawExtras: (g) => {
      px(g, 3, 1, 2, 2, PAL.raccoon); // ears
      px(g, 11, 1, 2, 2, PAL.raccoon);
      px(g, 3, 5, 10, 2, PAL.raccoonMask); // mask (eyes drawn over it)
    },
  },
  turtle: {
    body: PAL.turtle,
    belly: PAL.sandLight,
    drawExtras: (g) => {
      px(g, 3, 2, 10, 5, PAL.turtleShell); // shell dome
      px(g, 4, 3, 8, 3, PAL.turtle);
    },
  },
  capybara: {
    body: PAL.capybara,
    belly: PAL.capyDark,
    drawExtras: (g) => {
      px(g, 3, 1, 2, 2, PAL.capyDark); // small ears
      px(g, 11, 1, 2, 2, PAL.capyDark);
      px(g, 5, 9, 6, 2, PAL.capyDark); // big snout
    },
  },
};

function drawHat(g: Ctx, hat: string, frame: number): void {
  switch (hat) {
    case "bucket":
      px(g, 4, 0, 8, 2, PAL.water);
      px(g, 3, 2, 10, 1, PAL.waterDeep);
      break;
    case "snorkel":
      px(g, 3, 4, 10, 2, "#54d7e8"); // mask band
      px(g, 12, 0, 2, 5, PAL.red); // tube
      px(g, 11, 0, 3, 1, PAL.red);
      break;
    case "crown":
      px(g, 5, 0, 6, 2, PAL.gold);
      px(g, 5, -0, 1, 1, PAL.gold);
      px(g, 7, 0, 1, 2, PAL.gold);
      px(g, 10, 0, 1, 1, PAL.gold);
      break;
    case "bandana":
      px(g, 3, 1, 10, 2, PAL.red);
      px(g, 12, 2, 2, 3, PAL.red); // knot tail
      break;
    case "propeller": {
      px(g, 6, 1, 4, 2, PAL.red); // cap
      const spin = frame % 2 === 0;
      px(g, spin ? 3 : 6, 0, spin ? 10 : 4, 1, PAL.gray); // blades
      px(g, 7, -0, 2, 1, PAL.gold);
      break;
    }
  }
}

/** 16x16 critter, 2-frame walk, facing dir (pupils + feet shift). */
export function critterSprite(animal: string, hat: string, frame: number, dir: number): HTMLCanvasElement {
  const key = `cr:${animal}:${hat}:${frame}:${dir}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, g } = makeCanvas(16, 16);
  const spec = ANIMAL_SPECS[animal] ?? ANIMAL_SPECS.frog;

  // feet (walk cycle)
  const spread = frame % 2 === 0 ? 0 : 1;
  px(g, 4 - spread, 13, 3, 2, spec.belly);
  px(g, 9 + spread, 13, 3, 2, spec.belly);

  // body blob
  px(g, 3, 4, 10, 9, spec.body);
  px(g, 2, 6, 12, 5, spec.body);
  px(g, 4, 3, 8, 2, spec.body);
  // belly patch
  px(g, 5, 8, 6, 4, spec.belly);

  spec.drawExtras(g, frame);

  // eyes with directional pupils
  const ex = dir === 4 ? -1 : dir === 2 ? 1 : 0;
  const ey = dir === 1 ? -1 : dir === 3 ? 1 : 0;
  px(g, 4, 5, 3, 3, PAL.white);
  px(g, 9, 5, 3, 3, PAL.white);
  px(g, 5 + ex, 6 + ey, 1, 1, PAL.black);
  px(g, 10 + ex, 6 + ey, 1, 1, PAL.black);

  drawHat(g, hat, frame);
  cache.set(key, c);
  return c;
}

/** Flattened, dripping version for the soak animation. */
export function soakedSprite(animal: string, hat: string): HTMLCanvasElement {
  const key = `soaked:${animal}:${hat}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, g } = makeCanvas(16, 16);
  const base = critterSprite(animal, hat, 0, 3);
  g.drawImage(base, 0, 4, 16, 12); // squashed
  g.globalAlpha = 0.45;
  px(g, 2, 6, 12, 10, PAL.water);
  g.globalAlpha = 1;
  px(g, 3, 14, 2, 2, PAL.waterLight);
  px(g, 11, 13, 2, 2, PAL.waterLight);
  cache.set(key, c);
  return c;
}

// ---------- Tiles ----------

export interface ThemeTiles {
  floor: HTMLCanvasElement;
  boulder: HTMLCanvasElement;
  castle: HTMLCanvasElement;
}

const themeCache = new Map<MapTheme, ThemeTiles>();

export function themeTiles(theme: MapTheme): ThemeTiles {
  return buildTheme(theme);
}

function buildTheme(theme: MapTheme): ThemeTiles {
  const cached = themeCache.get(theme);
  if (cached) return cached;

  const floor = makeCanvas(16, 16);
  const boulder = makeCanvas(16, 16);
  const castle = makeCanvas(16, 16);

  if (theme === "backyard") {
    px(floor.g, 0, 0, 16, 16, PAL.grass);
    px(floor.g, 2, 3, 1, 2, PAL.grassDark);
    px(floor.g, 9, 7, 1, 2, PAL.grassDark);
    px(floor.g, 13, 12, 1, 2, PAL.grassDark);
    px(floor.g, 5, 12, 1, 2, PAL.grassDark);
    // fence post boulder
    px(boulder.g, 0, 0, 16, 16, PAL.grassDark);
    px(boulder.g, 2, 1, 12, 14, PAL.fence);
    px(boulder.g, 2, 1, 12, 2, "#c98d52");
    px(boulder.g, 4, 4, 2, 10, "#7a4a24");
    px(boulder.g, 10, 4, 2, 10, "#7a4a24");
  } else if (theme === "beach") {
    px(floor.g, 0, 0, 16, 16, PAL.sand);
    px(floor.g, 3, 4, 2, 1, PAL.sandLight);
    px(floor.g, 11, 9, 2, 1, PAL.sandLight);
    px(floor.g, 6, 13, 2, 1, PAL.sandDark);
    px(floor.g, 12, 2, 1, 1, PAL.pink); // tiny shell
    // rock boulder
    px(boulder.g, 0, 0, 16, 16, PAL.sand);
    px(boulder.g, 2, 3, 12, 11, PAL.rock);
    px(boulder.g, 3, 2, 10, 2, PAL.rock);
    px(boulder.g, 4, 4, 4, 3, "#9d9dae");
    px(boulder.g, 3, 12, 11, 2, PAL.rockDark);
  } else {
    // pool
    px(floor.g, 0, 0, 16, 16, PAL.poolTile);
    px(floor.g, 0, 0, 16, 1, PAL.poolTileDark);
    px(floor.g, 0, 0, 1, 16, PAL.poolTileDark);
    px(floor.g, 8, 0, 1, 16, PAL.poolTileDark);
    px(floor.g, 0, 8, 16, 1, PAL.poolTileDark);
    // stacked floaty ring boulder
    px(boulder.g, 0, 0, 16, 16, PAL.poolTileDark);
    px(boulder.g, 2, 2, 12, 12, PAL.red);
    px(boulder.g, 5, 5, 6, 6, PAL.poolTileDark);
    px(boulder.g, 2, 2, 4, 4, PAL.white);
    px(boulder.g, 10, 10, 4, 4, PAL.white);
  }

  // sandcastle is a sandcastle everywhere (that's the game!)
  const cg = castle.g;
  cg.drawImage(floor.c, 0, 0);
  px(cg, 2, 6, 12, 9, PAL.sand);
  px(cg, 2, 6, 12, 1, PAL.sandLight);
  px(cg, 1, 14, 14, 1, PAL.sandDark);
  px(cg, 3, 2, 3, 5, PAL.sand); // left turret
  px(cg, 10, 2, 3, 5, PAL.sand); // right turret
  px(cg, 3, 2, 1, 1, PAL.sandLight);
  px(cg, 5, 2, 1, 1, PAL.sandLight);
  px(cg, 10, 2, 1, 1, PAL.sandLight);
  px(cg, 12, 2, 1, 1, PAL.sandLight);
  px(cg, 7, 4, 2, 3, PAL.sandDark); // gate
  px(cg, 6, 9, 4, 5, PAL.sandDark); // door
  px(cg, 4, 0, 1, 3, PAL.red); // flag pole + flag
  px(cg, 5, 0, 2, 1, PAL.red);

  const tiles = { floor: floor.c, boulder: boulder.c, castle: castle.c };
  themeCache.set(theme, tiles);
  return tiles;
}

// ---------- Balloons, power-ups, ducks ----------

export function drawBalloon(g: Ctx, cx: number, cy: number, fuseFrac: number, revenge: boolean, t: number): void {
  // wobble faster as the fuse runs out; inflate slightly
  const urgency = 1 - Math.max(0, Math.min(1, fuseFrac));
  const wob = Math.sin(t * (6 + urgency * 18)) * (0.5 + urgency * 1.2);
  const grow = 1 + urgency * 0.25;
  const w = Math.round(10 * grow + wob);
  const h = Math.round(11 * grow - wob);
  const x = Math.round(cx - w / 2);
  const y = Math.round(cy - h / 2);
  const body = revenge ? PAL.gold : PAL.water;
  const dark = revenge ? "#c9992a" : PAL.waterDeep;
  px(g, x + 1, y, w - 2, h, body);
  px(g, x, y + 1, w, h - 2, body);
  px(g, x + 2, y + 1, 2, 3, PAL.waterLight); // shine
  px(g, x + 1, y + h - 2, w - 2, 2, dark);
  px(g, x + Math.floor(w / 2) - 1, y + h, 2, 1, dark); // knot
  if (urgency > 0.72 && Math.floor(t * 10) % 2 === 0) {
    px(g, x + 1, y + 1, w - 2, h - 2, "rgba(255,255,255,0.35)"); // about to pop!
  }
}

export function drawPowerup(g: Ctx, x: number, y: number, type: string, t: number): void {
  const bob = Math.round(Math.sin(t * 4) * 1);
  const bx = x + 2;
  const by = y + 2 + bob;
  px(g, bx, by, 12, 12, PAL.black);
  px(g, bx + 1, by + 1, 10, 10, PAL.uiPanel);
  switch (type) {
    case "extra_balloon":
      px(g, bx + 4, by + 2, 4, 5, PAL.water);
      px(g, bx + 3, by + 3, 6, 3, PAL.water);
      px(g, bx + 5, by + 8, 2, 1, PAL.waterDeep);
      px(g, bx + 8, by + 2, 1, 3, PAL.white); // +
      px(g, bx + 7, by + 3, 3, 1, PAL.white);
      break;
    case "big_splash":
      px(g, bx + 5, by + 2, 2, 2, PAL.waterLight);
      px(g, bx + 4, by + 4, 4, 4, PAL.water);
      px(g, bx + 3, by + 5, 6, 2, PAL.water);
      px(g, bx + 2, by + 8, 2, 2, PAL.waterLight);
      px(g, bx + 8, by + 8, 2, 2, PAL.waterLight);
      break;
    case "flippers":
      px(g, bx + 2, by + 3, 4, 6, PAL.frog);
      px(g, bx + 6, by + 4, 4, 2, PAL.frog);
      px(g, bx + 6, by + 7, 4, 2, PAL.frog);
      break;
    case "rubber_boots":
      px(g, bx + 3, by + 2, 3, 6, PAL.red);
      px(g, bx + 3, by + 8, 6, 2, PAL.red);
      px(g, bx + 7, by + 8, 2, 2, "#a82f2f");
      break;
  }
}

export function drawRubberDuck(g: Ctx, cx: number, cy: number, t: number): void {
  const bob = Math.round(Math.sin(t * 3) * 1);
  const x = Math.round(cx - 7);
  const y = Math.round(cy - 5) + bob;
  px(g, x + 2, y + 4, 11, 5, PAL.duck); // body
  px(g, x + 1, y + 5, 13, 3, PAL.duck);
  px(g, x + 9, y + 0, 5, 5, PAL.duck); // head
  px(g, x + 13, y + 2, 2, 2, PAL.duckBill);
  px(g, x + 11, y + 1, 1, 1, PAL.black);
  px(g, x + 3, y + 5, 4, 2, PAL.sandLight); // wing
  // little water line
  px(g, x, y + 9, 15, 1, PAL.waterLight);
}

/** Rank tier badge, 10x10. */
export function drawTierBadge(g: Ctx, x: number, y: number, tier: string): void {
  const colors: Record<string, string> = {
    Puddle: PAL.gray,
    Pond: PAL.frog,
    River: PAL.waterLight,
    Lake: PAL.water,
    Ocean: PAL.waterDeep,
    Tsunami: PAL.gold,
  };
  const c = colors[tier] ?? PAL.gray;
  px(g, x + 2, y, 6, 10, c);
  px(g, x, y + 2, 10, 6, c);
  px(g, x + 3, y + 2, 2, 2, PAL.white);
  if (tier === "Tsunami") {
    px(g, x + 2, y + 6, 6, 2, PAL.waterDeep);
    px(g, x + 2, y + 4, 2, 2, PAL.waterDeep);
  }
}
