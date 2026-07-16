import { CONFIG } from './config.js';

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < CONFIG.ELO.NEW_GAMES ? CONFIG.ELO.K_NEW : CONFIG.ELO.K_NORMAL;
}

export function duelDelta(ratingA: number, ratingB: number, aWon: boolean, gamesA: number): number {
  const k = kFactor(gamesA);
  const e = expectedScore(ratingA, ratingB);
  const s = aWon ? 1 : 0;
  return k * (s - e);
}

export interface FfaPlayerResult {
  playerId: string;
  placement: number;
  rating: number;
  games: number;
}

export function ffaDeltas(results: FfaPlayerResult[]): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const r of results) deltas.set(r.playerId, 0);
  const n = results.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = results[i]!;
      const b = results[j]!;
      const ea = expectedScore(a.rating, b.rating);
      let sa: number;
      if (a.placement < b.placement) sa = 1;
      else if (a.placement > b.placement) sa = 0;
      else sa = 0.5;
      const ka = kFactor(a.games) / (n - 1);
      const kb = kFactor(b.games) / (n - 1);
      deltas.set(a.playerId, (deltas.get(a.playerId) ?? 0) + ka * (sa - ea));
      deltas.set(b.playerId, (deltas.get(b.playerId) ?? 0) + kb * ((1 - sa) - (1 - ea)));
    }
  }
  return deltas;
}

export function tierFor(rating: number): string {
  let tier: string = CONFIG.TIERS[0]!.name;
  for (const t of CONFIG.TIERS) {
    if (rating >= t.min) tier = t.name;
  }
  return tier;
}
