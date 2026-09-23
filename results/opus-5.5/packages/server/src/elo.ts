// Applies ranked results to stored ratings using the shared Elo math.
import { duelDeltas, ffaDeltas, tierFor } from '@splash/shared';
import type { Mode, RatingDelta } from '@splash/shared';
import { getRating, upsertRating, type Db, type RatingRecord } from './db';

export interface RankedRow {
  playerId: string;
  slot: number;
  /** 1-based final placement; ties share a placement. */
  placement: number;
}

export interface RankedResult {
  mode: Mode;
  rows: RankedRow[];
}

/** Rating deltas in row order: standard Elo for a decided duel, pairwise Elo otherwise (FFA or a drawn duel). */
function computeDeltas(mode: Mode, rows: RankedRow[], current: RatingRecord[]): number[] {
  const [a, b] = current;
  if (mode === 'duel' && rows.length === 2 && rows[0].placement !== rows[1].placement) {
    const aWon = rows[0].placement < rows[1].placement;
    const [winnerDelta, loserDelta] = aWon ? duelDeltas(a, b) : duelDeltas(b, a);
    return aWon ? [winnerDelta, loserDelta] : [loserDelta, winnerDelta];
  }
  return ffaDeltas(current.map((rating, i) => ({ rating: rating.rating, games: rating.games, placement: rows[i].placement })));
}

function assertRankedRows(rows: RankedRow[]): void {
  if (rows.length < 2) throw new Error('applyRankedRatings needs at least 2 players');
  if (new Set(rows.map((row) => row.playerId)).size !== rows.length) {
    throw new Error('applyRankedRatings: duplicate player in results');
  }
}

/**
 * A win is a first place that beat someone. A drawn match (everyone shares 1st, e.g. a duel that
 * hits MAX_ROUNDS level) credits no win; players sharing 1st in FFA above others each win.
 */
function creditsWin(row: RankedRow, rows: RankedRow[]): boolean {
  return row.placement === 1 && rows.some((other) => other.placement > 1);
}

/**
 * Reads each player's current rating in `mode`, computes Elo deltas and stores the new rating,
 * games + 1, wins + 1 for a win (see creditsWin), and peak. Returns one RatingDelta per row, in row order.
 */
export function applyRankedRatings(db: Db, result: RankedResult): RatingDelta[] {
  assertRankedRows(result.rows);
  return db.transaction((): RatingDelta[] => {
    const current = result.rows.map((row) => getRating(db, row.playerId, result.mode));
    const deltas = computeDeltas(result.mode, result.rows, current);
    return result.rows.map((row, i) => {
      const before = current[i];
      const after = before.rating + deltas[i];
      upsertRating(db, {
        playerId: row.playerId,
        mode: result.mode,
        rating: after,
        games: before.games + 1,
        wins: before.wins + (creditsWin(row, result.rows) ? 1 : 0),
        peak: Math.max(before.peak, after),
      });
      return {
        slot: row.slot,
        playerId: row.playerId,
        before: before.rating,
        after,
        delta: deltas[i],
        tierBefore: tierFor(before.rating),
        tierAfter: tierFor(after),
      };
    });
  })();
}
