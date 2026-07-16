import { CONFIG, type AnimalId, type HatId, type Profile } from '@splash/shared';
import { drawAnimal } from '../render/sprites.js';
import { panel, pixelBg, text, W, H } from './common.js';

const ANIMALS = Object.keys(CONFIG.ANIMAL_UNLOCKS) as AnimalId[];
const HATS = Object.keys(CONFIG.HAT_UNLOCKS) as HatId[];

export function drawLocker(
  ctx: CanvasRenderingContext2D,
  tick: number,
  profile: Profile,
  selAnimal: number,
  selHat: number,
  tab: 'animal' | 'hat',
): void {
  pixelBg(ctx, tick);
  text(ctx, 'LOCKER', W / 2, 14, '#4fc3f7', 10, 'center');
  text(ctx, `Lv${profile.level}  XP ${profile.xp}`, W / 2, 26, '#fff59d', 6, 'center');

  // Preview
  panel(ctx, 80, 36, 96, 60);
  const animal = ANIMALS[selAnimal]!;
  const hat = HATS[selHat]!;
  const unlockedA = profile.level >= CONFIG.ANIMAL_UNLOCKS[animal];
  const unlockedH = profile.level >= CONFIG.HAT_UNLOCKS[hat];
  ctx.globalAlpha = unlockedA ? 1 : 0.3;
  drawAnimal(ctx, W / 2, 66, animal, unlockedH ? hat : 'none', 'down', Math.floor(tick / 10) % 2, 2);
  ctx.globalAlpha = 1;

  text(ctx, tab === 'animal' ? 'ANIMALS' : 'HATS', W / 2, 110, '#81d4fa', 7, 'center');
  text(ctx, '[Tab] switch  Arrows  [Enter] equip  [Esc]', W / 2, H - 8, '#666', 5, 'center');

  const items = tab === 'animal' ? ANIMALS : HATS;
  const sel = tab === 'animal' ? selAnimal : selHat;
  items.forEach((item, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 28 + col * 55;
    const y = 125 + row * 28;
    const lvl = tab === 'animal' ? CONFIG.ANIMAL_UNLOCKS[item as AnimalId] : CONFIG.HAT_UNLOCKS[item as HatId];
    const unlocked = profile.level >= lvl;
    const selected = i === sel;
    ctx.strokeStyle = selected ? '#fff59d' : '#333';
    ctx.strokeRect(x, y - 10, 48, 22);
    text(ctx, item.slice(0, 8), x + 24, y, unlocked ? (selected ? '#fff59d' : '#fff') : '#555', 5, 'center');
    if (!unlocked) text(ctx, `Lv${lvl}`, x + 24, y + 8, '#444', 5, 'center');
  });
}

export { ANIMALS, HATS };
