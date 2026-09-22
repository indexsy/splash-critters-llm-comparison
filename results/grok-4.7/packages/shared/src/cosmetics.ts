export interface Cosmetic {
  id: string;
  type: 'animal' | 'hat';
  name: string;
  level: number;
  blurb: string;
}

export const COSMETICS: readonly Cosmetic[] = [
  { id: 'frog', type: 'animal', name: 'Frog', level: 1, blurb: 'Starts damp. Stays cheerful.' },
  { id: 'duck', type: 'animal', name: 'Duck', level: 1, blurb: 'Born for the splash.' },
  { id: 'otter', type: 'animal', name: 'Otter', level: 3, blurb: 'Floats through trouble.' },
  { id: 'penguin', type: 'animal', name: 'Penguin', level: 5, blurb: 'Waddles, then wins.' },
  { id: 'cat', type: 'animal', name: 'Cat', level: 7, blurb: 'Hates water. Soak is a tragedy.' },
  { id: 'raccoon', type: 'animal', name: 'Raccoon', level: 10, blurb: 'Washes everything, including you.' },
  { id: 'turtle', type: 'animal', name: 'Turtle', level: 14, blurb: 'Slow to anger. Not to balloons.' },
  { id: 'capybara', type: 'animal', name: 'Capybara', level: 20, blurb: 'Level 20 flex. Unbothered.' },
  { id: 'none', type: 'hat', name: 'No Hat', level: 1, blurb: 'Just ears.' },
  { id: 'bucket', type: 'hat', name: 'Bucket Hat', level: 2, blurb: 'Backyard classic.' },
  { id: 'snorkel', type: 'hat', name: 'Snorkel', level: 4, blurb: 'Optimistic.' },
  { id: 'crown', type: 'hat', name: 'Tiny Crown', level: 8, blurb: 'Wet royalty.' },
  { id: 'bandana', type: 'hat', name: 'Pirate Bandana', level: 12, blurb: 'No ship required.' },
  { id: 'propeller', type: 'hat', name: 'Propeller Cap', level: 16, blurb: 'It does not help. It spins.' },
];

export function cosmeticById(id: string): Cosmetic | undefined {
  return COSMETICS.find((c) => c.id === id);
}

export function unlocksForLevel(level: number): string[] {
  return COSMETICS.filter((c) => c.level <= level).map((c) => c.id);
}

export function animals(): Cosmetic[] {
  return COSMETICS.filter((c) => c.type === 'animal');
}

export function hats(): Cosmetic[] {
  return COSMETICS.filter((c) => c.type === 'hat');
}
