/**
 * XP + level + cosmetic-unlock schedule (all cosmetic, never pay/power).
 */

import { CONFIG, levelFromXp } from '@splash/shared';
import type { AnimalId, HatId } from '@splash/shared';

/** Items granted the moment a player reaches the given level. */
export const UNLOCK_BY_LEVEL: Record<number, string> = {
  2: 'otter',
  3: 'snorkel',
  4: 'penguin',
  5: 'bucket',
  7: 'cat',
  9: 'bandana',
  11: 'raccoon',
  13: 'propeller',
  15: 'turtle',
  18: 'crown',
  20: 'capybara',
};

/** Always available from level 1. */
export const STARTER_ANIMALS: AnimalId[] = ['frog', 'duck'];
export const STARTER_HATS: HatId[] = ['none'];

export const ALL_ANIMALS: AnimalId[] = [
  'frog',
  'duck',
  'otter',
  'penguin',
  'cat',
  'raccoon',
  'turtle',
  'capybara',
];
export const ALL_HATS: HatId[] = ['none', 'bucket', 'snorkel', 'crown', 'bandana', 'propeller'];

export function isAnimal(id: string): id is AnimalId {
  return (ALL_ANIMALS as string[]).includes(id);
}
export function isHat(id: string): id is HatId {
  return (ALL_HATS as string[]).includes(id);
}

/** Every item unlocked by reaching `level` (cumulative, includes starters). */
export function unlocksForLevel(level: number): string[] {
  const items = new Set<string>([...STARTER_ANIMALS, ...STARTER_HATS]);
  for (let l = 2; l <= level; l++) {
    if (UNLOCK_BY_LEVEL[l]) items.add(UNLOCK_BY_LEVEL[l]);
  }
  return [...items];
}

/** New items granted when crossing from `fromLevel` to `toLevel`. */
export function newUnlocks(fromLevel: number, toLevel: number): string[] {
  const out: string[] = [];
  for (let l = fromLevel + 1; l <= toLevel; l++) {
    if (UNLOCK_BY_LEVEL[l]) out.push(UNLOCK_BY_LEVEL[l]);
  }
  return out;
}

export function levelForXp(xp: number): number {
  return levelFromXp(xp).level;
}

export interface XpBreakdownInput {
  participated: boolean;
  placement: number; // 1-based
  soaks: number;
  castlesWashed: number;
  roundsWon: number;
}

export function computeXp(input: XpBreakdownInput): number {
  if (!input.participated) return 0;
  const xp = CONFIG.XP;
  const placeBonus = xp.perPlacement[Math.min(input.placement - 1, xp.perPlacement.length - 1)] ?? 0;
  return (
    xp.participation +
    placeBonus +
    input.soaks * xp.perSoak +
    input.castlesWashed * xp.perCastle +
    input.roundsWon * xp.perRoundWon
  );
}
