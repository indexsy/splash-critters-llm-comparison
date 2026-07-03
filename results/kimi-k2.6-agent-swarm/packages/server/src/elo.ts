import { calculateDuelElo, calculateFFAElo } from '@splash-critters/shared';
import type { MatchResult, PlayerId, QueueMode } from '@splash-critters/shared';
import type { DatabaseInstance } from './db/queries.js';
import { getRatings, updateRatings } from './db/queries.js';

export function applyMatchElo(
  db: DatabaseInstance,
  matchResult: MatchResult,
  mode: QueueMode
): void {
  const playerIds = matchResult.placements;
  if (playerIds.length === 0) return;

  const ratingsBefore = new Map<PlayerId, number>();
  const gamesPlayed = new Map<PlayerId, number>();

  for (const playerId of playerIds) {
    const numId = Number(playerId);
    const rows = getRatings(db, numId);
    const row = rows.find((r) => r.mode === mode);
    ratingsBefore.set(playerId, row?.rating ?? 1000);
    gamesPlayed.set(playerId, row?.games ?? 0);
  }

  const ratings = playerIds.map((id) => ratingsBefore.get(id)!);
  const games = playerIds.map((id) => gamesPlayed.get(id)!);

  let deltas: number[] = [];
  let newRatings: number[] = [];

  if (mode === 'duel' && playerIds.length === 2) {
    const winner = matchResult.placements[0];
    const loser = matchResult.placements[1];
    const winnerRating = ratingsBefore.get(winner)!;
    const loserRating = ratingsBefore.get(loser)!;
    const winnerGames = gamesPlayed.get(winner)!;
    const loserGames = gamesPlayed.get(loser)!;
    const result = calculateDuelElo(
      winnerRating,
      loserRating,
      winnerGames,
      loserGames
    );
    const winnerIdx = playerIds.indexOf(winner);
    const loserIdx = playerIds.indexOf(loser);
    newRatings = [...ratings];
    newRatings[winnerIdx] = result.winnerNew;
    newRatings[loserIdx] = result.loserNew;
    deltas = new Array(playerIds.length).fill(0);
    deltas[winnerIdx] = result.delta;
    deltas[loserIdx] = result.loserNew - loserRating;
  } else {
    // FFA pairwise Elo
    const result = calculateFFAElo(
      ratings,
      games,
      Array.from({ length: playerIds.length }, (_, i) => i + 1)
    );
    newRatings = result.newRatings;
    deltas = result.deltas;
  }

  for (let i = 0; i < playerIds.length; i++) {
    const playerId = playerIds[i];
    matchResult.ratingDeltas[playerId] = deltas[i];

    const numId = Number(playerId);
    const isWin = i === 0; // First placement is winner
    updateRatings(db, numId, mode, newRatings[i], isWin);
  }
}

export function getPlayerRating(
  db: DatabaseInstance,
  playerId: PlayerId,
  mode: QueueMode
): number {
  const rows = getRatings(db, Number(playerId));
  const row = rows.find((r) => r.mode === mode);
  return row?.rating ?? 1000;
}
