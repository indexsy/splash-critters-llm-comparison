import { CONFIG } from './config.js';

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < CONFIG.ELO_PROVISIONAL_GAMES
    ? CONFIG.ELO_K_PROVISIONAL
    : CONFIG.ELO_K_STANDARD;
}

/** Standard 1v1 Elo. score = 1 win, 0 loss, 0.5 draw */
export function duelDelta(
  ratingA: number,
  ratingB: number,
  scoreA: number,
  gamesA: number,
): number {
  const K = kFactor(gamesA);
  const E = expectedScore(ratingA, ratingB);
  return Math.round(K * (scoreA - E));
}

export type FfaPlayer = {
  id: string;
  rating: number;
  games: number;
  placement: number; // 1 = best
};

/**
 * Pairwise FFA Elo: each pair contributes K/3 * (S - E).
 * S = 1 if better placement, 0.5 if tied, 0 if worse.
 */
export function ffaDeltas(players: FfaPlayer[]): Record<string, number> {
  const deltas: Record<string, number> = {};
  for (const p of players) deltas[p.id] = 0;

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]!;
      const b = players[j]!;
      let scoreA: number;
      if (a.placement < b.placement) scoreA = 1;
      else if (a.placement > b.placement) scoreA = 0;
      else scoreA = 0.5;

      const Ka = kFactor(a.games) / 3;
      const Kb = kFactor(b.games) / 3;
      const Ea = expectedScore(a.rating, b.rating);
      const Eb = expectedScore(b.rating, a.rating);

      deltas[a.id]! += Math.round(Ka * (scoreA - Ea));
      deltas[b.id]! += Math.round(Kb * ((1 - scoreA) - Eb));
    }
  }
  return deltas;
}

export function applyDelta(rating: number, delta: number): number {
  return Math.max(0, rating + delta);
}
