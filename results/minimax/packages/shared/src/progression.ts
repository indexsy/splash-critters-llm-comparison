import { CONFIG } from './config.js';
import type { AnimalId, HatId, Mode } from './types.js';

/** Level curve, XP awards and the cosmetic unlock catalogue. */

export interface CosmeticItem {
  id: string;
  name: string;
  kind: 'animal' | 'hat';
  unlockLevel: number;
}

export const ANIMALS: CosmeticItem[] = [
  { id: 'frog', name: 'Frog', kind: 'animal', unlockLevel: 1 },
  { id: 'duck', name: 'Duck', kind: 'animal', unlockLevel: 1 },
  { id: 'otter', name: 'Otter', kind: 'animal', unlockLevel: 3 },
  { id: 'penguin', name: 'Penguin', kind: 'animal', unlockLevel: 5 },
  { id: 'raccoon', name: 'Raccoon', kind: 'animal', unlockLevel: 8 },
  { id: 'cat', name: 'Cat', kind: 'animal', unlockLevel: 11 },
  { id: 'turtle', name: 'Turtle', kind: 'animal', unlockLevel: 14 },
  { id: 'capybara', name: 'Capybara', kind: 'animal', unlockLevel: 20 },
];

export const HATS: CosmeticItem[] = [
  { id: 'none', name: 'No Hat', kind: 'hat', unlockLevel: 1 },
  { id: 'bucket_hat', name: 'Bucket Hat', kind: 'hat', unlockLevel: 2 },
  { id: 'snorkel', name: 'Snorkel', kind: 'hat', unlockLevel: 4 },
  { id: 'crown', name: 'Tiny Crown', kind: 'hat', unlockLevel: 7 },
  { id: 'bandana', name: 'Pirate Bandana', kind: 'hat', unlockLevel: 10 },
  { id: 'propeller', name: 'Propeller Cap', kind: 'hat', unlockLevel: 15 },
];

export const ALL_COSMETICS: CosmeticItem[] = [...ANIMALS, ...HATS];

export function isAnimal(id: string): id is AnimalId {
  return ANIMALS.some((a) => a.id === id);
}

export function isHat(id: string): id is HatId {
  return HATS.some((h) => h.id === id);
}

/** XP needed to go from level `n` to level `n + 1`. */
export function xpForLevel(n: number): number {
  return CONFIG.LEVEL_CURVE_BASE + CONFIG.LEVEL_CURVE_STEP * n;
}

/** Total XP required to reach a given level. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let n = 1; n < level; n++) total += xpForLevel(n);
  return total;
}

/** The level a player has reached given their lifetime XP. */
export function levelForXp(xp: number): number {
  let level = 1;
  let remaining = Math.max(0, xp);
  while (remaining >= xpForLevel(level) && level < 999) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  return level;
}

/** Progress towards the next level: 0..1 plus the raw numbers. */
export function levelProgress(xp: number): {
  level: number;
  current: number;
  needed: number;
  ratio: number;
} {
  const level = levelForXp(xp);
  const needed = xpForLevel(level);
  const base = totalXpForLevel(level);
  const current = Math.max(0, xp - base);
  return { level, current, needed, ratio: Math.min(1, current / needed) };
}

/** Item ids unlocked at or below the given level. */
export function unlocksForLevel(level: number): string[] {
  return ALL_COSMETICS.filter((i) => i.unlockLevel <= level).map((i) => i.id);
}

export interface XpBreakdown {
  participation: number;
  placement: number;
  soaks: number;
  castles: number;
  total: number;
}

/** XP earned by a single player for a single match. */
export function computeXp(opts: {
  mode: Mode;
  placement: number;
  soaks: number;
  castlesWashed: number;
  participants: number;
}): XpBreakdown {
  const participation = CONFIG.XP.participation;
  let placementXp = CONFIG.XP.duelLoss;
  if (opts.mode === 'duel') {
    placementXp = opts.placement === 1 ? CONFIG.XP.duelWin : CONFIG.XP.duelLoss;
  } else {
    const table = CONFIG.XP.ffaPlacement;
    placementXp = table[Math.max(0, Math.min(table.length - 1, opts.placement - 1))];
  }
  const soaks = opts.soaks * CONFIG.XP.perSoak;
  const castles = opts.castlesWashed * CONFIG.XP.perCastle;
  return {
    participation,
    placement: placementXp,
    soaks,
    castles,
    total: participation + placementXp + soaks + castles,
  };
}
