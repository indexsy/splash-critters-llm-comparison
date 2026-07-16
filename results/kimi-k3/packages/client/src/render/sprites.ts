import { AnimalId, HatId } from '@splash/shared';

export type Palette = Record<string, string>;

const BODY_A = [
  '....BBBB....',
  '..BBBBBBBB..',
  '..BEEBBEEB..',
  '..BEeBBEeB..',
  '.BBBBBBBBBB.',
  '.BBMMMMMMBB.',
  '.BBMMMMMMBB.',
  '.BBBBBBBBBB.',
  '..BBBBBBBB..',
  '..DBBBBBBD..',
  '..LL....LL..',
  '.LL......LL.',
];

const BODY_B = [
  '....BBBB....',
  '..BBBBBBBB..',
  '..BEEBBEEB..',
  '..BEeBBEeB..',
  '.BBBBBBBBBB.',
  '.BBMMMMMMBB.',
  '.BBMMMMMMBB.',
  '.BBBBBBBBBB..',
  '..BBBBBBBB..',
  '..DBBBBBBD..',
  '...LL..LL...',
  '...LL..LL...',
];

const EARS: Record<string, string[]> = {
  point: ['.BB......BB.', 'BBBB....BBBB'],
  round: ['.BB......BB.', '.BB......BB.'],
  stalks: ['..E.E..E.E..', '..EBE..EBE..'],
  flat: ['............', 'BBBBBBBBBBBB'],
};

const ANIMAL_STYLE: Record<AnimalId, { pal: Palette; ears: keyof typeof EARS | null; face: 'plain' | 'beak' | 'mask' | 'snout' }> = {
  frog: { pal: { B: '#4cae4c', D: '#2f7d32', M: '#c8e6a0', L: '#2f7d32', E: '#f4f4f4', e: '#1a1c2c' }, ears: 'stalks', face: 'plain' },
  duck: { pal: { B: '#f4f4f4', D: '#c7cfd4', M: '#ffffff', L: '#f2a13c', E: '#f4f4f4', e: '#1a1c2c' }, ears: null, face: 'beak' },
  otter: { pal: { B: '#9c6b3c', D: '#6f4525', M: '#e0b184', L: '#6f4525', E: '#f4f4f4', e: '#1a1c2c' }, ears: 'round', face: 'plain' },
  penguin: { pal: { B: '#2b2f44', D: '#1a1c2c', M: '#f4f4f4', L: '#f2a13c', E: '#f4f4f4', e: '#1a1c2c' }, ears: null, face: 'beak' },
  cat: { pal: { B: '#f2a13c', D: '#c47a1f', M: '#ffe3b3', L: '#c47a1f', E: '#f4f4f4', e: '#1a1c2c' }, ears: 'point', face: 'plain' },
  raccoon: { pal: { B: '#8d99a6', D: '#5b6670', M: '#d6dde3', L: '#5b6670', E: '#f4f4f4', e: '#1a1c2c' }, ears: 'round', face: 'mask' },
  turtle: { pal: { B: '#3d8f57', D: '#22633a', M: '#a3d9a5', L: '#22633a', E: '#f4f4f4', e: '#1a1c2c' }, ears: null, face: 'plain' },
  capybara: { pal: { B: '#a5713f', D: '#7d4f27', M: '#d9a86c', L: '#7d4f27', E: '#5a3a1e', e: '#1a1c2c' }, ears: 'flat', face: 'snout' },
};

const BEAK = ['....OOOO....', '....OOOO....'];
const MASK = ['.MMMMMMMMMM.'];
const SNOUT = ['....SSSS....', '....SnnS....'];

const HATS: Record<Exclude<HatId, 'none'>, string[]> = {
  bucket: ['.HHHHHHHHHH.', '.HHHHHHHHHH.', '.HHHHHHHHHH.', 'HHHHHHHHHHHH'],
  snorkel: ['............', '.GGGGGGGGG..', '.GGGGGGGGGT.', '.GGGGGGGGGT.'],
  crown: ['.Y..Y..Y..Y.', '.YY.YY.YY.Y.', '.YYYYYYYYYY.', '.YYYYYYYYYY.'],
  bandana: ['.RRRRRRRRRR.', 'RRRRRRRRRRRR', '..........RR', '..........RR'],
  propeller: ['P...PPPP...P', '.PPPPPPPPPP.', '.CCCCCCCCCC.', '.CCCCCCCCCC.'],
};

const HAT_PALS: Record<string, Palette> = {
  bucket: { H: '#8d99a6' },
  snorkel: { G: '#41a6f6', T: '#f2a13c' },
  crown: { Y: '#ffd23c' },
  bandana: { R: '#e04343' },
  propeller: { P: '#e04343', C: '#41a6f6' },
};

export function drawSprite(ctx: CanvasRenderingContext2D, rows: string[], pal: Palette, dx: number, dy: number): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === '.') continue;
      const color = pal[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(dx + x, dy + y, 1, 1);
    }
  }
}

