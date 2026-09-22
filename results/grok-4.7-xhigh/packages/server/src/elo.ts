import {
  applyDelta,
  assignPlacements,
  duelDeltas,
  ffaDeltas,
  matchXp,
  tierFor,
  type Mode,
} from '@splash/shared';
import type { Queries } from './db/queries.js';

export interface ResultPlayer {
  id: string;
  isBot: boolean;
  roundWins: number;
  soaks: number;
  name: string;
  animal: string;
  hat: string | null;
  castles: number;
  revengeSoaks: number;
  survivedTicks: number;
  longestLife: number;
  biggestChain: number;
}

export function settleMatch(
  q: Queries,
  opts: {
    matchId: string;
    mode: Mode;
    ranked: boolean;
    startedAt: number;
    players: ResultPlayer[];
    placementOverride?: Map<string, number>;
  },
) {
  const placements =
    opts.placementOverride ??
    assignPlacements(opts.players.map((p) => ({ id: p.id, roundWins: p.roundWins, soaks: p.soaks })));
  const humans = opts.players.filter((p) => !p.isBot);
  const ratingBefore = new Map<string, { rating: number; games: number }>();
  for (const p of humans) {
    const view = q.ratingView(p.id, opts.mode);
    ratingBefore.set(p.id, { rating: view.rating, games: view.games });
  }
  const deltas = new Map<string, number>();
  if (opts.ranked && humans.length >= 2) {
    if (opts.mode === 'duel' && humans.length === 2) {
      const [a, b] = humans;
      const pa = placements.get(a.id) ?? 1;
      const pb = placements.get(b.id) ?? 2;
      const aWon = pa < pb;
      const ra = ratingBefore.get(a.id)!;
      const rb = ratingBefore.get(b.id)!;
      const d = duelDeltas(ra.rating, rb.rating, ra.games, rb.games, aWon);
      deltas.set(a.id, d.deltaA);
      deltas.set(b.id, d.deltaB);
    } else {
      const eloPlayers = humans.map((p) => ({
        id: p.id,
        rating: ratingBefore.get(p.id)!.rating,
        games: ratingBefore.get(p.id)!.games,
        placement: placements.get(p.id) ?? humans.length,
      }));
      const d = ffaDeltas(eloPlayers);
      for (const [id, delta] of Object.entries(d)) deltas.set(id, delta);
    }
  }
  const recorded = opts.players
    .filter((p) => !p.isBot)
    .map((p) => {
      const before = ratingBefore.get(p.id);
      const delta = deltas.get(p.id) ?? 0;
      const after = opts.ranked && before ? applyDelta(before.rating, delta) : null;
      const place = placements.get(p.id) ?? opts.players.length;
      const xp = matchXp(place, p.soaks, p.castles);
      return {
        id: p.id,
        placement: place,
        soaks: p.soaks,
        roundsWon: p.roundWins,
        ratingBefore: opts.ranked ? before?.rating ?? null : null,
        ratingAfter: after,
        xp,
        win: place === 1,
      };
    });
  q.recordMatch({
    id: opts.matchId,
    mode: opts.mode,
    ranked: opts.ranked,
    startedAt: opts.startedAt,
    players: recorded,
  });
  return { placements, recorded };
}

export { tierFor };
