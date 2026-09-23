// Pure validation of the REST payloads the leaderboard screen reads. The server returns
// LeaderboardEntry[] (bare or as { entries }) and a PublicProfile (bare or as { profile });
// anything malformed is rejected so the screen shows its error state instead of crashing.
import type { LeaderboardEntry, PublicProfile, RecentMatch } from '@splash/shared';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isEntry(v: unknown): v is LeaderboardEntry {
  return (
    isObject(v) &&
    typeof v.playerId === 'string' &&
    typeof v.nickname === 'string' &&
    isNum(v.rank) &&
    isNum(v.rating) &&
    isNum(v.games) &&
    typeof v.tier === 'string'
  );
}

/** Leaderboard rows from a response body, or null when the body is not a leaderboard. */
export function parseLeaderboard(body: unknown): LeaderboardEntry[] | null {
  const list = Array.isArray(body) ? body : isObject(body) && Array.isArray(body.entries) ? body.entries : null;
  if (!list) return null;
  return list.filter(isEntry).map((e) => ({
    ...e,
    tag: typeof e.tag === 'string' ? e.tag : '',
    wins: isNum(e.wins) ? e.wins : 0,
    winrate: isNum(e.winrate) ? e.winrate : e.games > 0 && isNum(e.wins) ? e.wins / e.games : 0,
    animal: typeof e.animal === 'string' ? e.animal : 'frog',
  }));
}

function isRecentMatch(v: unknown): v is RecentMatch {
  return isObject(v) && typeof v.matchId === 'string' && (v.mode === 'duel' || v.mode === 'ffa') && isNum(v.placement);
}

/** A public profile from a response body, or null when it is not one. */
export function parsePublicProfile(body: unknown): PublicProfile | null {
  const p = isObject(body) && isObject(body.profile) ? body.profile : body;
  if (!isObject(p) || typeof p.id !== 'string' || typeof p.nickname !== 'string' || !isObject(p.ratings)) return null;
  const ratings = p.ratings as Record<string, unknown>;
  if (!isObject(ratings.duel) || !isObject(ratings.ffa)) return null;
  const profile = p as unknown as PublicProfile;
  return {
    ...profile,
    recentMatches: Array.isArray(p.recentMatches) ? p.recentMatches.filter(isRecentMatch) : [],
  };
}
