import { CONFIG, tierForRating } from "./config.js";

export interface EloPlayer { id: string; rating: number; games: number; placement?: number }
export interface EloResult { id: string; before: number; after: number; delta: number }

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export function kFactor(games: number): number {
  return games < CONFIG.PROVISIONAL_GAMES ? CONFIG.PROVISIONAL_K : CONFIG.STANDARD_K;
}

export function duelElo(a: EloPlayer, b: EloPlayer, winnerId: string): EloResult[] {
  const deltaA = Math.round(kFactor(a.games) * ((winnerId === a.id ? 1 : 0) - expectedScore(a.rating, b.rating)));
  const deltaB = Math.round(kFactor(b.games) * ((winnerId === b.id ? 1 : 0) - expectedScore(b.rating, a.rating)));
  return [
    { id: a.id, before: a.rating, after: a.rating + deltaA, delta: deltaA },
    { id: b.id, before: b.rating, after: b.rating + deltaB, delta: deltaB }
  ];
}

export function ffaElo(players: readonly EloPlayer[]): EloResult[] {
  if (players.length !== 4 || players.some((player) => player.placement === undefined)) throw new Error("FFA Elo requires four placed players");
  return players.map((player) => {
    let rawDelta = 0;
    for (const opponent of players) {
      if (opponent.id === player.id) continue;
      const score = player.placement! < opponent.placement! ? 1 : player.placement === opponent.placement ? 0.5 : 0;
      rawDelta += (kFactor(player.games) / 3) * (score - expectedScore(player.rating, opponent.rating));
    }
    const delta = Math.round(rawDelta);
    return { id: player.id, before: player.rating, after: player.rating + delta, delta };
  });
}

export function ratingTier(rating: number): string {
  return tierForRating(rating);
}
