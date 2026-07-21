import type { Animal, Balloon, ExposedPowerup, Hat, SimPlayer, Splash, Theme, Tile } from "@splash/shared";

export const STAGE_W = 256;
export const STAGE_H = 224;
export const HUD_H = 24;

export interface Palette {
  skyTop: string;
  skyBot: string;
  floor: string;
  floorAlt: string;
  floorLine: string;
  wall: string;
  wallTop: string;
  wallShadow: string;
  castle: string;
  castleTop: string;
  castleFlag: string;
  water: string;
  waterFoam: string;
  decor: string;
  decorAlt: string;
  name: string;
}

const BACKYARD: Palette = {
  skyTop: "#7ec366", skyBot: "#a8e08a",
  floor: "#6fb84e", floorAlt: "#5da040", floorLine: "#4e8a35",
  wall: "#8a6a3a", wallTop: "#a98446", wallShadow: "#5a4524",
  castle: "#c9a06a", castleTop: "#e6c08a", castleFlag: "#ff6b6b",
  water: "#5dc2ff", waterFoam: "#e8fbff",
  decor: "#ffd83d", decorAlt: "#ff6b6b",
  name: "BACKYARD"
};

const BEACH: Palette = {
  skyTop: "#ffd86b", skyBot: "#ffea9e",
  floor: "#f1d089", floorAlt: "#e3bd72", floorLine: "#cda35b",
  wall: "#7e5a34", wallTop: "#9b7346", wallShadow: "#4d3a1e",
  castle: "#d8a86a", castleTop: "#f3cb8c", castleFlag: "#ff4fa3",
  water: "#33b6ff", waterFoam: "#f4fbff",
  decor: "#ff6b6b", decorAlt: "#ffd83d",
  name: "BEACH"
};

const POOL: Palette = {
  skyTop: "#3aa6ff", skyBot: "#7fd6ff",
  floor: "#bfe6ff", floorAlt: "#a9d8ff", floorLine: "#8fc4f0",
  wall: "#2a5a99", wallTop: "#3f7bc4", wallShadow: "#16335c",
  castle: "#5a4a8a", castleTop: "#8a73c6", castleFlag: "#ffd83d",
  water: "#1f86e0", waterFoam: "#e8fbff",
  decor: "#ffd83d", decorAlt: "#ff4fa3",
  name: "POOL"
};

const PALETTES: Record<Theme, Palette> = {
  backyard: BACKYARD,
  beach: BEACH,
  pool: POOL
};

export function paletteFor(theme: Theme): Palette {
  return PALETTES[theme] ?? BACKYARD;
}

const ANIMAL_COLORS: Record<Animal, { body: string; belly: string; accent: string; eye: string }> = {
  frog:     { body: "#6cc04a", belly: "#cdea9c", accent: "#3a8a26", eye: "#0a1a06" },
  duck:     { body: "#ffd83d", belly: "#fff2a8", accent: "#e09a1a", eye: "#1a0a06" },
  otter:    { body: "#9b6b3a", belly: "#e3cda0", accent: "#5a3a1c", eye: "#0a0a06" },
  penguin:  { body: "#2b3b54", belly: "#f4faff", accent: "#ffd83d", eye: "#0a0a06" },
  cat:      { body: "#a6a6a6", belly: "#e6e6e6", accent: "#5a5a5a", eye: "#1a6b3a" },
  raccoon:  { body: "#7c7c8c", belly: "#dcdce6", accent: "#2a2a36", eye: "#0a0a06" },
  turtle:   { body: "#3a8a4a", belly: "#9cd07c", accent: "#1c4a26", eye: "#0a1a06" },
  capybara: { body: "#a86a3a", belly: "#e6c08a", accent: "#5a341a", eye: "#1a0a06" }
};

export interface AnimalColors { body: string; belly: string; accent: string; eye: string }

export function animalColors(a: Animal): AnimalColors {
  return ANIMAL_COLORS[a] ?? ANIMAL_COLORS.frog!;
}

export const BALLOON_COLORS = ["#ff4fa3", "#ffd83d", "#66e08f", "#7ee4ff", "#8a5cf6", "#ff6b6b"];

