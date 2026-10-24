import { CONFIG } from "./config.js";
import type { GameMode } from "./types.js";

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

export function kFactor(games: number): number {
  return games < CONFIG.ELO.NEW_GAMES ? CONFIG.ELO.K_NEW : CONFIG.ELO.K_ESTABLISHED;
}

export function duelDeltas(
  ratingA: number,
  ratingB: number,
  scoreA: 0 | 1,
  gamesA: number,
  gamesB: number
): [number, number] {
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = expectedScore(ratingB, ratingA);
  const deltaA = Math.round(kFactor(gamesA) * (scoreA - expectedA));
  const deltaB = Math.round(kFactor(gamesB) * (1 - scoreA - expectedB));
  return [deltaA, deltaB];
}

export function ffaDeltas(ratings: number[], placements: number[], games: number[]): number[] {
  if (ratings.length !== 4 || placements.length !== 4 || games.length !== 4) {
    throw new Error("FFA Elo requires exactly four players");
  }
  return ratings.map((rating, index) => {
    let delta = 0;
    for (let opponent = 0; opponent < ratings.length; opponent += 1) {
      if (opponent === index) continue;
      const score = placements[index] === placements[opponent] ? 0.5 : placements[index] < placements[opponent] ? 1 : 0;
      delta += (kFactor(games[index]) / 3) * (score - expectedScore(rating, ratings[opponent]));
    }
    return Math.round(delta);
  });
}

export function tierFor(rating: number): string {
  let tier: string = CONFIG.TIERS[0].name;
  for (const candidate of CONFIG.TIERS) {
    if (rating >= candidate.min) tier = candidate.name;
  }
  return tier;
}

export function defaultRating(mode: GameMode) {
  return { mode, rating: CONFIG.ELO.START, games: 0, wins: 0, peak: CONFIG.ELO.START };
}

export function xpForLevel(level: number): number {
  return CONFIG.LEVEL_XP_BASE + CONFIG.LEVEL_XP_STEP * level;
}

export function levelForXp(xp: number): number {
  let level = 1;
  let remaining = Math.max(0, xp);
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  return level;
}
