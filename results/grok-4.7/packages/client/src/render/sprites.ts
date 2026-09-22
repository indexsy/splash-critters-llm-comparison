export const THEMES = {
  backyard: { floor: '#3f8f4a', floorAlt: '#32783c', boulder: '#6d645a', boulderHi: '#a89884', castle: '#e2b85a', castleDark: '#a87432', accent: '#8f563b' },
  beach: { floor: '#efd39a', floorAlt: '#e0c07e', boulder: '#8e93a3', boulderHi: '#d5d8e2', castle: '#f3d7a2', castleDark: '#c49255', accent: '#ef7d57' },
  pool: { floor: '#3cb4d4', floorAlt: '#2b96b8', boulder: '#f4f7fb', boulderHi: '#ffffff', castle: '#ef7d57', castleDark: '#b13e53', accent: '#ffcd75' },
} as const;

export type ThemeName = keyof typeof THEMES;

type G = (string | number)[][];

function grid(w: number, h: number): G {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => 0));
}

function blit(g: G, rows: string[], ox = 0, oy = 0, map: Record<string, string> = {}): void {
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.' || ch === ' ') return;
      const color = map[ch] ?? ch;
      if (oy + y < g.length && ox + x < (g[0]?.length ?? 0)) g[oy + y]![ox + x] = color;
    });
  });
}

const cache = new Map<string, HTMLCanvasElement>();

export function sprite(key: string, draw: (g: G) => void, w = 16, h = 16): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) return hit;
  const g = grid(w, h);
  draw(g);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = g[y]![x];
      if (!color) continue;
      ctx.fillStyle = String(color);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  cache.set(key, c);
  return c;
}

const INK = '#1a1c2c';
const WHITE = '#f4f4f4';

function animalRows(kind: string, frame: number): { rows: string[]; map: Record<string, string> } {
  const leg = frame ? 'k' : '.';
  const map: Record<string, string> = { k: INK, w: WHITE, y: '#ffcd75', o: '#ef7d57', g: '#38b764', d: '#257179', b: '#3b5dc9', n: '#8f563b', p: '#b13e53', e: '#94b0c2', t: '#c4a574', r: '#5d275d' };
  if (kind === 'duck') {
    return {
      map,
      rows: [
        '......kkkk......',
        '.....kyyyyk.....',
        '....kyyyyyyk....',
        '...kyywwyyyk....',
        '...kyykkkyyok...',
        '....kyyyyyok....',
        '....kkyyyyk.....',
        '...kyyyyyyyk....',
        '..kyyyyyyyyyk...',
        '..kyyyyyyyyyk...',
        '...kyyyyyyyk....',
        `...k${leg}k..k${leg}k....`,
        '................',
        '................',
        '................',
        '................',
      ],
    };
  }
  if (kind === 'otter') {
    return {
      map,
      rows: [
        '....kk....kk....',
        '...knnk..knnk...',
        '..knnnnknnnnk...',
        '..knwwnnnwwnk...',
        '..knnnnnnnnnk...',
        '...knnnnnnnk....',
        '..knnnnnnnnnk...',
        '.knnnnnnnnnnnk..',
        '.knnnwwnnnwwnk..',
        '..knnnnnnnnnk...',
        `...k${leg}k..k${leg}k....`,
        '....k......k....',
        '................',
        '................',
        '................',
        '................',
      ],
    };
  }
  if (kind === 'penguin') {
    return {
      map,
      rows: [
        '......kkkk......',
        '.....kbbbkk.....',
        '....kbbbbbbk....',
        '...kbbwwwbbk....',
        '...kbwwkwwbk....',
        '....kbbbbbbk....',
        '...kbbwwwbbk....',
        '..kbbbwwwbbbk...',
        '..kbbwwwwwbbk...',
        '...kbwwwwwbk....',
        `...ko${leg}k..k${leg}ok...`,
        '....o......o....',
        '................',
        '................',
        '................',
        '................',
      ],
    };
  }
  if (kind === 'cat') {
    return {
      map,
      rows: [
        '...kk......kk...',
        '...kok....kok...',
        '...koookkoook...',
        '....koooooook...',
        '....kowwkowwok..',
        '....kokkkkkok...',
        '.....kooooook...',
        '....kooooooook..',
        '...kooooooooook.',
        '....koooooook...',
        `....k${leg}k..k${leg}k....`,
        '................',
        '................',
        '................',
        '................',
        '................',
      ],
    };
  }
  if (kind === 'raccoon') {
    return {
      map,
      rows: [
        '....kk....kk....',
        '...kekk..kkek...',
        '..keeeekeeeek...',
        '..kewwkeewwek...',
        '..kekkkkkkkek...',
        '...keeeeeeek....',
        '..keeeeeeeeek...',
        '.keeeeeeweeeek..',
        '.keeeeeeeeeeeek.',
        '..keeeeeeeeek...',
        `...k${leg}k..k${leg}k....`,
        '................',
        '................',
        '................',
        '................',
        '................',
      ],
    };
  }
  if (kind === 'turtle') {
    return {
      map,
      rows: [
        '................',
        '......gggk......',
        '.....gggggk.....',
        '....kggggggk....',
        '...kgdgdggggk...',
        '..kggggggggggk..',
        '..kgdggdggdggk..',
        '..kggggggggggk..',
        '...kggggggggk...',
        '....kggggggk....',
        `...g${leg}....${leg}g....`,
        '................',
        '................',
        '................',
        '................',
        '................',
      ],
    };
  }
  if (kind === 'capybara') {
    return {
      map,
      rows: [
        '................',
        '....kkkkkkkk....',
        '...kttttttttk...',
        '..kttwwttwwttk..',
        '..kttkkttkkttk..',
        '..kttttttttttk..',
        '...kttttttttk...',
        '..kttttttttttk..',
        '.kttttttttttttk.',
        '.kttttttttttttk.',
        '..kttttttttttk..',
        `...k${leg}k..k${leg}k....`,
        '................',
        '................',
        '................',
        '................',
      ],
    };
  }
  return {
    map,
    rows: [
      '......kk..kk......',
      '.....kggkkggk.....',
      '.....kgwwgwwk.....',
      '.....kgkkkkggk....',
      '......kgggggk.....',
      '.....kgggggggk....',
      '....kgdggggdgk....',
      '....kggggggggk....',
      '.....kggggggk.....',
      `.....k${leg}k..k${leg}k....`,
      '.....k......k.....',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  };
}

export function animalSprite(kind: string, frame: number, hat: string): HTMLCanvasElement {
  return sprite(`a:${kind}:${frame}:${hat}`, (g) => {
    const art = animalRows(kind, frame);
    blit(g, art.rows, 0, 0, art.map);
    if (hat === 'bucket') blit(g, ['..yyyyyy..', '.yyyyyyyy.', 'yyyyyyyyyy'], 3, 1, { y: '#ffcd75' });
    if (hat === 'snorkel') blit(g, ['cccc', 'c..c', 'c..c', '.cc.'], 10, 1, { c: '#73eff7' });
    if (hat === 'crown') blit(g, ['y.y.y', 'yyyyy', '.yyy.'], 5, 0, { y: '#ffcd75' });
    if (hat === 'bandana') blit(g, ['pppppppp', 'pwwpppwp'], 4, 3, { p: '#b13e53', w: WHITE });
    if (hat === 'propeller') blit(g, ['c.c.c', '.yyy.', '..k..'], 5, 0, { c: '#73eff7', y: '#ef7d57', k: INK });
  });
}

export function tileSprite(theme: ThemeName, kind: 'floor' | 'floor2' | 'boulder' | 'castle'): HTMLCanvasElement {
  const pal = THEMES[theme];
  return sprite(`t:${theme}:${kind}`, (g) => {
    const base = kind === 'boulder' ? pal.boulder : kind === 'castle' ? pal.castle : kind === 'floor2' ? pal.floorAlt : pal.floor;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) g[y]![x] = base;
    if (kind === 'floor' || kind === 'floor2') {
      g[3]![4] = pal.accent;
      g[12]![11] = pal.accent;
    }
    if (kind === 'boulder') {
      for (let i = 2; i < 14; i++) {
        g[2]![i] = INK;
        g[13]![i] = INK;
        g[i]![2] = INK;
        g[i]![13] = INK;
      }
      g[4]![5] = pal.boulderHi;
      g[5]![5] = pal.boulderHi;
    }
    if (kind === 'castle') {
      for (let y = 4; y < 15; y++) for (let x = 3; x < 13; x++) g[y]![x] = pal.castle;
      for (let x = 3; x < 13; x++) g[4]![x] = INK;
      g[2]![7] = '#b13e53';
      g[3]![7] = '#b13e53';
      g[3]![8] = pal.castleDark;
      g[8]![6] = pal.castleDark;
      g[8]![9] = pal.castleDark;
      g[14]![4] = INK;
      g[14]![11] = INK;
    }
  });
}