export function balloonColor(id: number): string {
  return BALLOON_COLORS[id % BALLOON_COLORS.length]!;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

export function drawTileFloor(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: Palette, alt: boolean): void {
  px(ctx, x, y, s, s, alt ? pal.floorAlt : pal.floor);
  px(ctx, x, y, s, 1, pal.floorLine);
  px(ctx, x, y, 1, s, pal.floorLine);
}

export function drawTileWall(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: Palette): void {
  px(ctx, x, y, s, s, pal.wall);
  px(ctx, x, y, s, 2, pal.wallTop);
  px(ctx, x + 1, y + s - 2, s - 2, 2, pal.wallShadow);
  px(ctx, x, y, 1, s, pal.wallShadow);
}

export function drawTileCastle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: Palette, t: number): void {
  const bob = Math.floor(Math.sin(t * 0.004 + x * 0.3 + y * 0.2) * 0.5);
  px(ctx, x + 1, y + 1 + bob, s - 2, s - 2, pal.castle);
  px(ctx, x + 1, y + 1 + bob, s - 2, 2, pal.castleTop);
  px(ctx, x + 2, y + s - 3 + bob, s - 4, 2, pal.wallShadow);
  px(ctx, x + 1, y + 1 + bob, 2, s - 2, pal.castleTop);
  const fy = y - 2 + bob;
  px(ctx, x + Math.floor(s / 2), fy, 1, 3, "#5a3a1c");
  px(ctx, x + Math.floor(s / 2) + 1, fy, 2, 2, pal.castleFlag);
  if (Math.floor(t / 200) % 2 === 0) {
    px(ctx, x + Math.floor(s / 2) - 1, fy, 2, 2, pal.castleFlag);
  }
}

export function drawTileWater(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: Palette, t: number): void {
  px(ctx, x, y, s, s, pal.water);
  const off = Math.floor(Math.sin(t * 0.005 + x * 0.4 + y * 0.6) * 2);
  px(ctx, x + 1 + off, y + 2, Math.max(1, Math.floor(s / 3)), 1, pal.waterFoam);
  px(ctx, x + Math.floor(s / 2), y + s - 3 - off, Math.max(1, Math.floor(s / 4)), 1, pal.waterFoam);
}

export function drawBalloon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, fuse: number, t: number): void {
  const blink = fuse < 30 ? (Math.floor(t / 80) % 2 === 0) : false;
  const fill = blink ? "#fff" : color;
  const r = size / 2;
  px(ctx, cx - r, cy - r, size, size, fill);
  px(ctx, cx - r, cy - r, size, 2, "rgba(255,255,255,0.5)");
  px(ctx, cx - r, cy - r, 1, size, "rgba(255,255,255,0.35)");
  px(ctx, cx + r - 1, cy + 1, 1, size - 2, "rgba(0,0,0,0.25)");
  px(ctx, cx + 1, cy + r - 1, size - 2, 1, "rgba(0,0,0,0.25)");
  px(ctx, cx - 1, cy - r + 1, 2, 2, "rgba(255,255,255,0.85)");
  px(ctx, cx - 1, cy + r, 2, 1, "#5a3a1c");
  px(ctx, cx, cy + r + 1, 1, 2, "#5a3a1c");
}

export function drawSplash(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, chain: number): void {
  const phase = (t / 60) % 1;
  const expand = Math.floor(phase * (s / 3));
  const alpha = 1 - phase;
  ctx.save();
  ctx.globalAlpha = alpha;
  const c = chain > 1 ? "#fff" : "#7ee4ff";
  px(ctx, x + 1, y + 1, s - 2, s - 2, c);
  px(ctx, x - expand, y + Math.floor(s / 2), expand, 2, c);
  px(ctx, x + s, y + Math.floor(s / 2), expand, 2, c);
  px(ctx, x + Math.floor(s / 2), y - expand, 2, expand, c);
  px(ctx, x + Math.floor(s / 2), y + s, 2, expand, c);
  ctx.restore();
}

const POWERUP_COLORS: Record<string, { a: string; b: string }> = {
  balloon: { a: "#ff4fa3", b: "#ffd83d" },
  range:   { a: "#ff6b6b", b: "#ffd83d" },
  flippers:{ a: "#66e08f", b: "#7ee4ff" },
  boots:   { a: "#8a5cf6", b: "#ffd83d" }
};

