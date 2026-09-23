// Cosmetic catalogue: animals and hats, their display names and unlock levels.
// Everything here is cosmetic only, never pay/power.
import type { AnimalId, HatId } from './types';

export interface CosmeticDef<T extends string> {
  id: T;
  name: string;
  unlockLevel: number;
  blurb: string;
}

export const ANIMALS: CosmeticDef<AnimalId>[] = [
  { id: 'frog', name: 'Frog', unlockLevel: 1, blurb: 'Loves a good puddle.' },
  { id: 'duck', name: 'Duck', unlockLevel: 1, blurb: 'Water off its back.' },
  { id: 'otter', name: 'Otter', unlockLevel: 3, blurb: 'Juggles balloons for fun.' },
  { id: 'penguin', name: 'Penguin', unlockLevel: 5, blurb: 'Dressed for every occasion.' },
  { id: 'cat', name: 'Cat', unlockLevel: 8, blurb: 'Hates water. Extremely dramatic soaks.' },
  { id: 'raccoon', name: 'Raccoon', unlockLevel: 11, blurb: 'Washes everything, including you.' },
  { id: 'turtle', name: 'Turtle', unlockLevel: 15, blurb: 'Slow and steady splashes.' },
  { id: 'capybara', name: 'Capybara', unlockLevel: 20, blurb: 'Unbothered. The ultimate flex.' },
];

export const HATS: CosmeticDef<HatId>[] = [
  { id: 'none', name: 'No Hat', unlockLevel: 1, blurb: 'Au naturel.' },
  { id: 'bucket', name: 'Bucket Hat', unlockLevel: 2, blurb: 'Classic beach vibes.' },
  { id: 'snorkel', name: 'Snorkel', unlockLevel: 4, blurb: 'Breathe easy underwater.' },
  { id: 'bandana', name: 'Pirate Bandana', unlockLevel: 7, blurb: 'Arr, prepare to be soaked.' },
  { id: 'propeller', name: 'Propeller Cap', unlockLevel: 10, blurb: 'Spins when you run.' },
  { id: 'crown', name: 'Tiny Crown', unlockLevel: 13, blurb: 'Royalty of the splash zone.' },
];

export const ANIMAL_IDS: AnimalId[] = ANIMALS.map((a) => a.id);
export const HAT_IDS: HatId[] = HATS.map((h) => h.id);

/** Items every new player owns. */
export const STARTER_UNLOCKS: string[] = [
  ...ANIMALS.filter((a) => a.unlockLevel <= 1).map((a) => a.id),
  ...HATS.filter((h) => h.unlockLevel <= 1).map((h) => h.id),
];

/** Every cosmetic id whose unlock level is <= level. */
export function cosmeticsUnlockedAtLevel(level: number): string[] {
  return [
    ...ANIMALS.filter((a) => a.unlockLevel <= level).map((a) => a.id),
    ...HATS.filter((h) => h.unlockLevel <= level).map((h) => h.id),
  ];
}

export function isAnimalId(v: unknown): v is AnimalId {
  return typeof v === 'string' && (ANIMAL_IDS as string[]).includes(v);
}

export function isHatId(v: unknown): v is HatId {
  return typeof v === 'string' && (HAT_IDS as string[]).includes(v);
}

export function animalName(id: AnimalId): string {
  return ANIMALS.find((a) => a.id === id)?.name ?? id;
}

export function hatName(id: HatId): string {
  return HATS.find((h) => h.id === id)?.name ?? id;
}

/** Bot display names (casual/practice). Bots show as e.g. "Bot Bubbles". */
export const BOT_NAMES = ['Bubbles', 'Drizzle', 'Puddles', 'Splashy', 'Misty', 'Soggy', 'Drippy', 'Wavey'];
