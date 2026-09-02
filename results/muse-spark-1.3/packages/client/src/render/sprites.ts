import type { AnimalId, HatId, MapTheme } from '@splash/shared';

// Procedural 8-bit sprites on offscreen canvases. Internal res 256x224, integer scaled.
export const TILE = 16;

const animalPalettes: Record<AnimalId, { body: string; belly: string; dark: string }> = {
  frog: { body: '#3fd65f', belly: '#c9f7a3', dark: '#1d7a33' },
  duck: { body: '#ffd23f', belly: '#fff3b0', dark: '#b8860b' },
  otter: { body: '#9c6b4f', belly: '#e8c9a0', dark: '#5b3a24' },
  penguin: { body: '#2b2d42', belly: '#edf2f4', dark: '#12131f' },
  cat: { body: '#f4a259', belly: '#ffe8c2', dark: '#9c5b1e' },
  raccoon: { body: '#8d99ae', belly: '#edf2f4', dark: '#2b2d42' },
  turtle: { body: '#2a9d8f', belly: '#b8f2d5', dark: '#155e55' },
  capybara: { body: '#a0714f', belly: '#e5c9a8', dark: '#5e3f26' },
};

export const themeGround: Record<string, { a: string; b: string; castle: string; boulder: string; water: string }> = {
  backyard: { a: '#3fa34d', b: '#2e7d32', castle: '#e0c084', boulder: '#6c757d', water: '#4cc9f0' },
  beach: { a: '#ecd082', b: '#dfb95c', castle: '#f4f1de', boulder: '#8d99ae', water: '#48cae4' },
  pool: { a: '#7bdff2', b: '#5ec4d4', castle: '#f8edeb', boulder: '#3a86ff', water: '#3a86ff' },
};

function px(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(x | 0, y | 0, w, h);
}

export function drawAnimal(g: CanvasRenderingContext2D, animal: AnimalId, hat: HatId, x: number, y: number, frame: number, dirY: number, soaked: boolean): void {
  const p = animalPalettes[animal] ?? animalPalettes.frog;
  const s = 2; // pixel size
  const wob = frame % 2 === 0 ? 0 : 1;
  // shadow
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(x - 6, y + 6, 12, 3);
  // body 12x10
  px(g, x - 6, y - 6 + wob, 12, 8, p.body);
  px(g, x - 6, y - 6 + wob, 12, 2, p.dark);
  px(g, x - 4, y - 1 + wob, 8, 3, p.belly);
  // eyes
  const look = dirY < 0 ? -1 : 1;
  px(g, x - 4, y - 4 + wob + (look < 0 ? -1 : 0), 2, 2, '#fff');
  px(g, x + 2, y - 4 + wob + (look < 0 ? -1 : 0), 2, 2, '#fff');
  px(g, x - 3, y - 3 + wob, 1, 1, '#000');
  px(g, x + 3, y - 3 + wob, 1, 1, '#000');
  // ears per animal
  if (animal === 'frog') {
    px(g, x - 6, y - 9 + wob, 4, 3, p.body);
    px(g, x + 2, y - 9 + wob, 4, 3, p.body);
  } else if (animal === 'cat') {
    px(g, x - 6, y - 9 + wob, 3, 3, p.body);
    px(g, x + 3, y - 9 + wob, 3, 3, p.body);
  } else if (animal === 'duck') {
    px(g, x - 2, y - 2 + wob, 5, 3, '#ff9f1c'); // beak
  } else if (animal === 'penguin') {
    px(g, x - 2, y - 1 + wob, 4, 2, '#ff9f1c');
  }
  if (soaked) {
    // X eyes + droplets
    px(g, x - 4, y - 4 + wob, 2, 2, '#000');
    px(g, x + 2, y - 4 + wob, 2, 2, '#000');
  }
  drawHat(g, hat, x, y - 6 + wob);
}

function drawHat(g: CanvasRenderingContext2D, hat: HatId, x: number, y: number): void {
  if (hat === 'none') return;
  if (hat === 'bucket') {
    px(g, x - 5, y - 4, 10, 4, '#e4572e');
    px(g, x - 6, y - 1, 12, 2, '#f3a712');
  } else if (hat === 'snorkel') {
    px(g, x - 5, y - 3, 10, 2, '#00bbf9');
    px(g, x + 3, y - 8, 2, 7, '#00bbf9');
  } else if (hat === 'crown') {
    px(g, x - 5, y - 5, 10, 4, '#ffd23f');
    px(g, x - 5, y - 7, 2, 2, '#ffd23f');
    px(g, x - 1, y - 7, 2, 2, '#ffd23f');
    px(g, x + 3, y - 7, 2, 2, '#ffd23f');
  } else if (hat === 'bandana') {
    px(g, x - 6, y - 4, 12, 3, '#d90429');
    px(g, x + 4, y - 4, 3, 3, '#d90429');
  } else if (hat === 'propeller') {
    px(g, x - 4, y - 3, 8, 2, '#3a86ff');
    px(g, x - 1, y - 8, 2, 5, '#8d99ae');
    px(g, x - 5, y - 9, 10, 1, '#ef233c');
  }
}

