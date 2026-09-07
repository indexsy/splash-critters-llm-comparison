import { CONFIG } from "./config.js";

export interface EloPlayer {
  id: string;
  rating: number;
  games: number;
  placement: number;
}
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}
export function calculateElo(players: EloPlayer[]): Record<string, number> {
  if (players.length < 2) throw new Error("Elo requires at least two players");
  if (
    new Set(players.map((p) => p.id)).size !== players.length ||
    players.some(
      (p) => !Number.isFinite(p.rating) || p.games < 0 || p.placement < 1,
    )
  )
    throw new Error("Invalid Elo players");
  return Object.fromEntries(
    players.map((player) => {
      const k =
        player.games < CONFIG.ELO_PROVISIONAL_GAMES
          ? CONFIG.ELO_K_PROVISIONAL
          : CONFIG.ELO_K;
      let delta = 0;
      for (const opponent of players)
        if (opponent.id !== player.id) {
          const score =
            player.placement === opponent.placement
              ? 0.5
              : player.placement < opponent.placement
                ? 1
                : 0;
          delta +=
            (k / (players.length - 1)) *
            (score - expectedScore(player.rating, opponent.rating));
        }
      return [player.id, Math.round(delta) || 0];
    }),
  );
}
