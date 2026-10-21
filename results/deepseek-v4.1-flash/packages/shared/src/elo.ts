import { CONFIG, tierForRating } from "./config.js";

export interface EloPlayer {
  id: string;
  rating: number;
  games: number;
}

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

export function kFactor(games: number): number {
  return games < CONFIG.ELO.placementGames ? CONFIG.ELO.kPlacement : CONFIG.ELO.kStandard;
}

export function duelDelta(
  player: EloPlayer,
  opponent: EloPlayer,
  score: 1 | 0,
): number {
  return Math.round(kFactor(player.games) * (score - expectedScore(player.rating, opponent.rating)));
}

export function pairScore(aPlacement: number, bPlacement: number): 0 | 0.5 | 1 {
  if (aPlacement < bPlacement) return 1;
  if (aPlacement > bPlacement) return 0;
  return 0.5;
}

export function ffaDeltas(
  players: EloPlayer[],
  placements: Record<string, number>,
): Record<string, number> {
  const deltas: Record<string, number> = {};
  for (const player of players) deltas[player.id] = 0;
  for (let i = 0; i < players.length; i += 1) {
    const a = players[i];
    if (!a) continue;
    const aPlacement = placements[a.id] ?? players.length;
    for (let j = 0; j < players.length; j += 1) {
      if (i === j) continue;
      const b = players[j];
      if (!b) continue;
      const bPlacement = placements[b.id] ?? players.length;
      const score = pairScore(aPlacement, bPlacement);
      const kPrime = kFactor(a.games) / CONFIG.ELO.ffaPairK;
      const contribution = kPrime * (score - expectedScore(a.rating, b.rating));
      deltas[a.id] = (deltas[a.id] ?? 0) + contribution;
    }
  }
  for (const id of Object.keys(deltas)) deltas[id] = Math.round(deltas[id] ?? 0);
  return deltas;
}

export function applyRating(
  rating: number,
  delta: number,
  games: number,
  peak: number,
  won: boolean,
): { rating: number; games: number; wins: number; peak: number } {
  const nextRating = Math.max(0, rating + delta);
  return {
    rating: nextRating,
    games: games + 1,
    wins: won ? 1 : 0,
    peak: Math.max(peak, nextRating),
  };
}

export function tierOf(rating: number): string {
  return tierForRating(rating);
}
