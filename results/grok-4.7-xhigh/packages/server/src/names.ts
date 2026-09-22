import { ANIMALS, HATS, levelFromXp, tierFor, type AnimalId, type HatId, type Mode } from '@splash/shared';

const ADJ = ['Soggy', 'Damp', 'Splashy', 'Bubbly', 'Misty', 'Puddle', 'Foamy', 'Tidal', 'Dewy', 'Rainy', 'Mossy', 'Briny'];
const ANIM = ['Otter', 'Frog', 'Duck', 'Newt', 'Piper', 'Minnow', 'Heron', 'Toad', 'Gull', 'Kelp', 'Noodle', 'Puddles'];

const BLOCKED = [
  'fuck', 'shit', 'bitch', 'asshole', 'nigger', 'nigga', 'faggot', 'fag', 'cunt', 'dick', 'porn', 'slut', 'whore', 'rape', 'nazi',
];

export function guestName(rng: () => number): string {
  return ADJ[Math.floor(rng() * ADJ.length)] + ANIM[Math.floor(rng() * ANIM.length)];
}

export function cleanNick(raw: string): { ok: true; nick: string } | { ok: false; code: string; msg: string } {
  const nick = raw.trim().replace(/\s+/g, ' ');
  if (nick.length < 3 || nick.length > 16) return { ok: false, code: 'bad_nick', msg: 'Nickname must be 3–16 characters.' };
  if (!/^[A-Za-z0-9 ]+$/.test(nick)) return { ok: false, code: 'bad_nick', msg: 'Letters, numbers, and spaces only.' };
  const low = nick.toLowerCase();
  if (BLOCKED.some((w) => low.includes(w))) return { ok: false, code: 'profanity', msg: 'That name is not allowed.' };
  return { ok: true, nick };
}

export function itemIdAnimal(id: AnimalId): string {
  return `animal:${id}`;
}
export function itemIdHat(id: HatId): string {
  return `hat:${id}`;
}

export function unlockedItems(level: number): string[] {
  const items = ANIMALS.filter((a) => level >= a.level).map((a) => itemIdAnimal(a.id));
  for (const h of HATS) if (level >= h.level) items.push(itemIdHat(h.id));
  return items;
}

export function tierName(rating: number): string {
  return tierFor(rating).name;
}

export function levelOf(xp: number): number {
  return levelFromXp(xp);
}

export function emptyRating(mode: Mode) {
  return { mode, rating: 1000, games: 0, wins: 0, peak: 1000, tier: tierFor(1000).name };
}
