// Dev-only visual QA page (sprites.html, never built into the app): renders every sprite,
// frame, theme, icon and font glyph on labelled boards at 3x, plus in-game scene composites
// at native 1x/2x to check readability at real size.
import { ANIMAL_IDS, CONFIG, Dir, HAT_IDS, PowerUp, generateMap, type DirCode, type EmoteId, type Theme, type TierId } from '@splash/shared';
import { drawText, fontCharset, textToCanvas } from '../render/font';
import { GLYPH_NAMES, ITEM_FRAMES, ITEM_FRAME_MS, getEmoteBubble, getGlyph, getItem, getLogo, getTierBadge, pingGlyph } from '../render/icons';
import { PAL, SLOT_COLORS, SLOT_COLORS_CB, SPLASH, SPLASH_CB, THEME_PALETTES } from '../render/palette';
import { cachedSpriteCount, ctx2d, makeCanvas } from '../render/pixelart';
import {
  BALLOON_FRAMES,
  CRITTER_OY,
  DUCK_RIDE_ANCHOR,
  DUCK_RIDE_FRAMES,
  SOAK_FRAME_MS,
  SOAK_OX,
  SOAK_OY,
  SPLASH_FRAMES,
  animalFrameAt,
  balloonFrameAt,
  getAnimalFrame,
  getBalloon,
  getCritter,
  getDuckRide,
  getPortrait,
  getShadow,
  getSlidingBalloon,
  getSoakFrame,
  getSplash,
  soakFrameCount,
  splashFrameAt,
} from '../render/sprites';
import {
  CASTLE_CRUMBLE_FRAMES,
  FLOOR_VARIANTS,
  WATER_FRAMES,
  WATER_FRAME_MS,
  drawArena,
  drawWater,
  getBorderTile,
  getCastleCrumble,
  getCastleTile,
  getFloorTile,
  getPillarTile,
  getWaterEdge,
  getWaterTile,
  type BorderPiece,
} from '../render/tiles';

const SCALE = 3;
const BOARD_W = 420;
const THEMES: Theme[] = ['backyard', 'beach', 'pool'];
const TIERS: TierId[] = ['puddle', 'pond', 'river', 'lake', 'ocean', 'tsunami'];
const EMOTES: EmoteId[] = [0, 1, 2, 3];
const PIECES: BorderPiece[] = ['tl', 'top', 'tr', 'left', 'right', 'bl', 'bottom', 'br'];
const FACINGS: [DirCode, string][] = [
  [Dir.Down, 'dn'],
  [Dir.Up, 'up'],
  [Dir.Left, 'lf'],
  [Dir.Right, 'rt'],
];

/** Flow layout of labelled sprite cells on a 1x board, shown scaled up. */
class Board {
  private placed: { x: number; y: number; cv: HTMLCanvasElement }[] = [];
  private labels: { x: number; y: number; text: string }[] = [];
  private x = 4;
  private y = 4;
  private rowH = 0;

  constructor(private readonly bg: string) {}

  cell(cv: HTMLCanvasElement, label = '', gap = 4): this {
    const w = Math.max(cv.width, label.length * 4);
    if (this.x + w > BOARD_W - 4) this.newRow();
    this.placed.push({ x: this.x, y: this.y, cv });
    if (label) this.labels.push({ x: this.x, y: this.y + cv.height + 2, text: label });
    this.rowH = Math.max(this.rowH, cv.height + (label ? 9 : 2));
    this.x += w + gap;
    return this;
  }

  heading(text: string): this {
    if (this.x > 4) this.newRow();
    this.labels.push({ x: 4, y: this.y, text: `>${text}` });
    this.y += 9;
    return this;
  }

  newRow(): this {
    this.x = 4;
    this.y += this.rowH + 3;
    this.rowH = 0;
    return this;
  }

  render(): HTMLCanvasElement {
    const h = this.y + this.rowH + 6;
    const cv = makeCanvas(BOARD_W, h);
    const ctx = ctx2d(cv);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, BOARD_W, h);
    for (const p of this.placed) ctx.drawImage(p.cv, p.x, p.y);
    for (const l of this.labels) drawText(ctx, l.text, l.x, l.y, { font: 'small', color: PAL.white, shadow: PAL.ink });
    return scaled(cv, SCALE);
  }
}

function scaled(cv: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  cv.className = 'sheet';
  cv.style.width = `${cv.width * scale}px`;
  cv.style.height = `${cv.height * scale}px`;
  return cv;
}