export interface AnimalSprite {
  rows: string[];
  pal: Palette;
}

export function animalSprite(animal: AnimalId, frame: 0 | 1): AnimalSprite {
  const style = ANIMAL_STYLE[animal];
  const body = (frame === 0 ? BODY_A : BODY_B).slice();
  const pal: Palette = { ...style.pal };

  if (style.face === 'beak') {
    body[5] = BEAK[0]!;
    body[6] = BEAK[1]!;
    pal.O = '#f2821c';
  } else if (style.face === 'mask') {
    body[3] = MASK[0]!;
    pal.M = style.pal.D!;
  } else if (style.face === 'snout') {
    body[5] = SNOUT[0]!;
    body[6] = SNOUT[1]!;
    pal.S = '#d9a86c';
    pal.n = '#5a3a1e';
  }

  let rows = body;
  if (style.ears) {
    const earRows = EARS[style.ears]!;
    const earPal = { ...pal };
    rows = [...earRows, ...body];
    if (animal === 'frog') {
      earPal.E = '#f4f4f4';
    }
    return { rows, pal: earPal };
  }
  return { rows, pal };
}

export function hatSprite(hat: HatId): { rows: string[]; pal: Palette } | null {
  if (hat === 'none') return null;
  return { rows: HATS[hat], pal: HAT_PALS[hat]! };
}

export const BALLOON_SPRITE = {
  rows: [
    '..WWWW..',
    '.WWWWWW.',
    '.WWWWWWW'.slice(0, 8),
    'WWWWWWWW',
    'WWWWWWWW',
    '.WWWWWW.',
    '..WWWW..',
    '...SS...',
    '...SS...',
  ],
  pal: { W: '#41a6f6', S: '#c7cfd4' },
};

export const DUCK_SPRITE = {
  rows: [
    '............',
    '..YYYY......',
    '.YYYYYY.....',
    '.YeYYYYO....',
    '.YYYYYYO....',
    '..YYYYYYYY..',
    '.YYYYYYYYYY.',
    '..YYYYYYYY..',
    '............',
  ],
  pal: { Y: '#ffd23c', e: '#1a1c2c', O: '#f2821c' },
};

export const POWERUP_SPRITES: Record<string, { rows: string[]; pal: Palette }> = {
  balloon: {
    rows: ['..RRRR..', '.RRRRRR.', 'RRRRRRRR', 'RRRRRRRR', '.RRRRRR.', '..RRRR..', '...SS...', '...SS...'],
    pal: { R: '#e04343', S: '#c7cfd4' },
  },
  range: {
    rows: ['...YY...', '...YY...', 'YYYYYYYY', '.YYYYYY.', '..YYYY..', '.YY..YY.', 'YY....YY', '........'],
    pal: { Y: '#ffd23c' },
  },
  speed: {
    rows: ['........', '....CC..', '..CCCC..', 'CCCCCC..', '..CCCC..', '....CC..', '........', '........'],
    pal: { C: '#73eff7' },
  },
  boots: {
    rows: ['........', '..BB....', '..BB....', '..BBB...', '..BBBBB.', '..BBBBB.', '........', '........'],
    pal: { B: '#9c6b3c' },
  },
};

export const SPLASH_COLORS = {
  normal: ['#73eff7', '#41a6f6', '#2b6cb0', '#ffffff'],
  colorblind: ['#ffd23c', '#f2821c', '#c7cfd4', '#ffffff'],
};

export interface ThemeArt {
  floorA: string;
  floorB: string;
  boulder: string;
  boulderHi: string;
  castle: string;
  castleHi: string;
  castleDark: string;
  water: string;
  waterHi: string;
  bg: string;
}

export const THEMES: Record<string, ThemeArt> = {
  backyard: {
    floorA: '#5f8d3e', floorB: '#55813a',
    boulder: '#8d99a6', boulderHi: '#c7cfd4',
    castle: '#c2a15c', castleHi: '#e0c284', castleDark: '#8a6f38',
    water: '#41a6f6', waterHi: '#73eff7', bg: '#3e6029',
  },
  beach: {
    floorA: '#e0c284', floorB: '#d6b676',
    boulder: '#9a8f7a', boulderHi: '#c9bfa5',
    castle: '#c2a15c', castleHi: '#f0d69a', castleDark: '#8a6f38',
    water: '#2b9fd8', waterHi: '#73eff7', bg: '#b39658',
  },
  pool: {
    floorA: '#7fd4e8', floorB: '#6fc8de',
    boulder: '#5b8ba6', boulderHi: '#8fb9cc',
    castle: '#c2a15c', castleHi: '#e0c284', castleDark: '#8a6f38',
    water: '#2b6cb0', waterHi: '#41a6f6', bg: '#4a9ab0',
  },
};
