import { DIR_VEC, type AnimalId, type HatId, type Theme } from '@splash/shared';

const INK = '#1b1c2a';

const COLORS: Record<AnimalId, { body: string; dark: string; extra: string }> = {
  frog: { body: '#6fbf4a', dark: '#3e8f2e', extra: '#f4f7fb' },
  duck: { body: '#f2d04b', dark: '#d9a322', extra: '#f08a2a' },
  otter: { body: '#8a5a3a', dark: '#5c3a24', extra: '#e6c7a2' },
  penguin: { body: '#2c3144', dark: '#151824', extra: '#f4f7fb' },
  cat: { body: '#e07a3d', dark: '#b4532a', extra: '#f6d7c3' },
  raccoon: { body: '#8d8d9a', dark: '#4d4d5c', extra: '#f4f7fb' },
  turtle: { body: '#6aaa58', dark: '#2f6b45', extra: '#d9c07a' },
  capybara: { body: '#b5845a', dark: '#7a5436', extra: '#e6c7a2' },
};

function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, 1, 1);
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function blob(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, fill: string, edge: string) {
  for (let y = -ry - 1; y <= ry + 1; y++) {
    for (let x = -rx - 1; x <= rx + 1; x++) {
      const n = (x * x) / ((rx + 0.4) * (rx + 0.4)) + (y * y) / ((ry + 0.4) * (ry + 0.4));
      if (n > 1) continue;
      const inner = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      px(ctx, cx + x, cy + y, inner > 0.78 ? edge : fill);
    }
  }
}

export function drawAnimal(
  ctx: CanvasRenderingContext2D,
  animal: AnimalId,
  x: number,
  y: number,
  frame: number,
  hat: HatId | null,
  facing: number,
) {
  ctx.save();
  ctx.translate(Math.round(x + 8), Math.round(y + 8));
  if (facing === 4) ctx.scale(-1, 1);
  ctx.translate(-8, -8);
  const c = COLORS[animal] ?? COLORS.frog;
  const bob = frame % 2;
  blob(ctx, 8, 9, animal === 'capybara' ? 6 : 5, animal === 'penguin' ? 5 : 4, c.body, INK);
  if (animal === 'otter' || animal === 'capybara' || animal === 'penguin') {
    rect(ctx, 5, 8, 6, 4, c.extra);
  }
  if (animal === 'turtle') {
    rect(ctx, 4, 6, 8, 5, c.dark);
    px(ctx, 6, 7, c.extra);
    px(ctx, 9, 8, c.extra);
  }
  if (animal === 'raccoon') {
    rect(ctx, 3, 6, 4, 2, c.dark);
    rect(ctx, 9, 6, 4, 2, c.dark);
    rect(ctx, 12, 10, 3, 2, c.dark);
    px(ctx, 13, 12, c.body);
  }
  if (animal === 'cat') {
    px(ctx, 4, 3, c.body);
    px(ctx, 5, 4, c.body);
    px(ctx, 11, 3, c.body);
    px(ctx, 10, 4, c.body);
    px(ctx, 4, 3, INK);
    px(ctx, 11, 3, INK);
  }
  if (animal === 'frog') {
    rect(ctx, 3, 4, 3, 3, c.extra);
    rect(ctx, 10, 4, 3, 3, c.extra);
    px(ctx, 4, 5, INK);
    px(ctx, 11, 5, INK);
  } else {
    px(ctx, 6, 7, c.extra);
    px(ctx, 10, 7, c.extra);
    px(ctx, 6, 7, INK);
    px(ctx, 10, 7, INK);
  }
  if (animal === 'duck') {
    rect(ctx, 11, 8, 3, 2, c.extra);
    px(ctx, 14, 8, INK);
  }
  if (animal === 'penguin') {
    rect(ctx, 12, 8, 2, 1, '#f08a2a');
  }
  if (animal === 'capybara') {
    rect(ctx, 11, 8, 3, 2, c.dark);
    px(ctx, 5, 8, INK);
    px(ctx, 8, 8, INK);
  }
  const foot = c.dark;
  rect(ctx, 4, 13, 3, 1, foot);
  rect(ctx, 9, 13, 3, 1, foot);
  if (bob) {
    rect(ctx, 3, 14, 2, 1, foot);
    rect(ctx, 11, 12, 2, 1, foot);
  } else {
    rect(ctx, 5, 14, 2, 1, foot);
    rect(ctx, 10, 14, 2, 1, foot);
  }
  if (hat) drawHat(ctx, hat, frame);
  ctx.restore();
}

