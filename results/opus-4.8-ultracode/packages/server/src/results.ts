/**
 * Match finalization: placements, fun-stat awards, Elo (ranked), XP, and
 * persistence. Returns the MatchResult broadcast to clients.
 */

import {
  CONFIG,
  duelDeltas,
  ffaDeltas,
  placementsFromResults,
  tierForRating,
  type AwardDTO,
  type MatchResult,
  type PlacementDTO,
} from '@splash/shared';
import type { ServerContext } from './context';
import { computeXp } from './progression';
import type { Match } from './match';

interface SlotResult {
  slot: number;
  playerId: string;
  name: string;
  animal: PlacementDTO['animal'];
  isBot: boolean;
  roundWins: number;
  soaks: number;
  castles: number;
  forfeited: boolean;
  placement: number;
}

export function finalizeMatch(ctx: ServerContext, match: Match): MatchResult {
  const cfg = match.config;
  const n = cfg.players.length;

  const rows: SlotResult[] = cfg.players.map((p) => {
    const forfeited = match.room.slots.find((s) => s.index === p.slot)?.forfeited ?? false;
    return {
      slot: p.slot,
      playerId: p.id,
      name: p.name,
      animal: p.animal,
      isBot: p.isBot,
      roundWins: match.roundWins[p.slot] ?? 0,
      soaks: match.totalSoaks[p.slot] ?? 0,
      castles: match.totalCastles[p.slot] ?? 0,
      forfeited,
      placement: 1,
    };
  });

  // placement (forfeited sink to the bottom)
  const placements = placementsFromResults(
    rows.map((r) => ({ roundWins: r.forfeited ? -1 : r.roundWins, soaks: r.soaks })),
  );
  rows.forEach((r, i) => (r.placement = placements[i]));

  const ratingDelta = new Map<number, { before: number; after: number }>();

  if (cfg.ranked) {
    computeRankedElo(ctx, match, rows, ratingDelta);
  }

  const matchId = ctx.q.insertMatch(cfg.mode, cfg.ranked, match.startedAtMs);

  const placementDTOs: PlacementDTO[] = rows.map((r) => {
    const rd = ratingDelta.get(r.slot);
    let xpEarned = 0;
    let levelBefore = 1;
    let levelAfter = 1;

    if (!r.isBot) {
      const before = ctx.q.getById(r.playerId);
      levelBefore = before?.level ?? 1;
      xpEarned = computeXp({
        participated: true,
        placement: r.placement,
        soaks: r.soaks,
        castlesWashed: r.castles,
        roundsWon: r.roundWins,
      });
      const res = ctx.q.addXp(r.playerId, xpEarned);
      levelAfter = res.level;

      ctx.q.insertMatchPlayer({
        matchId,
        playerId: r.playerId,
        placement: r.placement,
        soaks: r.soaks,
        roundsWon: r.roundWins,
        ratingBefore: rd?.before ?? null,
        ratingAfter: rd?.after ?? null,
        xpEarned,
      });

      const client = ctx.byId.get(r.playerId);
      if (client) {
        client.send({
          type: 'xp_award',
          xp: res.xp,
          level: res.level,
          leveledUp: res.leveledUp,
          unlocked: res.unlocked,
        });
        const prof = ctx.q.buildProfile(r.playerId);
        if (prof) {
          client.profile = prof;
          client.send({ type: 'profile', profile: prof });
        }
      }
    }

    return {
      slot: r.slot,
      playerId: r.playerId,
      name: r.name,
      animal: r.animal,
      placement: r.placement,
      roundWins: r.roundWins,
      soaks: r.soaks,
      castlesWashed: r.castles,
      ratingBefore: rd?.before ?? null,
      ratingAfter: rd?.after ?? null,
      ratingDelta: rd ? rd.after - rd.before : null,
      tierName: rd ? tierForRating(rd.after).name : undefined,
      xpEarned,
      levelBefore,
      levelAfter,
    };
  });

  ctx.q.endMatch(matchId, Date.now());

  return {
    mode: cfg.mode,
    ranked: cfg.ranked,
    placements: placementDTOs.sort((a, b) => a.placement - b.placement),
    awards: buildAwards(match, rows),
  };
}



