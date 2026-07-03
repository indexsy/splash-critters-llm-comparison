import { CONFIG } from './config.js';

export function getKFactor(gamesPlayed: number): number {
  return gamesPlayed < 10 ? CONFIG.ELO_K_NEW : CONFIG.ELO_K_REGULAR;
}

export function getTier(rating: number): string {
  for (const tier of CONFIG.TIERS) {
    if (rating <= tier.max) return tier.name;
  }
  return CONFIG.TIERS[CONFIG.TIERS.length - 1].name;
}

function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

export function calculateDuelElo(
  winnerRating: number,
  loserRating: number,
  winnerGames: number,
  loserGames: number
): { winnerNew: number; loserNew: number; delta: number } {
  const kWinner = getKFactor(winnerGames);
  const kLoser = getKFactor(loserGames);
  const eWinner = expectedScore(winnerRating, loserRating);
  const eLoser = expectedScore(loserRating, winnerRating);
  const winnerNew = Math.round(winnerRating + kWinner * (1 - eWinner));
  const loserNew = Math.round(loserRating + kLoser * (0 - eLoser));
  return {
    winnerNew,
    loserNew,
    delta: winnerNew - winnerRating,
  };
}

export function calculateFFAElo(
  ratings: number[],
  gamesPlayed: number[],
  placements: number[]
): { newRatings: number[]; deltas: number[] } {
  const n = ratings.length;
  const newRatings: number[] = [];
  const deltas: number[] = [];

  for (let i = 0; i < n; i++) {
    const K = getKFactor(gamesPlayed[i]);
    const Kp = K / (n - 1);
    let delta = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let S: number;
      if (placements[i] < placements[j]) {
        S = 1;
      } else if (placements[i] === placements[j]) {
        S = 0.5;
      } else {
        S = 0;
      }
      const E = expectedScore(ratings[i], ratings[j]);
      delta += Kp * (S - E);
    }
    const newRating = Math.round(ratings[i] + delta);
    newRatings.push(newRating);
    deltas.push(Math.round(delta));
  }

  return { newRatings, deltas };
}
