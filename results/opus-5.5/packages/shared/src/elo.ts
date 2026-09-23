// Pure Elo math for ranked Duel (standard Elo) and FFA (pairwise Elo), rank tiers and
// match placements. No I/O: the server persists what these functions compute.
import { CONFIG, type TierBand } from './config';
import type { TierId } from './types';

/** The two numbers Elo needs about a player in one mode. */
export interface EloPlayer {
  rating: number;
  /** Ranked games already played in this mode (drives the provisional K-factor). */
  games: number;
}

/** A tier band plus its neighbourhood, for badges and "progress to next tier" bars. */
export interface TierBandInfo extends TierBand {
  /** Exclusive upper bound: the next tier's min, or Infinity for the top tier. */
  max: number;
  /** The tier above this one, or null at the top. */
  next: TierBand | null;
  /**
   * 0..1 progress from this tier's floor toward the next tier (1 at the top tier).
   * The bottom tier has no floor (-Infinity), so its progress is measured over a span as wide
   * as the tier above it (Puddle: 850..1000).
   */
  progress: number;
}

/** Placement input: one row per participant of a finished match. */
export interface PlacementRow {
  slot: number;
  roundsWon: number;
  soaks: number;
  forfeited: boolean;
}

/** Probability that a player rated `ra` beats a player rated `rb`. */
export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/** K = ELO_K_PROVISIONAL for a player's first ELO_PROVISIONAL_GAMES games in a mode, then ELO_K. */
export function kFactor(games: number): number {
  return games < CONFIG.ELO_PROVISIONAL_GAMES ? CONFIG.ELO_K_PROVISIONAL : CONFIG.ELO_K;
}

/** Math.round that never returns -0 (so a zero delta compares equal to 0 everywhere). */
function roundDelta(x: number): number {
  return Math.round(x) + 0;
}

/** Standard Elo for a decided duel. Returns [winnerDelta, loserDelta], each with its own K. */
export function duelDeltas(winner: EloPlayer, loser: EloPlayer): [number, number] {
  const winnerExpected = expectedScore(winner.rating, loser.rating);
  const loserExpected = 1 - winnerExpected;
  return [
    roundDelta(kFactor(winner.games) * (1 - winnerExpected)),
    roundDelta(kFactor(loser.games) * (0 - loserExpected)),
  ];
}

/** Pairwise score of a placement against another: 1 better, 0.5 tie, 0 worse. */
function pairScore(placement: number, otherPlacement: number): number {
  if (placement < otherPlacement) return 1;
  if (placement === otherPlacement) return 0.5;
  return 0;
}

/**
 * Pairwise Elo for N >= 2 players (FFA, or a drawn duel when N = 2).
 * delta_i = sum over j != i of (K_i / (N - 1)) * (S_ij - E_ij), K_i from player i's own games.
 * With N = 4 this is K/3 per opponent. Returned in input order, rounded.
 */
export function ffaDeltas(players: (EloPlayer & { placement: number })[]): number[] {
  const n = players.length;
  if (n < 2) throw new RangeError('ffaDeltas needs at least 2 players');
  return players.map((me, i) => {
    let scoreMinusExpected = 0;
    players.forEach((other, j) => {
      if (i === j) return;
      scoreMinusExpected += pairScore(me.placement, other.placement) - expectedScore(me.rating, other.rating);
    });
    return roundDelta((kFactor(me.games) / (n - 1)) * scoreMinusExpected);
  });
}

/** Index into CONFIG.TIERS of the band containing `rating` (bands are sorted by min). */
function tierIndexFor(rating: number): number {
  let index = 0;
  CONFIG.TIERS.forEach((band, i) => {
    if (rating >= band.min) index = i;
  });
  return index;
}

/** Tier id for a rating: Puddle < 1000 <= Pond < 1150 <= River < 1300 <= Lake < 1500 <= Ocean < 1750 <= Tsunami. */
export function tierFor(rating: number): TierId {
  return CONFIG.TIERS[tierIndexFor(rating)].id;
}

/** Progress span for the open-ended bottom tier when no band above the next one defines a width. */
const BOTTOM_TIER_FALLBACK_SPAN = 150;

/** Where a band's progress bar starts: its own min, or one band-width below the next tier for the bottom band. */
function progressFloor(index: number): number {
  const band = CONFIG.TIERS[index];
  if (Number.isFinite(band.min)) return band.min;
  const next = CONFIG.TIERS[index + 1];
  const afterNext = CONFIG.TIERS[index + 2];
  return next.min - (afterNext ? afterNext.min - next.min : BOTTOM_TIER_FALLBACK_SPAN);
}

/** Full band info for a rating (bounds, next tier, progress toward it). */
export function tierBand(rating: number): TierBandInfo {
  const index = tierIndexFor(rating);
  const band = CONFIG.TIERS[index];
  const next = CONFIG.TIERS[index + 1] ?? null;
  if (!next) return { ...band, max: Infinity, next: null, progress: 1 };
  const floor = progressFloor(index);
  const progress = Math.min(1, Math.max(0, (rating - floor) / (next.min - floor)));
  return { ...band, max: next.min, next, progress };
}

/** Ordering key: non-forfeited first, then round wins desc, then soaks desc. Negative = a ranks higher. */
function comparePlacementRows(a: PlacementRow, b: PlacementRow): number {
  if (a.forfeited !== b.forfeited) return a.forfeited ? 1 : -1;
  if (a.roundsWon !== b.roundsWon) return b.roundsWon - a.roundsWon;
  return b.soaks - a.soaks;
}

/**
 * Final placements by slot using competition ranking (1, 2, 2, 4): round wins desc, then total
 * soaks desc; forfeited rows always rank after every non-forfeited row (ordered among themselves
 * by the same keys); exact ties share a placement.
 */
export function computePlacements(rows: PlacementRow[]): Map<number, number> {
  const placements = new Map<number, number>();
  for (const row of rows) {
    const better = rows.filter((other) => comparePlacementRows(other, row) < 0).length;
    placements.set(row.slot, better + 1);
  }
  return placements;
}
