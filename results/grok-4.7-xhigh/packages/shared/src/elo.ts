import { CONFIG, tierFor } from './config.js';

export interface EloPlayer {
  id: string;
  rating: number;
  games: number;
  placement: number;
}

export function kFactor(games: number): number {
  return games < CONFIG.ELO_PROVISIONAL_GAMES ? CONFIG.ELO_K_PROVISIONAL : CONFIG.ELO_K;
}

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

export function applyDelta(rating: number, delta: number): number {
  return Math.max(0, rating + delta);
}

export function duelDeltas(
  ra: number,
  rb: number,
  gamesA: number,
  gamesB: number,
  aWon: boolean,
): { deltaA: number; deltaB: number } {
  const ka = kFactor(gamesA);
  const kb = kFactor(gamesB);
  const ea = expectedScore(ra, rb);
  const eb = expectedScore(rb, ra);
  const sa = aWon ? 1 : 0;
  const sb = aWon ? 0 : 1;
  return { deltaA: ka * (sa - ea), deltaB: kb * (sb - eb) };
}

export function ffaDeltas(players: EloPlayer[]): Record<string, number> {
  const deltas: Record<string, number> = {};
  for (const p of players) deltas[p.id] = 0;
  const n = players.length;
  if (n < 2) return deltas;
  for (const p of players) {
    const kp = kFactor(p.games) / (n - 1);
    for (const o of players) {
      if (o.id === p.id) continue;
      const s = p.placement < o.placement ? 1 : p.placement > o.placement ? 0 : 0.5;
      const e = expectedScore(p.rating, o.rating);
      deltas[p.id] += kp * (s - e);
    }
  }
  return deltas;
}

export function assignPlacements(
  rows: { id: string; roundWins: number; soaks: number }[],
): Map<string, number> {
  const sorted = [...rows].sort((a, b) => b.roundWins - a.roundWins || b.soaks - a.soaks || a.id.localeCompare(b.id));
  const place = new Map<string, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (
      j < sorted.length &&
      sorted[j].roundWins === sorted[i].roundWins &&
      sorted[j].soaks === sorted[i].soaks
    ) {
      j++;
    }
    const placement = i + 1;
    for (let k = i; k < j; k++) place.set(sorted[k].id, placement);
    i = j;
  }
  return place;
}

export function ratingView(rating: number, games: number, wins: number, peak: number) {
  const tier = tierFor(rating);
  return { rating, games, wins, peak, tier: tier.name, tierId: tier.id, next: tier.next };
}

export { tierFor };