function section(id: string, title: string, ...content: HTMLElement[]): void {
  const el = document.createElement('section');
  el.id = id;
  el.append(textToCanvas(title, { font: 'big', color: PAL.yellow, shadow: PAL.ink, scale: SCALE }), ...content);
  document.getElementById('root')?.append(el);
}

function swatch(color: string, w = 12, h = 12): HTMLCanvasElement {
  const cv = makeCanvas(w, h);
  const ctx = ctx2d(cv);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return cv;
}

function compose(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cv = makeCanvas(w, h);
  draw(ctx2d(cv));
  return cv;
}

function paletteSection(): void {
  const b = new Board(PAL.slate);
  b.heading('named palette');
  for (const [name, color] of Object.entries(PAL)) b.cell(swatch(color), name.slice(0, 7), 6);
  b.heading('slot colours (main light dark), normal then colourblind');
  for (const set of [SLOT_COLORS, SLOT_COLORS_CB]) {
    set.forEach((c) => [c.main, c.light, c.dark].forEach((col, i) => b.cell(swatch(col), i === 0 ? c.name.slice(0, 5) : '', 1)));
    b.newRow();
  }
  b.heading('splash palettes (edge body light core + droplets)');
  for (const p of [SPLASH, SPLASH_CB]) {
    [p.edge, p.body, p.light, p.core, ...p.droplets].forEach((col) => b.cell(swatch(col), '', 1));
    b.newRow();
  }
  b.heading('theme palettes');
  for (const theme of THEMES) {
    const t = THEME_PALETTES[theme];
    Object.values(t).filter((v) => v.startsWith('#')).forEach((col) => b.cell(swatch(col, 8, 8), '', 1));
    b.cell(swatch(t.backdrop, 1, 8), t.name, 4).newRow();
  }
  section('palette', 'PALETTE', b.render());
}

function fontSection(): void {
  const b = new Board(PAL.navy);
  const sample = (text: string, font: 'big' | 'small', color: string, shadow?: string) =>
    compose(BOARD_W - 12, font === 'big' ? 10 : 8, (ctx) => drawText(ctx, text, 0, 0, { font, color, shadow }));
  for (const font of ['big', 'small'] as const) {
    b.heading(`${font} font: every glyph`);
    b.cell(sample(fontCharset(font), font, PAL.white));
    b.cell(sample('the quick brown fox jumps over 0123456789!?', font, PAL.skyLight, PAL.ink));
    b.cell(sample('SoggyOtter#4821 SOAKED DuckyDan! (x3) 100% <OK> a+b=c_d&e*', font, PAL.yellow, PAL.redDark));
  }
  b.heading('alignment left / center / right and multi-line');
  b.cell(
    compose(200, 40, (ctx) => {
      ctx.fillStyle = PAL.slate;
      ctx.fillRect(100, 0, 1, 40);
      drawText(ctx, 'LEFT', 100, 0, { align: 'left' });
      drawText(ctx, 'CENTER', 100, 10, { align: 'center', color: PAL.yellow });
      drawText(ctx, 'RIGHT', 100, 20, { align: 'right', color: PAL.pink });
      drawText(ctx, 'TWO\nLINES', 4, 0, { font: 'small', color: PAL.lime });
    }),
  );
  section('fonts', 'BITMAP FONTS', b.render(), textToCanvas('textToCanvas 2x', { scale: 2, color: PAL.aqua, shadow: PAL.ink }));
}

function animalsSection(): void {
  const b = new Board(PAL.slate);
  for (const animal of ANIMAL_IDS) {
    b.heading(animal);
    for (const [dir, name] of FACINGS) for (let f = 0; f < 3; f++) b.cell(getAnimalFrame(animal, dir, f, 0, false), `${name}${f}`, 2);
    b.newRow();
    for (let slot = 0; slot < 4; slot++) {
      b.cell(getAnimalFrame(animal, Dir.Down, 0, slot, false), `p${slot + 1}`, 2);
      b.cell(getAnimalFrame(animal, Dir.Down, 0, slot, true), `cb${slot + 1}`, 2);
    }
  }
  section('animals', 'ANIMALS (FACING X FRAME, SLOTS)', b.render());
}

function hatsSection(): void {
  const b = new Board(THEME_PALETTES.backyard.floorA);
  for (const hat of HAT_IDS) {
    b.heading(hat);
    for (const animal of ANIMAL_IDS) {
      for (const [dir] of FACINGS) b.cell(getCritter(animal, hat, dir, 0, 1, false), '', 1);
      b.cell(getCritter(animal, hat, Dir.Down, 1, 1, false, 1), '', 5);
    }
  }
  section('hats', 'HATS ON EVERY CRITTER', b.render());
}