export function balloonSprite(frame: number): HTMLCanvasElement {
  return sprite(`b:${frame}`, (g) => {
    const y0 = frame ? 1 : 0;
    blit(
      g,
      ['..rrrr..', '.rwwrrr.', 'rrrrrrrr', 'rrrrrrrr', '.rrrrrr.', '..rrrr..', '...kk...', '....k...'],
      4,
      3 + y0,
      { r: '#b13e53', w: WHITE, k: INK },
    );
  });
}

export function powerSprite(kind: string): HTMLCanvasElement {
  return sprite(`p:${kind}`, (g) => {
    if (kind === 'balloon') blit(g, ['..rrrr..', '.rwwrr.', 'rrrrrrr.', '.rrrrr..'], 4, 5, { r: '#41a6f6', w: WHITE });
    else if (kind === 'splash') blit(g, ['...cc...', '.c.cc.c.', 'ccccccc.', '.c.cc.c.', '...cc...'], 4, 5, { c: '#73eff7' });
    else if (kind === 'flippers') blit(g, ['yy....yy', 'yyy..yyy', '.yyyyyy.'], 3, 6, { y: '#38b764' });
    else blit(g, ['kkkkkkkk', 'k....wwk', 'kkkkkkkk'], 4, 6, { k: '#8f563b', w: '#ffcd75' });
  });
}

export function duckSprite(): HTMLCanvasElement {
  return sprite('rubber', (g) => {
    blit(g, ['..yyyy..', '.yywwyy.', 'yyyyoyyy', '.yyyyyy.', '..yyyy..'], 4, 6, { y: '#ffcd75', w: WHITE, o: '#ef7d57' });
  });
}

export function iconSprite(kind: string): HTMLCanvasElement {
  return animalSprite(kind, 0, 'none');
}
