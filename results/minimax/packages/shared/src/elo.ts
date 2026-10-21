import { CONFIG } from './config.js';
import type { TierBand } from './config.js';

/** Elo rating maths. Pure functions only — the server persists the results. */

export interface EloEntry {
  rating: number;
  games: number;
}

export const ELO_START = CONFIG.ELO.start;

export function kFactor(games: number): number {
  return games < CONFIG.ELO.provisionalGames ? CONFIG.ELO.kProvisional : CONFIG.ELO.kStable;
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function tierFor(rating: number): TierBand {
  let band = CONFIG.TIERS[0];
  for (const t of CONFIG.TIERS) if (rating >= t.min) band = t;
  return band;
}

export function tierName(rating: number): string {
  return tierFor(rating).name;
}

export interface EloChange {
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
}

/** Standard Elo for a two player match. `scoreA` is 1 for a win, 0 for a loss. */
export function duelElo(a: EloEntry, b: EloEntry, scoreA: number): [EloChange, EloChange] {
  const kA = kFactor(a.games);
  const kB = kFactor(b.games);
  const eA = expectedScore(a.rating, b.rating);
  const eB = 1 - eA;
  const dA = kA * (scoreA - eA);
  const dB = kB * (1 - scoreA - eB);
  return [
    {
      ratingBefore: a.rating,
      ratingAfter: Math.round(a.rating + dA),
      delta: Math.round(dA),
    },
    {
      ratingBefore: b.rating,
      ratingAfter: Math.round(b.rating + dB),
      delta: Math.round(dB),
    },
  ];
}

/**
 * Pairwise Elo for a free-for-all. `placements` is 1-based and shared values
 * mean the players tied (their head-to-head score is then 0.5).
 */
export function ffaElo(
  players: EloEntry[],
  placements: number[],
): EloChange[] {
  const n = players.length;
  const kPrime = players.map((p) => kFactor(p.games) / CONFIG.ELO.ffaPairDivisor);
  const deltas = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pi = placements[i];
      const pj = placements[j];
      let sij: number;
      let sji: number;
      if (pi < pj) {
        sij = 1;
        sji = 0;
      } else if (pi > pj) {
        sij = 0;
        sji = 1;
      } else {
        sij = 0.5;
        sji = 0.5;
      }
      const eij = expectedScore(players[i].rating, players[j].rating);
      const eji = 1 - eij;
      deltas[i] += kPrime[i] * (sij - eij);
      deltas[j] += kPrime[j] * (sji - eji);
    }
  }

  return players.map((p, i) => ({
    ratingBefore: p.rating,
    ratingAfter: Math.round(p.rating + deltas[i]),
    delta: Math.round(deltas[i]),
  }));
}

/**
 * Turns final standings into 1-based placements. Players that tie on both
 * round wins and soaks share the same placement.
 */
export function placementsFromStandings(
  standings: { roundWins: number; soaks: number }[],
): number[] {
  const order = standings
    .map((s, i) => ({ i, ...s }))
    .sort((a, b) => b.roundWins - a.roundWins || b.soaks - a.soaks);
  const placements = new Array<number>(standings.length).fill(1);
  let lastRank = 0;
  let lastKey = '';
  order.forEach((entry, position) => {
    const key = `${entry.roundWins}:${entry.soaks}`;
    const rank = key === lastKey ? lastRank : position + 1;
    placements[entry.i] = rank;
    lastKey = key;
    lastRank = rank;
  });
  return placements;
}
