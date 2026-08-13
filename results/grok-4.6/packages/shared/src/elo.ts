import { CONFIG, tierForRating } from "./config.js";

export interface EloPlayer {
  id: string;
  rating: number;
  games: number;
  placement: number;
}

export interface EloResult {
  id: string;
  before: number;
  after: number;
  delta: number;
}

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

export function kFactor(games: number): number {
  return games < CONFIG.ELO_PROVISIONAL_GAMES ? CONFIG.ELO_K_PROVISIONAL : CONFIG.ELO_K_STANDARD;
}

export function applyDuelElo(winner: EloPlayer, loser: EloPlayer): EloResult[] {
  const kw = kFactor(winner.games);
  const kl = kFactor(loser.games);
  const ew = expectedScore(winner.rating, loser.rating);
  const el = expectedScore(loser.rating, winner.rating);
  const dw = Math.round(kw * (1 - ew));
  const dl = Math.round(kl * (0 - el));
  return [
    { id: winner.id, before: winner.rating, after: winner.rating + dw, delta: dw },
    { id: loser.id, before: loser.rating, after: loser.rating + dl, delta: dl },
  ];
}

export function applyFfaElo(players: EloPlayer[]): EloResult[] {
  const results: EloResult[] = players.map((p) => ({
    id: p.id,
    before: p.rating,
    after: p.rating,
    delta: 0,
  }));
  for (let i = 0; i < players.length; i++) {
    const a = players[i]!;
    const kPrime = kFactor(a.games) / 3;
    let delta = 0;
    for (let j = 0; j < players.length; j++) {
      if (i === j) continue;
      const b = players[j]!;
      let s = 0.5;
      if (a.placement < b.placement) s = 1;
      else if (a.placement > b.placement) s = 0;
      const e = expectedScore(a.rating, b.rating);
      delta += kPrime * (s - e);
    }
    const rounded = Math.round(delta);
    results[i] = {
      id: a.id,
      before: a.rating,
      after: a.rating + rounded,
      delta: rounded,
    };
  }
  return results;
}

export { tierForRating };