function soakSection(): void {
  const b = new Board(PAL.greenDark);
  for (const cb of [false, true]) {
    for (const animal of ANIMAL_IDS) {
      b.heading(`${animal}${cb ? ' colorblind' : ''}`);
      for (let f = 0; f < soakFrameCount(animal); f++) b.cell(getSoakFrame(animal, f, 2, cb), `${f}`, 2);
    }
  }
  section('soak', 'SOAK FRAMES (CAT = EXTRA DRAMA)', b.render());
}

function ridesSection(): void {
  const b = new Board('#1c5c9c');
  b.heading('rubber duck rides (2 bob frames)');
  ANIMAL_IDS.forEach((animal, i) => {
    for (let f = 0; f < 2; f++) b.cell(getDuckRide(animal, f, i % 4, false, HAT_IDS[i % HAT_IDS.length]), `${animal.slice(0, 4)}${f}`, 2);
  });
  b.heading('portraits (animal x hat, slot colours; last two colourblind)');
  for (const animal of ANIMAL_IDS) {
    HAT_IDS.forEach((hat, i) => b.cell(getPortrait(animal, hat, i % 4, i > 3), '', 2));
    b.newRow();
  }
  section('rides', 'DUCK RIDES AND PORTRAITS', b.render());
}

function balloonsSection(): void {
  const b = new Board(THEME_PALETTES.backyard.floorA);
  for (const cb of [false, true]) {
    for (let slot = 0; slot < 4; slot++) {
      b.heading(`slot ${slot + 1}${cb ? ' colorblind' : ''}`);
      for (let f = 0; f < BALLOON_FRAMES; f++) b.cell(getBalloon(f, slot, cb, false), `${f}`, 2);
      for (const [dir, name] of FACINGS) b.cell(getSlidingBalloon(dir, slot, cb, false), `k${name}`, 2);
    }
  }
  b.heading('revenge duck balloon');
  for (let f = 0; f < BALLOON_FRAMES; f++) b.cell(getBalloon(f, 1, false, true), `${f}`, 2);
  for (const [dir, name] of FACINGS) b.cell(getSlidingBalloon(dir, 1, false, true), `k${name}`, 2);
  section('balloons', 'BALLOONS (FUSE STAGES, KICKED, DUCK)', b.render());
}

/** A splash cross of `range` assembled from the parts, as the world renderer draws it. */
function splashCross(ctx: CanvasRenderingContext2D, cx: number, cy: number, range: number, frame: number, cb: boolean): void {
  ctx.drawImage(getSplash('center', Dir.None, frame, cb), cx, cy);
  const arms: [DirCode, number, number][] = [
    [Dir.Up, 0, -1],
    [Dir.Down, 0, 1],
    [Dir.Left, -1, 0],
    [Dir.Right, 1, 0],
  ];
  for (const [dir, dx, dy] of arms) {
    for (let i = 1; i <= range; i++) {
      ctx.drawImage(getSplash(i === range ? 'end' : 'arm', dir, frame, cb), cx + dx * 16 * i, cy + dy * 16 * i);
    }
  }
}

function splashSection(): void {
  for (const cb of [false, true]) {
    const b = new Board(cb ? THEME_PALETTES.pool.floorA : THEME_PALETTES.backyard.floorA);
    for (let f = 0; f < SPLASH_FRAMES; f++) {
      b.heading(`frame ${f}`);
      b.cell(getSplash('center', Dir.None, f, cb), 'ctr', 3);
      for (const [dir, name] of FACINGS) b.cell(getSplash('arm', dir, f, cb), `a${name}`, 3);
      for (const [dir, name] of FACINGS) b.cell(getSplash('end', dir, f, cb), `e${name}`, 3);
      b.cell(compose(80, 80, (ctx) => splashCross(ctx, 32, 32, 2, f, cb)), 'cross', 3);
    }
    section(cb ? 'splash-cb' : 'splash', cb ? 'SPLASH (COLORBLIND, ON POOL BLUE)' : 'SPLASH (NORMAL)', b.render());
  }
}

function onFloor(theme: Theme, overlay: HTMLCanvasElement): HTMLCanvasElement {
  return compose(16, 16, (ctx) => {
    ctx.drawImage(getFloorTile(theme, 0, 0, false), 0, 0);
    ctx.drawImage(overlay, 0, 0);
  });
}