function drawHat(ctx: CanvasRenderingContext2D, hat: HatId, frame: number) {
  if (hat === 'bucket') {
    rect(ctx, 4, 2, 8, 2, '#e6c07b');
    rect(ctx, 3, 4, 10, 1, '#c49a4a');
    px(ctx, 3, 2, INK);
    px(ctx, 11, 2, INK);
  } else if (hat === 'snorkel') {
    rect(ctx, 11, 1, 1, 6, '#3ec6e0');
    rect(ctx, 10, 6, 2, 2, '#1d6fbf');
    px(ctx, 11, 0, INK);
  } else if (hat === 'bandana') {
    rect(ctx, 4, 4, 8, 2, '#d64545');
    px(ctx, 12, 5, '#d64545');
    px(ctx, 4, 4, INK);
  } else if (hat === 'crown') {
    rect(ctx, 4, 3, 8, 2, '#f2d04b');
    px(ctx, 4, 2, '#f2d04b');
    px(ctx, 7, 1, '#f2d04b');
    px(ctx, 11, 2, '#f2d04b');
    px(ctx, 6, 3, '#f08a2a');
  } else if (hat === 'propeller') {
    rect(ctx, 7, 2, 2, 3, '#8d8d9a');
    ctx.save();
    ctx.translate(8, 2);
    ctx.rotate(frame * 0.8);
    rect(ctx, -3, 0, 6, 1, '#ff5c7a');
    ctx.restore();
  }
}

export function drawTile(ctx: CanvasRenderingContext2D, theme: Theme, tile: number, x: number, y: number, tick: number) {
  const px0 = x * 16;
  const py0 = y * 16;
  if (tile === 1) {
    drawFloor(ctx, theme, px0, py0, tick);
    drawBoulder(ctx, theme, px0, py0);
    return;
  }
  if (tile === 3) {
    drawWater(ctx, px0, py0, tick);
    return;
  }
  drawFloor(ctx, theme, px0, py0, tick);
  if (tile === 2) drawCastle(ctx, px0, py0);
}

function drawFloor(ctx: CanvasRenderingContext2D, theme: Theme, x: number, y: number, tick: number) {
  const base = theme === 'beach' ? '#e6c98a' : theme === 'pool' ? '#3a7ec4' : '#5fa04a';
  const alt = theme === 'beach' ? '#efd7a2' : theme === 'pool' ? '#4d92d4' : '#6aaf52';
  rect(ctx, x, y, 16, 16, (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0 ? base : alt);
  if (theme === 'beach' && (x + y + tick) % 48 === 0) px(ctx, x + 4, y + 11, '#f4f7fb');
  if (theme === 'pool') {
    ctx.strokeStyle = '#d7f4ff';
    ctx.globalAlpha = 0.35;
    ctx.strokeRect(x + 1.5, y + 1.5, 13, 13);
    ctx.globalAlpha = 1;
  }
  if (theme === 'backyard' && (x * 3 + y) % 64 === 0) px(ctx, x + 12, y + 3, '#d9e28a');
}

function drawBoulder(ctx: CanvasRenderingContext2D, theme: Theme, x: number, y: number) {
  if (theme === 'pool') {
    rect(ctx, x + 2, y + 4, 12, 8, '#f4f7fb');
    rect(ctx, x + 4, y + 2, 8, 12, '#ff6b8a');
    rect(ctx, x + 6, y + 4, 4, 8, '#f4f7fb');
    px(ctx, x + 2, y + 4, INK);
    return;
  }
  const c = theme === 'beach' ? '#b9b1a2' : '#6d645c';
  blob(ctx, x + 8, y + 8, 6, 5, c, INK);
  px(ctx, x + 6, y + 7, '#efeae2');
}

function drawCastle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x + 2, y + 10, 12, 4, '#e0b15a');
  rect(ctx, x + 4, y + 6, 8, 5, '#c9923e');
  rect(ctx, x + 6, y + 3, 4, 4, '#b47d30');
  px(ctx, x + 7, y + 2, '#ff6b5a');
  px(ctx, x + 3, y + 10, INK);
  px(ctx, x + 12, y + 13, INK);
}

