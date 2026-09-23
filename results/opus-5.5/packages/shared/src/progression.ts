// Pure XP / level math and level-based cosmetic unlocks. The server persists the results.
import { CONFIG } from './config';
import { cosmeticsUnlockedAtLevel } from './cosmetics';

export interface LevelInfo {
  /** Current level, starting at 1. */
  level: number;
  /** XP earned inside the current level (0 <= xpIntoLevel < xpForNext). */
  xpIntoLevel: number;
  /** XP needed to go from `level` to `level + 1`. */
  xpForNext: number;
}

export interface MatchXpInput {
  /** 1-based final placement (ties share a placement). */
  placement: number;
  /** Participants in the match, humans and bots. */
  playerCount: number;
  roundsWon: number;
  soaks: number;
  castles: number;
  /** Practice vs bots: every line is scaled by CONFIG.XP.PRACTICE_MULT. */
  practice: boolean;
  /** Forfeiting players earn nothing. */
  forfeited: boolean;
}

export interface XpLine {
  label: string;
  xp: number;
}

export interface MatchXp {
  /** Always equals the sum of the breakdown lines. */
  earned: number;
  breakdown: XpLine[];
}

/** XP needed to go from level n to level n + 1: LEVEL_BASE + LEVEL_STEP * n. */
export function xpForLevel(n: number): number {
  return CONFIG.LEVEL_BASE + CONFIG.LEVEL_STEP * n;
}

/** Level reached with a lifetime XP total (negative or fractional totals are clamped/floored). */
export function levelFromXp(total: number): LevelInfo {
  let remaining = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  let level = 1;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  return { level, xpIntoLevel: remaining, xpForNext: xpForLevel(level) };
}

/** Non-negative integer view of a stat count. */
function count(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * Placement XP from CONFIG.XP.PLACEMENT. Last place always earns the table's final (consolation)
 * entry, so a duel loser and a 4p last place are treated alike; other places index by placement.
 */
function placementXp(placement: number, playerCount: number): number {
  const table = CONFIG.XP.PLACEMENT;
  const place = Math.max(1, count(placement));
  const isLast = playerCount > 1 && place >= playerCount;
  const index = isLast ? table.length - 1 : Math.min(place, table.length) - 1;
  return table[index];
}

/** Unscaled XP lines for a finished match; zero-value optional lines are omitted. */
function baseXpLines(input: MatchXpInput): XpLine[] {
  const { XP } = CONFIG;
  const lines: XpLine[] = [
    { label: 'Participation', xp: XP.PARTICIPATION },
    { label: 'Placement', xp: placementXp(input.placement, input.playerCount) },
    { label: 'Round wins', xp: count(input.roundsWon) * XP.ROUND_WIN },
    { label: 'Soaks', xp: count(input.soaks) * XP.PER_SOAK },
    { label: 'Castles washed', xp: Math.min(XP.CASTLE_CAP, count(input.castles) * XP.PER_CASTLE) },
  ];
  return lines.filter((line, i) => i < 2 || line.xp > 0);
}

/** XP for one human's match: participation + placement + round wins + soaks + castles (capped). */
export function computeMatchXp(input: MatchXpInput): MatchXp {
  if (input.forfeited) return { earned: 0, breakdown: [{ label: 'Forfeited', xp: 0 }] };
  const multiplier = input.practice ? CONFIG.XP.PRACTICE_MULT : 1;
  const breakdown = baseXpLines(input).map((line) => ({ label: line.label, xp: Math.round(line.xp * multiplier) }));
  const earned = breakdown.reduce((sum, line) => sum + line.xp, 0);
  return { earned, breakdown };
}

/** Cosmetic ids whose unlock level lies in (levelBefore, levelAfter]. */
export function unlocksBetween(levelBefore: number, levelAfter: number): string[] {
  if (levelAfter <= levelBefore) return [];
  const already = new Set(cosmeticsUnlockedAtLevel(levelBefore));
  return cosmeticsUnlockedAtLevel(levelAfter).filter((id) => !already.has(id));
}