function tilesSection(): void {
  const b = new Board(PAL.ink);
  for (const theme of THEMES) {
    b.heading(`${theme} floors (variant x checker x shadow)`);
    for (let v = 0; v < FLOOR_VARIANTS; v++) for (let c = 0; c < 2; c++) for (const sh of [false, true]) b.cell(getFloorTile(theme, v, c, sh), `${v}${c}${sh ? 's' : ''}`, 1);
    b.heading(`${theme} border ring, pillars, castle, crumble`);
    for (const p of PIECES) b.cell(getBorderTile(theme, p), p, 1);
    for (let v = 0; v < 2; v++) b.cell(onFloor(theme, getPillarTile(theme, v)), `pil${v}`, 2);
    b.cell(onFloor(theme, getCastleTile(theme)), 'castle', 2);
    for (let f = 0; f < CASTLE_CRUMBLE_FRAMES; f++) b.cell(onFloor(theme, getCastleCrumble(theme, f)), `cr${f}`, 2);
  }
  b.heading('tide water frames + foam edges');
  for (let f = 0; f < WATER_FRAMES; f++) b.cell(getWaterTile(f), `w${f}`, 2);
  for (let f = 0; f < WATER_FRAMES; f++) {
    for (const [dir, name] of FACINGS) {
      const edge = compose(16, 16, (ctx) => {
        ctx.drawImage(getWaterTile(f), 0, 0);
        ctx.drawImage(getWaterEdge(dir, f), 0, 0);
      });
      b.cell(edge, `${name}${f}`, 1);
    }
  }
  b.heading('water tiled 3x2 (seam check)');
  for (let f = 0; f < WATER_FRAMES; f++) {
    const tiled = compose(48, 32, (ctx) => {
      for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) ctx.drawImage(getWaterTile(f), x * 16, y * 16);
    });
    b.cell(tiled, `f${f}`, 4);
  }
  section('tiles', 'TILESETS (BACKYARD, BEACH, POOL PARTY)', b.render());
}

const ITEM_KINDS = [PowerUp.Balloon, PowerUp.Range, PowerUp.Speed, PowerUp.Boots] as const;

function iconsSection(): void {
  const b = new Board(PAL.slate);
  b.heading('power-ups x shine frames (on grass, sand, pool)');
  for (const theme of THEMES) {
    for (const kind of ITEM_KINDS) {
      for (let f = 0; f < ITEM_FRAMES; f++) b.cell(onFloor(theme, getItem(kind, f) as HTMLCanvasElement), '', 1);
      b.cell(swatch(PAL.slate, 3, 1), '', 1);
    }
    b.newRow();
  }
  b.heading('tier badges small + large');
  for (const tier of TIERS) b.cell(getTierBadge(tier, 'small'), tier.slice(0, 5), 4);
  b.newRow();
  for (const tier of TIERS) b.cell(getTierBadge(tier, 'large'), tier, 4);
  b.heading('emotes: quack ribbit squeak honk');
  for (const id of EMOTES) b.cell(getEmoteBubble(id), CONFIG.EMOTE_NAMES[id], 6);
  b.heading('hud glyphs');
  for (const name of GLYPH_NAMES) b.cell(getGlyph(name), name, 3);
  b.heading('logo');
  b.cell(getLogo());
  section('icons', 'ICONS, BADGES, EMOTES, GLYPHS, LOGO', b.render());
}

/** An in-game frame: arena plus critters, balloons, splash, items, tide, ducks, emotes. */
function scene(theme: Theme, index: number, cb: boolean): HTMLCanvasElement {
  const map = generateMap('ffa', 4242 + index);
  return compose(map.w * 16, map.h * 16, (ctx) => {
    drawArena(ctx, theme, map.tiles, map.w, map.h, 7 + index);
    for (let x = 1; x < map.w - 1; x++) {
      drawWater(ctx, x * 16, (map.h - 2) * 16, index);
      ctx.drawImage(getWaterEdge(Dir.Up, index), x * 16, (map.h - 2) * 16);
    }
    ctx.drawImage(onFloor(theme, getCastleCrumble(theme, 1)), 5 * 16, 16);
    splashCross(ctx, 16 * 3, 16 * 3, 2, index % 2, cb);
    ITEM_KINDS.forEach((k, i) => ctx.drawImage(getItem(k, i) as HTMLCanvasElement, (7 + i) * 16, 5 * 16 - (i % 2)));
    map.spawns.forEach((sp, slot) => {
      const animal = ANIMAL_IDS[(slot + index * 4) % ANIMAL_IDS.length];
      const [px, py] = [sp.tx * 16, sp.ty * 16];
      ctx.drawImage(getShadow(12), px + 2, py + 12);
      ctx.drawImage(getCritter(animal, HAT_IDS[(slot + index) % HAT_IDS.length], FACINGS[slot][0], slot % 3, slot, cb), px, py - CRITTER_OY);
      ctx.drawImage(getBalloon(slot * 2, slot, cb, false), sp.tx === 1 ? px + 16 : px - 16, py);
    });
    ctx.drawImage(getEmoteBubble((index % 4) as EmoteId), 16 + 6, 16 - 17);
    ctx.drawImage(getSoakFrame(ANIMAL_IDS[(index + 5) % 8], 99, 1, cb), 9 * 16 - SOAK_OX, 9 * 16 - SOAK_OY);
    ctx.drawImage(getDuckRide(ANIMAL_IDS[(index + 6) % 8], index, 3, cb, 'crown'), 6 * 16 + 8 - DUCK_RIDE_ANCHOR.x, 8 - DUCK_RIDE_ANCHOR.y);
    ctx.drawImage(getBalloon(3, 3, cb, true), 6 * 16, 2 * 16);
  });
}

