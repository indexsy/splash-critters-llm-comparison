import { CONFIG } from "./config.js";

export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

export function kFactor(gamesInMode: number): number {
  return gamesInMode < CONFIG.ELO_PROVISIONAL_GAMES ? CONFIG.ELO_K_PROVISIONAL : CONFIG.ELO_K_ESTABLISHED;
}

export function duelDelta(ratingA: number, ratingB: number, scoreA: number, gamesA: number): number {
  const e = expectedScore(ratingA, ratingB);
  return Math.round(kFactor(gamesA) * (scoreA - e));
}

export type Placement = { playerId: string; roundsWon: number; soaks: number };

export function ffaPairwiseDeltas(
  ratings: Record<string, number>,
  games: Record<string, number>,
  placements: Placement[]
): Record<string, number> {
  // Resolve shared placements
  const sorted = [...placements].sort((a, b) => {
    if (a.roundsWon !== b.roundsWon) return b.roundsWon - a.roundsWon;
    if (a.soaks !== b.soaks) return b.soaks - a.soaks;
    return 0;
  });

  const ranks: Record<string, number> = {};
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].roundsWon === sorted[i].roundsWon && sorted[j].soaks === sorted[i].soaks) j++;
    const rank = i + (j - i - 1) / 2 + 1;
    for (let k = i; k < j; k++) ranks[sorted[k].playerId] = rank;
    i = j;
  }

  const deltas: Record<string, number> = {};
  for (const p of placements) deltas[p.playerId] = 0;

  for (const a of placements) {
    for (const b of placements) {
      if (a.playerId === b.playerId) continue;
      const ra = ratings[a.playerId] ?? CONFIG.ELO_START;
      const rb = ratings[b.playerId] ?? CONFIG.ELO_START;
      const rankA = ranks[a.playerId];
      const rankB = ranks[b.playerId];
      let score: number;
      if (rankA < rankB) score = 1;
      else if (rankA > rankB) score = 0;
      else score = 0.5;
      const e = expectedScore(ra, rb);
      const k = kFactor(games[a.playerId] ?? 0) / 3;
      deltas[a.playerId] += Math.round(k * (score - e));
    }
  }

  for (const id of Object.keys(deltas)) {
    deltas[id] = Math.round(deltas[id]);
  }
  return deltas;
}

export function placementsFromRounds(
  roundWins: Record<string, number>,
  soaks: Record<string, number>
): { playerId: string; placement: number }[] {
  const arr = Object.keys(roundWins).map((id) => ({ id, wins: roundWins[id] ?? 0, soaks: soaks[id] ?? 0 }));
  arr.sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.soaks !== b.soaks) return b.soaks - a.soaks;
    return 0;
  });
  return arr.map((x, i) => ({ playerId: x.id, placement: i + 1 }));
}
