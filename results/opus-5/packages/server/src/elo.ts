/**
 * Turning a finished match into consequences: ratings, XP, unlocks, history.
 *
 * The maths lives in @splash/shared (pure, tested); this module is the part
 * that reads the players' before-state, applies the results and writes them
 * down. It is the only place the match ever meets the database.
 */

import {
  CONFIG,
  applyDelta,
  computeEloDeltas,
  tierForRating,
  type AwardEntry,
  type EloEntry,
  type MatchAwards,
  type MatchEndMsg,
  type MatchPlacement,
  type RankTierId,
} from '@splash/shared';
import type { MatchSlotResult } from './match.js';
import type { MatchResultRow, PlayerService } from './players.js';
import type { Room } from './room.js';

/** One slot's outcome after rating and progression have been applied. */
export interface FinalisedPlayer {
  result: MatchSlotResult;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  tier: RankTierId | null;
  xpEarned: number;
  levelBefore: number;
  levelAfter: number;
  unlocked: string[];
}

/** A human slot, narrowed so the account id is no longer nullable. */
interface HumanResult {
  result: MatchSlotResult;
  playerId: string;
}

function humansOf(results: readonly MatchSlotResult[]): HumanResult[] {
  const humans: HumanResult[] = [];
  for (const result of results) {
    if (result.isBot || result.playerId === null) continue;
    humans.push({ result, playerId: result.playerId });
  }
  return humans;
}

function xpFor(result: MatchSlotResult): number {
  const placementXp = CONFIG.XP_PLACEMENT[result.placement - 1] ?? 0;
  return (
    CONFIG.XP_PARTICIPATION +
    placementXp +
    result.soaks * CONFIG.XP_PER_SOAK +
    result.castles * CONFIG.XP_PER_CASTLE +
    result.roundsWon * CONFIG.XP_PER_ROUND_WIN
  );
}

interface RatingChange {
  before: number;
  after: number;
  delta: number;
  tier: RankTierId;
}

/**
 * Ranked only, and only between humans: bots have no rating to stake. A lone
 * human (everyone else walked) has nobody to take points from, so nothing moves.
 */
function applyRatings(
  players: PlayerService,
  room: Room,
  humans: readonly HumanResult[],
): Map<number, RatingChange> {
  const changes = new Map<number, RatingChange>();
  if (!room.ranked || humans.length < 2) return changes;

  const before = humans.map((h) => players.getRating(h.playerId, room.mode));
  const entries: EloEntry[] = humans.map((h, i) => ({
    rating: before[i].rating,
    games: before[i].games,
    placement: h.result.placement,
  }));
  const deltas = computeEloDeltas(entries);

  humans.forEach((human, i) => {
    const after = applyDelta(before[i].rating, deltas[i]);
    players.applyRating(human.playerId, room.mode, after, human.result.placement === 1);
    changes.set(human.result.slot, {
      before: before[i].rating,
      after,
      delta: deltas[i],
      tier: tierForRating(after).id,
    });
  });
  return changes;
}

function finalisePlayers(
  players: PlayerService,
  room: Room,
  results: readonly MatchSlotResult[],
): FinalisedPlayer[] {
  const humans = humansOf(results);
  const ratings = applyRatings(players, room, humans);
  const byPlayer = new Map(humans.map((h) => [h.result.slot, h.playerId]));

  return results.map((result) => {
    const playerId = byPlayer.get(result.slot);
    const rating = ratings.get(result.slot) ?? null;

    if (playerId === undefined) {
      return {
        result,
        ratingBefore: null,
        ratingAfter: null,
        ratingDelta: null,
        tier: null,
        xpEarned: 0,
        levelBefore: 0,
        levelAfter: 0,
        unlocked: [],
      };
    }

    const xpEarned = xpFor(result);
    const award = players.awardXp(playerId, xpEarned);
    return {
      result,
      ratingBefore: rating?.before ?? null,
      ratingAfter: rating?.after ?? null,
      ratingDelta: rating?.delta ?? null,
      tier: rating?.tier ?? null,
      xpEarned,
      levelBefore: award.levelBefore,
      levelAfter: award.levelAfter,
      unlocked: award.unlocked,
    };
  });
}

function toPlacement(entry: FinalisedPlayer): MatchPlacement {
  const r = entry.result;
  return {
    slot: r.slot,
    playerId: r.playerId,
    nickname: r.nickname,
    tag: r.tag,
    animal: r.animal,
    hat: r.hat,
    placement: r.placement,
    roundsWon: r.roundsWon,
    soaks: r.soaks,
    castles: r.castles,
    bestChain: r.bestChain,
    ratingBefore: entry.ratingBefore,
    ratingAfter: entry.ratingAfter,
    ratingDelta: entry.ratingDelta,
    tier: entry.tier,
    xpEarned: entry.xpEarned,
    levelBefore: entry.levelBefore,
    levelAfter: entry.levelAfter,
    unlocked: entry.unlocked,
  };
}

/** Best value wins, ties go to the lower slot, and nobody wins for doing nothing. */
function bestBy(
  results: readonly MatchSlotResult[],
  value: (r: MatchSlotResult) => number,
): AwardEntry | null {
  let best: MatchSlotResult | null = null;
  let bestValue = 0;
  for (const result of results) {
    const current = value(result);
    if (current <= bestValue) continue;
    best = result;
    bestValue = current;
  }
  if (best === null) return null;
  return { slot: best.slot, nickname: best.nickname, value: bestValue };
}

function buildAwards(results: readonly MatchSlotResult[]): MatchAwards {
  // Sorted by slot so a tie is decided by seat, not by placement order.
  const bySlot = [...results].sort((a, b) => a.slot - b.slot);
  return {
    mostSoaks: bestBy(bySlot, (r) => r.soaks),
    castleCrusher: bestBy(bySlot, (r) => r.castles),
    longestSurvivor: bestBy(bySlot, (r) => r.survivedTicks),
    biggestChain: bestBy(bySlot, (r) => r.bestChain),
  };
}

function persist(
  players: PlayerService,
  room: Room,
  finalised: readonly FinalisedPlayer[],
  startedAt: number,
): string | null {
  const rows: MatchResultRow[] = [];
  for (const entry of finalised) {
    const playerId = entry.result.playerId;
    if (entry.result.isBot || playerId === null) continue;
    rows.push({
      playerId,
      placement: entry.result.placement,
      soaks: entry.result.soaks,
      roundsWon: entry.result.roundsWon,
      ratingBefore: entry.ratingBefore,
      ratingAfter: entry.ratingAfter,
      xpEarned: entry.xpEarned,
    });
  }
  if (rows.length === 0) return null;

  return players.recordMatch({
    mode: room.mode,
    ranked: room.ranked,
    startedAt,
    endedAt: Date.now(),
    rows,
  });
}

/**
 * Applies Elo and XP, writes the match to history and returns the packet the
 * results screen is built from. Call exactly once per match.
 */
export function finaliseMatch(
  players: PlayerService,
  room: Room,
  results: MatchSlotResult[],
  startedAt: number,
): MatchEndMsg {
  const finalised = finalisePlayers(players, room, results);
  const persistedId = persist(players, room, finalised, startedAt);

  return {
    t: 'match_end',
    // The stored id when there is history to point at, so the results screen and
    // the profile page agree on what this match was called.
    matchId: persistedId ?? room.match?.matchId ?? `unsaved-${startedAt}`,
    ranked: room.ranked,
    placements: finalised.map(toPlacement),
    awards: buildAwards(results),
    rematchEnabled: !room.ranked && !room.tutorial,
  };
}
