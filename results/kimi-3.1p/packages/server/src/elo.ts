import { CONFIG, duelDeltas, ffaDeltas } from "@splash/shared";
import type { GameMode, RatingInfo } from "@splash/shared";

export interface PlacementParticipant {
  playerId: string;
  accountId: string;
  roundsWon: number;
  soaks: number;
  forfeited: boolean;
}

export interface RatedParticipant extends PlacementParticipant {
  rating: RatingInfo;
}

export function rankPlacements<T extends PlacementParticipant>(participants: T[]): Map<string, number> {
  const sorted = [...participants].sort((a, b) => {
    if (a.forfeited !== b.forfeited) return a.forfeited ? 1 : -1;
    if (a.roundsWon !== b.roundsWon) return b.roundsWon - a.roundsWon;
    return b.soaks - a.soaks;
  });
  const placements = new Map<string, number>();
  sorted.forEach((participant, index) => {
    if (participant.forfeited) {
      placements.set(participant.playerId, sorted.length);
      return;
    }
    const previous = sorted[index - 1];
    const tied = previous && !previous.forfeited && previous.roundsWon === participant.roundsWon && previous.soaks === participant.soaks;
    placements.set(participant.playerId, tied ? placements.get(previous.playerId) ?? index + 1 : index + 1);
  });
  return placements;
}

export function ratingChanges(participants: RatedParticipant[], mode: GameMode, placements: Map<string, number>) {
  const before = new Map<string, number>();
  const after = new Map<string, number>();
  const deltas: Record<string, number> = {};
  if (participants.length === 0) return { before, after, deltas };
  if (mode === "duel" && participants.length === 2) {
    const [a, b] = participants;
    const [deltaA, deltaB] = duelDeltas(a.rating.rating, b.rating.rating, (placements.get(a.playerId) ?? 2) < (placements.get(b.playerId) ?? 2) ? 1 : 0, a.rating.games, b.rating.games);
    before.set(a.playerId, a.rating.rating);
    before.set(b.playerId, b.rating.rating);
    after.set(a.playerId, a.rating.rating + deltaA);
    after.set(b.playerId, b.rating.rating + deltaB);
    deltas[a.playerId] = deltaA;
    deltas[b.playerId] = deltaB;
  } else if (mode === "ffa" && participants.length === 4) {
    const changes = ffaDeltas(participants.map((player) => player.rating.rating), participants.map((player) => placements.get(player.playerId) ?? 4), participants.map((player) => player.rating.games));
    participants.forEach((player, index) => {
      before.set(player.playerId, player.rating.rating);
      after.set(player.playerId, player.rating.rating + changes[index]);
      deltas[player.playerId] = changes[index];
    });
  }
  return { before, after, deltas };
}

export function xpForMatch(placement: number, soaks: number, castles: number): number {
  return CONFIG.XP.PARTICIPATION + (CONFIG.XP.PLACEMENT[placement - 1] ?? 0) + soaks * CONFIG.XP.SOAK + castles * CONFIG.XP.CASTLE;
}
