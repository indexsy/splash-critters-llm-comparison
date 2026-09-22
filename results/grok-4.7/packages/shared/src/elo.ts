import { CONFIG } from './config.js';

export interface EloPlayer {
  id: string;
  rating: number;
  games: number;
  placement: number;
}

export interface EloDelta {
  id: string;
  before: number;
  delta: number;
  after: number;
}

export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < CONFIG.ELO_PROVISIONAL_GAMES ? CONFIG.ELO_K_PROVISIONAL : CONFIG.ELO_K;
}

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

export function duelDelta(rating: number, oppRating: number, score: number, gamesPlayed: number): number {
  const k = kFactor(gamesPlayed);
  return Math.round(k * (score - expectedScore(rating, oppRating)));
}

export function applyDuel(
  a: { id: string; rating: number; games: number },
  b: { id: string; rating: number; games: number },
  winnerId: string,
): EloDelta[] {
  const aScore = winnerId === a.id ? 1 : 0;
  const bScore = winnerId === b.id ? 1 : 0;
  const dA = duelDelta(a.rating, b.rating, aScore, a.games);
  const dB = duelDelta(b.rating, a.rating, bScore, b.games);
  return [
    { id: a.id, before: a.rating, delta: dA, after: a.rating + dA },
    { id: b.id, before: b.rating, delta: dB, after: b.rating + dB },
  ];
}

export function applyFfa(players: EloPlayer[]): EloDelta[] {
  return players.map((p) => {
    const kPrime = kFactor(p.games) / (players.length - 1);
    let delta = 0;
    for (const o of players) {
      if (o.id === p.id) continue;
      const s = p.placement < o.placement ? 1 : p.placement === o.placement ? 0.5 : 0;
      delta += kPrime * (s - expectedScore(p.rating, o.rating));
    }
    const rounded = Math.round(delta);
    return { id: p.id, before: p.rating, delta: rounded, after: p.rating + rounded };
  });
}

export function placementsFromScores(
  rows: { id: string; roundWins: number; soaks: number }[],
): { id: string; placement: number }[] {
  const sorted = [...rows].sort((a, b) => b.roundWins - a.roundWins || b.soaks - a.soaks || (a.id < b.id ? -1 : 1));
  const out: { id: string; placement: number }[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (
      j < sorted.length &&
      sorted[j]!.roundWins === sorted[i]!.roundWins &&
      sorted[j]!.soaks === sorted[i]!.soaks
    ) {
      j += 1;
    }
    for (let k = i; k < j; k++) out.push({ id: sorted[k]!.id, placement: i + 1 });
    i = j;
  }
  return out;
}