export function drawPowerup(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, kind: ExposedPowerup["kind"], t: number): void {
  const c = POWERUP_COLORS[kind] ?? POWERUP_COLORS.balloon!;
  const bob = Math.floor(Math.sin(t * 0.008) * 1);
  const cx = x + Math.floor(s / 2);
  const cy = y + Math.floor(s / 2) + bob;
  px(ctx, cx - 4, cy - 4, 8, 8, c.a);
  px(ctx, cx - 4, cy - 4, 8, 2, "rgba(255,255,255,0.55)");
  px(ctx, cx - 2, cy - 2, 4, 4, c.b);
  if (kind === "balloon") {
    px(ctx, cx - 1, cy - 1, 2, 2, "#fff");
  } else if (kind === "range") {
    px(ctx, cx - 2, cy, 4, 1, "#5a3a1c");
  } else if (kind === "flippers") {
    px(ctx, cx - 1, cy - 2, 1, 4, "#1c4a26");
    px(ctx, cx, cy - 2, 1, 4, "#1c4a26");
  } else {
    px(ctx, cx - 2, cy, 1, 1, "#5a3a1c");
    px(ctx, cx + 1, cy, 1, 1, "#5a3a1c");
  }
}

export function drawAnimal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  animal: Animal,
  hat: Hat,
  facing: string,
  moving: boolean,
  t: number,
  alive: boolean
): void {
  const c = animalColors(animal);
  const bob = moving ? Math.floor(Math.abs(Math.sin(t * 0.02)) * 1.5) : 0;
  const baseY = cy + bob;
  if (!alive) {
    drawAngel(ctx, cx, cy);
    return;
  }
  px(ctx, cx - 1, baseY + Math.floor(size / 2) - 1, 2, 1, c.accent);
  const bodyTop = baseY - Math.floor(size / 2) + 2;
  const bodyH = size - 3;
  px(ctx, cx - Math.floor(size / 2) + 1, bodyTop, size - 2, bodyH, c.body);
  px(ctx, cx - Math.floor(size / 2) + 1, baseY - 1, size - 2, 3, c.belly);
  px(ctx, cx - Math.floor(size / 2) + 1, bodyTop, size - 2, 2, c.accent);
  const eyesY = bodyTop + 2;
  const eyeOff = facing === "left" ? -1 : facing === "right" ? 1 : 0;
  px(ctx, cx - 2 + eyeOff, eyesY, 1, 2, c.eye);
  px(ctx, cx + 1 + eyeOff, eyesY, 1, 2, c.eye);
  if (animal === "duck" || animal === "penguin" || animal === "turtle") {
    px(ctx, cx - 1, eyesY + 2, 3, 1, c.accent);
  }
  if (animal === "frog") {
    px(ctx, cx - 3, bodyTop - 1, 2, 1, c.body);
    px(ctx, cx + 1, bodyTop - 1, 2, 1, c.body);
  }
  drawHat(ctx, cx, baseY - Math.floor(size / 2) + 1, hat, c, t);
}

function drawAngel(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  px(ctx, cx - 5, cy - 4, 10, 1, "rgba(255,255,255,0.8)");
  px(ctx, cx - 3, cy - 3, 6, 1, "rgba(255,255,255,0.6)");
  px(ctx, cx - 2, cy - 1, 4, 4, "#cccccc");
  px(ctx, cx - 1, cy, 2, 2, "#9a9a9a");
}

function drawHat(ctx: CanvasRenderingContext2D, cx: number, topY: number, hat: Hat, c: AnimalColors, t: number): void {
  switch (hat) {
    case "none":
      return;
    case "bucket":
      px(ctx, cx - 3, topY - 3, 7, 4, "#ff4fa3");
      px(ctx, cx - 3, topY - 3, 7, 1, "#ffd83d");
      px(ctx, cx - 4, topY + 1, 9, 1, "#ff4fa3");
      break;
    case "snorkel":
      px(ctx, cx + 2, topY - 4, 1, 5, "#66e08f");
      px(ctx, cx - 2, topY - 2, 4, 2, "#7ee4ff");
      px(ctx, cx + 2, topY - 4, 2, 1, "#7ee4ff");
      break;
    case "crown":
      px(ctx, cx - 4, topY - 3, 8, 2, "#ffd83d");
      px(ctx, cx - 4, topY - 5, 2, 2, "#ffd83d");
      px(ctx, cx, topY - 5, 2, 2, "#ffd83d");
      px(ctx, cx + 2, topY - 5, 2, 2, "#ffd83d");
      px(ctx, cx - 1, topY - 4, 1, 1, "#ff4fa3");
      break;
    case "bandana":
      px(ctx, cx - 4, topY - 2, 8, 2, "#ff6b6b");
      px(ctx, cx - 5, topY - 1, 1, 2, "#ff6b6b");
      px(ctx, cx - 3, topY - 1, 1, 1, "#fff");
      px(ctx, cx + 1, topY - 1, 1, 1, "#fff");
      break;
    case "propeller": {
      const spin = Math.floor(t * 0.03) % 2;
      px(ctx, cx - 3, topY - 3, 6, 2, "#ff4fa3");
      px(ctx, cx - 1, topY - 4, 2, 1, "#5a3a1c");
      if (spin === 0) px(ctx, cx - 5, topY - 5, 10, 1, "#7ee4ff");
      else { px(ctx, cx - 1, topY - 6, 2, 2, "#7ee4ff"); }
      break;
    }
    default:
      break;
  }
  void c;
}

