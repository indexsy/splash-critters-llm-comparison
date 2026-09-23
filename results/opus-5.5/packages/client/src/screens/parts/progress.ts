// Pure progression helpers for the results XP animation and the locker's "next unlock" line.
import { ANIMALS, HATS, levelFromXp, type AnimalId, type HatId } from '@splash/shared';

/** One level's worth of the XP bar animation: fill `from` -> `to` out of `max` at `level`. */
export interface XpSegment {
  level: number;
  from: number;
  to: number;
  max: number;
  /** The bar fills completely: the player reaches level + 1 at the end of this segment. */
  levelsUp: boolean;
}

/**
 * Split an XP gain into per-level bar segments. Every level-up segment is followed by the next
 * level's segment (possibly empty), so the last segment always shows the final level.
 */
export function xpSegments(xpBefore: number, xpAfter: number): XpSegment[] {
  const start = Math.max(0, Math.floor(Number.isFinite(xpBefore) ? xpBefore : 0));
  const end = Math.max(start, Math.floor(Number.isFinite(xpAfter) ? xpAfter : 0));
  const segments: XpSegment[] = [];
  let cursor = start;
  for (;;) {
    const info = levelFromXp(cursor);
    const gain = Math.min(info.xpForNext - info.xpIntoLevel, end - cursor);
    const to = info.xpIntoLevel + gain;
    const levelsUp = to >= info.xpForNext;
    segments.push({ level: info.level, from: info.xpIntoLevel, to, max: info.xpForNext, levelsUp });
    cursor += gain;
    if (!levelsUp) return segments;
  }
}

export interface NextUnlock {
  kind: 'animal' | 'hat';
  id: AnimalId | HatId;
  name: string;
  level: number;
}

/** The closest cosmetic unlocked above `level` (animals first on ties), or null when all are owned. */
export function nextUnlock(level: number): NextUnlock | null {
  const upcoming: NextUnlock[] = [
    ...ANIMALS.filter((a) => a.unlockLevel > level).map((a) => ({ kind: 'animal' as const, id: a.id, name: a.name, level: a.unlockLevel })),
    ...HATS.filter((h) => h.unlockLevel > level).map((h) => ({ kind: 'hat' as const, id: h.id, name: h.name, level: h.unlockLevel })),
  ];
  upcoming.sort((a, b) => a.level - b.level || (a.kind === b.kind ? 0 : a.kind === 'animal' ? -1 : 1));
  return upcoming[0] ?? null;
}