function drawWater(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number) {
  rect(ctx, x, y, 16, 16, (tick + x) % 16 < 8 ? '#1d6fbf' : '#2a86d4');
  px(ctx, x + ((tick + x) % 12), y + 4, '#8fd8f2');
  px(ctx, x + ((tick * 2 + y) % 14), y + 11, '#d7f6ff');
}

export function drawBalloon(ctx: CanvasRenderingContext2D, x: number, y: number, fuse: number, tick: number, sliding = false) {
  const wob = fuse < 30 ? (tick % 2 === 0 ? 1 : -1) : tick % 4 === 0 ? 1 : 0;
  const inflate = fuse < 25 ? 1 : 0;
  ctx.save();
  ctx.translate(Math.round(x + wob), Math.round(y));
  blob(ctx, 8, 8, 5 + inflate, 5 + inflate, '#3aa0e0', INK);
  px(ctx, 6, 5, '#d7f6ff');
  px(ctx, 7, 5, '#d7f6ff');
  px(ctx, 8, 13, '#1d4e78');
  if (sliding) px(ctx, 12, 8, '#f4f7fb');
  ctx.restore();
}

export function drawSplash(ctx: CanvasRenderingContext2D, x: number, y: number, ttl: number, safe: boolean) {
  const age = 12 - ttl;
  const col = safe ? ['#ffe08a', '#ffb000', '#ff5c1a'] : ['#d7f6ff', '#5ce1e6', '#1d6fbf'];
  const c = col[Math.min(2, Math.floor(age / 4))];
  const r = 2 + Math.min(5, age);
  rect(ctx, x + 8 - r, y + 7, r * 2, 2, c);
  rect(ctx, x + 7, y + 8 - r, 2, r * 2, c);
  px(ctx, x + 3, y + 3, col[0]);
  px(ctx, x + 12, y + 4, col[0]);
  px(ctx, x + 11, y + 12, col[1]);
}

export function drawPowerup(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, tick: number) {
  const bob = tick % 20 < 10 ? 0 : -1;
  ctx.save();
  ctx.translate(x, y + bob);
  rect(ctx, 4, 4, 8, 8, '#f6f1e6');
  px(ctx, 4, 4, INK);
  px(ctx, 11, 11, INK);
  if (kind === 'extra_balloon') {
    blob(ctx, 8, 8, 2, 2, '#3aa0e0', INK);
    px(ctx, 11, 4, '#6fbf4a');
  } else if (kind === 'big_splash') {
    rect(ctx, 5, 7, 6, 2, '#5ce1e6');
    rect(ctx, 7, 5, 2, 6, '#5ce1e6');
  } else if (kind === 'flippers') {
    rect(ctx, 4, 8, 3, 2, '#1d6fbf');
    rect(ctx, 9, 8, 3, 2, '#1d6fbf');
  } else {
    rect(ctx, 5, 6, 3, 5, '#5c3a24');
    rect(ctx, 9, 6, 3, 5, '#5c3a24');
  }
  ctx.restore();
}

export function drawDuckie(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y + (tick % 16 < 8 ? 0 : 1)));
  blob(ctx, 8, 9, 5, 3, '#f2d04b', INK);
  blob(ctx, 11, 6, 2, 2, '#f2d04b', INK);
  px(ctx, 12, 6, INK);
  rect(ctx, 13, 7, 2, 1, '#f08a2a');
  ctx.restore();
}

export function drawIcon(ctx: CanvasRenderingContext2D, animal: AnimalId, x: number, y: number, hat: HatId | null = null) {
  drawAnimal(ctx, animal, x, y, 0, hat, 2);
}

export function slideOffset(dir: number, acc: number): { x: number; y: number } {
  const v = DIR_VEC[dir] ?? { x: 0, y: 0 };
  return { x: v.x * acc * 16, y: v.y * acc * 16 };
}
