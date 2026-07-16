import {
  applyDelta,
  duelDelta,
  ffaDeltas,
  type GameMode,
} from '@splash/shared';
import type { Db } from './db/queries.js';
import { getProfile, updateRating } from './db/queries.js';

export function applyMatchElo(
  db: Db,
  mode: GameMode,
  results: Array<{ playerId: string; placement: number; isBot: boolean }>,
): Record<string, { before: number; after: number; delta: number }> {
  const out: Record<string, { before: number; after: number; delta: number }> = {};
  const humans = results.filter((r) => !r.isBot && !r.playerId.startsWith('bot-'));

  if (humans.length < 2) {
    for (const h of humans) {
      const profile = getProfile(db, h.playerId);
      if (!profile) continue;
      const before = profile.ratings[mode].rating;
      out[h.playerId] = { before, after: before, delta: 0 };
    }
    return out;
  }

  if (mode === 'duel' && humans.length === 2) {
    const [a, b] = humans;
    const pa = getProfile(db, a!.playerId)!;
    const pb = getProfile(db, b!.playerId)!;
    const ra = pa.ratings.duel;
    const rb = pb.ratings.duel;
    const scoreA = a!.placement < b!.placement ? 1 : a!.placement > b!.placement ? 0 : 0.5;
    const dA = duelDelta(ra.rating, rb.rating, scoreA, ra.games);
    const dB = duelDelta(rb.rating, ra.rating, 1 - scoreA, rb.games);
    const afterA = applyDelta(ra.rating, dA);
    const afterB = applyDelta(rb.rating, dB);
    updateRating(db, a!.playerId, 'duel', afterA, scoreA === 1);
    updateRating(db, b!.playerId, 'duel', afterB, scoreA === 0);
    out[a!.playerId] = { before: ra.rating, after: afterA, delta: dA };
    out[b!.playerId] = { before: rb.rating, after: afterB, delta: dB };
    return out;
  }

  // FFA pairwise
  const ffaPlayers = humans.map((h) => {
    const p = getProfile(db, h.playerId)!;
    return {
      id: h.playerId,
      rating: p.ratings.ffa.rating,
      games: p.ratings.ffa.games,
      placement: h.placement,
    };
  });
  const deltas = ffaDeltas(ffaPlayers);
  for (const h of humans) {
    const p = getProfile(db, h.playerId)!;
    const before = p.ratings.ffa.rating;
    const delta = deltas[h.playerId] ?? 0;
    const after = applyDelta(before, delta);
    updateRating(db, h.playerId, 'ffa', after, h.placement === 1);
    out[h.playerId] = { before, after, delta };
  }
  return out;
}