function computeRankedElo(
  ctx: ServerContext,
  match: Match,
  rows: SlotResult[],
  out: Map<number, { before: number; after: number }>,
): void {
  const mode = match.config.mode;
  const humans = rows.filter((r) => !r.isBot);
  const ratingOf = new Map<number, { rating: number; games: number; wins: number; peak: number }>();
  for (const r of humans) {
    const rr = ctx.q.getRating(r.playerId, mode);
    ratingOf.set(r.slot, { rating: rr.rating, games: rr.games, wins: rr.wins, peak: rr.peak });
  }

  const deltas = new Map<number, number>();
  if (mode === 'duel' && humans.length === 2) {
    const [a, b] = humans;
    const winner = a.placement <= b.placement ? a : b;
    const loser = winner === a ? b : a;
    const rw = ratingOf.get(winner.slot)!;
    const rl = ratingOf.get(loser.slot)!;
    const d = duelDeltas(rw.rating, rl.rating, rw.games, rl.games);
    deltas.set(winner.slot, d.winner);
    deltas.set(loser.slot, d.loser);
  } else {
    const entries = humans.map((r) => {
      const rr = ratingOf.get(r.slot)!;
      return { rating: rr.rating, games: rr.games, placement: r.placement };
    });
    const ds = ffaDeltas(entries);
    humans.forEach((r, i) => deltas.set(r.slot, ds[i]));
  }

  for (const r of humans) {
    const rr = ratingOf.get(r.slot)!;
    const delta = deltas.get(r.slot) ?? 0;
    const after = rr.rating + delta;
    out.set(r.slot, { before: rr.rating, after });
    ctx.q.saveRating({
      player_id: r.playerId,
      mode,
      rating: after,
      games: rr.games + 1,
      wins: rr.wins + (r.placement === 1 ? 1 : 0),
      peak: Math.max(rr.peak, after),
    });
  }
}

function buildAwards(match: Match, rows: SlotResult[]): AwardDTO[] {
  const awards: AwardDTO[] = [];
  const nameOf = (slot: number) => rows.find((r) => r.slot === slot)?.name ?? '?';
  const idOf = (slot: number) => rows.find((r) => r.slot === slot)?.playerId ?? '';

  const bestBy = (vals: number[]): number => {
    let best = -1;
    let bestVal = -1;
    vals.forEach((v, slot) => {
      if (v > bestVal) {
        bestVal = v;
        best = slot;
      }
    });
    return bestVal > 0 ? best : -1;
  };

  const soakSlot = bestBy(match.totalSoaks);
  if (soakSlot >= 0)
    awards.push({ label: 'Most Soaks', playerId: idOf(soakSlot), name: nameOf(soakSlot), value: match.totalSoaks[soakSlot] });

  const castleSlot = bestBy(match.totalCastles);
  if (castleSlot >= 0)
    awards.push({ label: 'Castle Crusher', playerId: idOf(castleSlot), name: nameOf(castleSlot), value: match.totalCastles[castleSlot] });

  const surviveSlot = bestBy(match.survivalTicks);
  if (surviveSlot >= 0)
    awards.push({
      label: 'Longest Survivor',
      playerId: idOf(surviveSlot),
      name: nameOf(surviveSlot),
      value: Math.round(match.survivalTicks[surviveSlot] / CONFIG.TICK_RATE),
    });

  if (match.biggestChain >= 2 && match.biggestChainSlot >= 0)
    awards.push({
      label: 'Biggest Chain',
      playerId: idOf(match.biggestChainSlot),
      name: nameOf(match.biggestChainSlot),
      value: match.biggestChain,
    });

  return awards;
}