function scenesSection(): void {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-start' });
  THEMES.forEach((theme, i) => wrap.append(scaled(scene(theme, i, false), 1), scaled(scene(theme, i, false), 2)));
  wrap.append(scaled(scene('pool', 3, true), 2));
  section('scenes', 'IN-GAME SCENES AT NATIVE 1X AND 2X (LAST: COLORBLIND)', wrap);

  const b = new Board(PAL.ink);
  THEMES.forEach((theme, i) => {
    const map = generateMap(i === 1 ? 'duel' : 'ffa', 1234 + i);
    b.cell(compose(map.w * 16, map.h * 16, (ctx) => drawArena(ctx, theme, map.tiles, map.w, map.h, 99 + i)), `${theme} ${map.w}x${map.h}`, 6);
  });
  section('arenas', 'ARENAS FROM THE REAL MAP GENERATOR', b.render());
}

/** Real-time loop using the same frame pickers and timings the game renderer uses. */
function liveSection(): void {
  const cv = makeCanvas(BOARD_W, 52);
  const ctx = ctx2d(cv);
  const start = performance.now();
  const draw = (now: number): void => {
    const t = now - start;
    const tick = Math.floor(t / CONFIG.TICK_MS);
    ctx.fillStyle = THEME_PALETTES.backyard.floorA;
    ctx.fillRect(0, 0, BOARD_W, 52);
    ANIMAL_IDS.forEach((animal, i) => {
      const hat = HAT_IDS[(i + 4) % HAT_IDS.length];
      ctx.drawImage(getCritter(animal, hat, FACINGS[i % 4][0], animalFrameAt(true, t + i * 50), i % 4, false, Math.floor(t / 90)), 4 + i * 20, 6);
    });
    const fuseLeft = CONFIG.FUSE_TICKS - (tick % CONFIG.FUSE_TICKS);
    ctx.drawImage(getBalloon(balloonFrameAt(fuseLeft, CONFIG.FUSE_TICKS, tick), 0, false, false), 170, 8);
    const splashAge = tick % (CONFIG.SPLASH_TICKS + 10);
    if (splashAge < CONFIG.SPLASH_TICKS) splashCross(ctx, 206, 22, 1, splashFrameAt(splashAge, CONFIG.SPLASH_TICKS), false);
    for (let x = 0; x < 3; x++) drawWater(ctx, 250 + x * 16, 6, Math.floor(t / WATER_FRAME_MS));
    ITEM_KINDS.forEach((k, i) => ctx.drawImage(getItem(k, Math.floor(t / ITEM_FRAME_MS)) as HTMLCanvasElement, 250 + i * 18, 30));
    const soakFrames = soakFrameCount('cat') + 6;
    ctx.drawImage(getSoakFrame('cat', Math.floor(t / SOAK_FRAME_MS) % soakFrames, 0, false), 330, 4);
    ctx.drawImage(getDuckRide('frog', Math.floor(t / 400) % DUCK_RIDE_FRAMES, 1, false, 'propeller'), 360, 4);
    ctx.drawImage(pingGlyph([40, 120, 200, 320][Math.floor(t / 1000) % 4]), 392, 8);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  section('live', 'LIVE ANIMATION PREVIEW', scaled(cv, SCALE));
}

liveSection();
paletteSection();
fontSection();
animalsSection();
hatsSection();
soakSection();
ridesSection();
balloonsSection();
splashSection();
tilesSection();
iconsSection();
scenesSection();
document.title = `Sprite sheet (${cachedSpriteCount()} cached canvases)`;