export interface TinySpriteOpts { animal: Animal; hat: Hat; }

export function drawAnimalTiny(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, opts: TinySpriteOpts, t = 0): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  drawAnimal(ctx, 0, 0, 12, opts.animal, opts.hat, "down", false, t, true);
  ctx.restore();
}

export function renderArena(
  ctx: CanvasRenderingContext2D,
  tiles: Tile[][],
  width: number,
  height: number,
  tile: number,
  offX: number,
  offY: number,
  pal: Palette,
  tideRing: number,
  t: number
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = tiles[y]?.[x] ?? 1;
      const px0 = offX + x * tile;
      const py0 = offY + y * tile;
      const flooded = tideRing > 0 && (x < tideRing || y < tideRing || x >= width - tideRing || y >= height - tideRing);
      if (cell === 1) {
        drawTileWall(ctx, px0, py0, tile, pal);
      } else if (cell === 2) {
        drawTileFloor(ctx, px0, py0, tile, pal, (x + y) % 2 === 0);
        drawTileCastle(ctx, px0, py0, tile, pal, t);
      } else if (flooded) {
        drawTileWater(ctx, px0, py0, tile, pal, t);
      } else {
        drawTileFloor(ctx, px0, py0, tile, pal, (x + y) % 2 === 0);
      }
    }
  }
}

export function renderBalloons(ctx: CanvasRenderingContext2D, balloons: Balloon[], tile: number, offX: number, offY: number, t: number, tick: number): void {
  for (const b of balloons) {
    const fuseLeft = b.burstAt - tick;
    const px0 = offX + b.x * tile + Math.floor(tile / 2);
    const py0 = offY + b.y * tile + Math.floor(tile / 2);
    drawBalloon(ctx, px0 - Math.floor(tile / 2), py0 - Math.floor(tile / 2), tile, balloonColor(b.id), fuseLeft, t);
  }
}

export function renderSplashes(ctx: CanvasRenderingContext2D, splashes: Splash[], tile: number, offX: number, offY: number, tick: number, t: number): void {
  for (const sp of splashes) {
    const fuse = sp.expiresAt - tick;
    const adj = fuse * 30;
    drawSplash(ctx, offX + sp.x * tile, offY + sp.y * tile, tile, adj + t * 0.05, sp.chain);
  }
}

export function renderPowerups(ctx: CanvasRenderingContext2D, powerups: ExposedPowerup[], tile: number, offX: number, offY: number, t: number): void {
  for (const p of powerups) {
    drawPowerup(ctx, offX + p.x * tile, offY + p.y * tile, tile, p.kind, t);
  }
}

export function renderPlayers(
  ctx: CanvasRenderingContext2D,
  players: SimPlayer[],
  tile: number,
  offX: number,
  offY: number,
  t: number,
  localId: string | null,
  revengeTick: number,
  currentTick: number
): void {
  for (const p of players) {
    if (!p.alive) {
      drawAngel(ctx, offX + Math.floor(p.x * tile), offY + Math.floor(p.y * tile));
      continue;
    }
    const size = Math.max(8, tile - 2);
    drawAnimal(ctx, offX + Math.floor(p.x * tile), offY + Math.floor(p.y * tile), size, p.animal, p.hat, p.facing, p.moving, t, p.alive);
    if (localId && p.id === localId) {
      ctx.save();
      ctx.strokeStyle = "#ffd83d";
      ctx.lineWidth = 1;
      const px0 = offX + Math.floor(p.x * tile) - Math.floor(size / 2);
      const py0 = offY + Math.floor(p.y * tile) - Math.floor(size / 2) - 1;
      ctx.strokeRect(px0 - 1, py0 - 1, size + 2, size + 2);
      ctx.restore();
    }
    if (!p.alive && currentTick < p.revengeReadyAt) {
      const cd = p.revengeReadyAt - currentTick;
      px(ctx, offX + Math.floor(p.x * tile) - 2, offY + Math.floor(p.y * tile) + Math.floor(tile / 2) + 2, Math.max(1, Math.floor(tile / 3)), 1, "#ff5d5d");
      void cd;
    }
  }
  void revengeTick;
}
