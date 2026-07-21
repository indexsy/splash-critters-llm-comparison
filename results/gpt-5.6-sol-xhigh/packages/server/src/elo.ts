import type Database from "better-sqlite3";
import { duelElo, ffaElo, type EloPlayer, type EloResult } from "@splash/shared";
import type { Mode } from "@splash/shared";
import { getRating, applyRatingResult, recordPairwise } from "./db/queries.js";

export interface PlayerSlot {
  playerId: string;
  rating: number;
  games: number;
  placement: number;
  bot?: boolean;
}

export interface AppliedElo {
  results: EloResult[];
  byPlayer: Map<string, EloResult>;
}

export function applyDuelResult(db: Database.Database, slots: readonly [PlayerSlot, PlayerSlot], winnerId: string | null, mode: Mode): AppliedElo {
  const [a, b] = slots;
  if (!a || !b) throw new Error("duel requires two slots");
  const eloA: EloPlayer = { id: a.playerId, rating: a.rating, games: a.games, placement: a.placement };
  const eloB: EloPlayer = { id: b.playerId, rating: b.rating, games: b.games, placement: b.placement };
  const results = winnerId
    ? duelElo(eloA, eloB, winnerId)
    : [
        { id: a.playerId, before: a.rating, after: a.rating, delta: 0 },
        { id: b.playerId, before: b.rating, after: b.rating, delta: 0 }
      ];
  persistElo(db, mode, results, a, b, winnerId);
  return { results, byPlayer: new Map(results.map((r) => [r.id, r])) };
}

export function applyFfaResult(db: Database.Database, slots: readonly [PlayerSlot, PlayerSlot, PlayerSlot, PlayerSlot], mode: Mode): AppliedElo {
  if (slots.length !== 4) throw new Error("ffa requires four slots");
  const eloPlayers: EloPlayer[] = slots.map((s) => ({
    id: s.playerId, rating: s.rating, games: s.games, placement: s.placement
  }));
  const results = ffaElo(eloPlayers);
  persistFfaElo(db, mode, results, slots);
  return { results, byPlayer: new Map(results.map((r) => [r.id, r])) };
}

function persistElo(db: Database.Database, mode: Mode, results: EloResult[], a: PlayerSlot, b: PlayerSlot, winnerId: string | null): void {
  for (const r of results) {
    const won = winnerId === null ? null : winnerId === r.id;
    applyRatingResult(db, r.id, mode, r.before, r.after, won);
  }
  const outcome: "a" | "b" | "draw" = winnerId === null ? "draw" : winnerId === a.playerId ? "a" : "b";
  recordPairwise(db, a.playerId, b.playerId, mode, outcome);
}

function persistFfaElo(db: Database.Database, mode: Mode, results: EloResult[], slots: readonly PlayerSlot[]): void {
  for (const r of results) {
    const slot = slots.find((s) => s.playerId === r.id);
    const won = slot ? slot.placement === 1 : null;
    applyRatingResult(db, r.id, mode, r.before, r.after, won);
  }
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i]!;
      const b = slots[j]!;
      const outcome: "a" | "b" | "draw" = a.placement < b.placement ? "a" : a.placement > b.placement ? "b" : "draw";
      recordPairwise(db, a.playerId, b.playerId, mode, outcome);
    }
  }
}

export function loadRatingForMode(db: Database.Database, playerId: string, mode: Mode): { rating: number; games: number } {
  const r = getRating(db, playerId, mode);
  return { rating: r.rating, games: r.games };
}
