import { applyDuelElo, applyFfaElo, type EloPlayer, type EloResult, type Mode } from "@splash/shared";
import type Database from "better-sqlite3";
import { updateRating } from "./db/index.js";

export function computeElo(
  mode: Mode,
  players: EloPlayer[],
): EloResult[] {
  if (mode === "duel" && players.length === 2) {
    const sorted = [...players].sort((a, b) => a.placement - b.placement);
    return applyDuelElo(sorted[0]!, sorted[1]!);
  }
  return applyFfaElo(players);
}

export function persistElo(db: Database.Database, mode: Mode, results: EloResult[], winnerId: string | undefined): void {
  for (const r of results) {
    updateRating(db, r.id, mode, r.after, r.id === winnerId);
  }
}