export function drawBalloon(g: CanvasRenderingContext2D, x: number, y: number, fuse: number, maxFuse: number, colorblind: boolean): void {
  const t = 1 - fuse / maxFuse;
  const inflate = 1 + Math.sin(performance.now() / 130) * 0.06 + t * 0.25;
  const r = 6 * inflate;
  const pulse = fuse < 24 && Math.floor(performance.now() / 100) % 2 === 0;
  g.fillStyle = pulse ? '#ffffff' : colorblind ? '#ff7b00' : '#4cc9f0';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillRect(x - 3, y - 4, 2, 2);
  g.fillStyle = '#1d3557';
  g.fillRect(x - 1, y - r - 3, 2, 3);
}

export function drawSplash(g: CanvasRenderingContext2D, x: number, y: number, ttl: number, colorblind: boolean): void {
  const a = Math.min(1, ttl / 12 + 0.3);
  g.globalAlpha = a;
  g.fillStyle = colorblind ? '#ff9f1c' : '#90e0ef';
  const s = 14;
  g.fillRect(x - s / 2, y - 3, s, 6);
  g.fillRect(x - 3, y - s / 2, 6, s);
  g.fillStyle = '#ffffff';
  g.fillRect(x - 2, y - 2, 4, 4);
  // droplets
  g.fillStyle = colorblind ? '#ffbf69' : '#caf0f8';
  const t = performance.now() / 200;
  for (let i = 0; i < 4; i++) {
    const ang = t + (i * Math.PI) / 2;
    g.fillRect(x + Math.cos(ang) * 8 - 1, y + Math.sin(ang) * 8 - 1, 2, 2);
  }
  g.globalAlpha = 1;
}

export function drawCastle(g: CanvasRenderingContext2D, x: number, y: number, theme: MapTheme): void {
  const th = themeGround[theme === 'random' ? 'backyard' : theme] ?? themeGround.backyard;
  const s = TILE;
  px(g, x - s / 2, y - s / 2, s, s, th.castle);
  px(g, x - s / 2, y - s / 2, s, 3, '#fff3');
  px(g, x - s / 2, y + s / 2 - 3, s, 3, '#0003');
  // crenellations + door
  px(g, x - s / 2, y - s / 2, 3, 4, '#0002');
  px(g, x + s / 2 - 3, y - s / 2, 3, 4, '#0002');
  px(g, x - 2, y, 4, 6, '#8d5a2b');
}

export function drawBoulder(g: CanvasRenderingContext2D, x: number, y: number): void {
  const s = TILE;
  px(g, x - s / 2, y - s / 2, s, s, '#6c757d');
  px(g, x - s / 2, y - s / 2, s, 3, '#adb5bd');
  px(g, x - 4, y - 2, 3, 3, '#ced4da');
}

export function drawPowerup(g: CanvasRenderingContext2D, x: number, y: number, kind: string): void {
  const bob = Math.sin(performance.now() / 250) * 2;
  y += bob;
  px(g, x - 6, y - 6, 12, 12, '#131a2e');
  px(g, x - 5, y - 5, 10, 10, '#ffd23f');
  g.fillStyle = '#131a2e';
  g.font = '8px monospace';
  g.textAlign = 'center';
  const icon = kind === 'extra_balloon' ? '●' : kind === 'big_splash' ? '✸' : kind === 'flippers' ? '≋' : '◈';
  g.fillText(icon, x, y + 3);
}

export function drawDuck(g: CanvasRenderingContext2D, x: number, y: number, frame: number): void {
  const bob = frame % 2 === 0 ? 0 : 1;
  px(g, x - 7, y - 2 + bob, 14, 6, '#ffd23f');
  px(g, x + 2, y - 7 + bob, 6, 6, '#ffd23f');
  px(g, x + 6, y - 5 + bob, 3, 2, '#ff9f1c');
  px(g, x + 3, y - 6 + bob, 2, 2, '#000');
}

export function themeColors(theme: MapTheme): { a: string; b: string; water: string } {
  const t = theme === 'random' ? 'backyard' : theme;
  return themeGround[t] ?? themeGround.backyard;
}
