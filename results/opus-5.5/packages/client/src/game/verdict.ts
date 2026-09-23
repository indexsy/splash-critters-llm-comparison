// Who won the match, as far as the client can tell. The server ranks players by round wins,
// then total soaks, with forfeited players always last (shared computePlacements). When the
// final round ends the client knows the round wins: a unique top count among the players still
// in the match decides it. A tie on round wins is settled by soaks, which only match_end's
// placements carry, so the verdict stays pending until then.
import type { PlacementEntry } from '@splash/shared';

export type MatchVerdict =
  | { kind: 'winner'; slot: number }
  /** Several players share 1st place; `all` when nobody placed below them (a drawn match). */
  | { kind: 'shared'; slots: number[]; all: boolean }
  /** Tied on round wins: wait for match_end's placements. */
  | { kind: 'pending' };

/** Verdict from the final round wins of the players still in the match (`contenders`). */
export function verdictFromScores(scores: readonly number[], contenders: readonly number[]): MatchVerdict {
  if (contenders.length === 0) return { kind: 'pending' };
  const best = Math.max(...contenders.map((slot) => scores[slot] ?? 0));
  const top = contenders.filter((slot) => (scores[slot] ?? 0) === best);
  return top.length === 1 ? { kind: 'winner', slot: top[0] } : { kind: 'pending' };
}

/** Verdict from match_end's placements (authoritative, soak tiebreak included). */
export function verdictFromPlacements(placements: readonly Pick<PlacementEntry, 'slot' | 'placement'>[]): MatchVerdict {
  const first = placements.filter((p) => p.placement === 1).map((p) => p.slot);
  if (first.length === 0) return { kind: 'pending' };
  if (first.length === 1) return { kind: 'winner', slot: first[0] };
  return { kind: 'shared', slots: first, all: first.length === placements.length };
}
