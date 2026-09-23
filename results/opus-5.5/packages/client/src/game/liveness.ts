// Is there a match to show? The store keeps the last match config (and its match_end) after
// the match finishes so the results screen can read it; only a match without its own
// match_end is still being played.
import type { MatchConfig, MatchEndMsg } from '@splash/shared';

export type MatchLiveness = 'none' | 'live' | 'ended';

export function matchLiveness(match: Pick<MatchConfig, 'matchId'> | null, matchEnd: Pick<MatchEndMsg, 'matchId'> | null): MatchLiveness {
  if (!match) return 'none';
  return matchEnd?.matchId === match.matchId ? 'ended' : 'live';
}
