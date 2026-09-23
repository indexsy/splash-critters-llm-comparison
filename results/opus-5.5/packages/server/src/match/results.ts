// Match totals, final placements, fun stats and the persistence input for a finished match.
import { CONFIG, computePlacements, survivedTicks } from '@splash/shared';
import type { FunStat, FunStatId, PlacementEntry, RoundState } from '@splash/shared';
import type { MatchResultInput } from '../results';
import type { MatchParticipant, MatchSetup } from './types';

/** Per-slot stats summed over the match's rounds. */
export interface SlotTotals {
  soaks: number;
  revengeSoaks: number;
  castles: number;
  /** Largest chain across all rounds. */
  biggestChain: number;
  /** Ticks stayed dry, summed over rounds. */
  survivedTicks: number;
}

export function emptyTotals(slots: number): SlotTotals[] {
  return Array.from({ length: slots }, () => ({ soaks: 0, revengeSoaks: 0, castles: 0, biggestChain: 0, survivedTicks: 0 }));
}

/** Adds one round's stats (including players removed mid-round by a forfeit) to the totals. */
export function tallyRound(totals: SlotTotals[], state: RoundState): void {
  for (const p of state.players) {
    const t = totals[p.slot];
    if (!t) continue;
    t.soaks += p.stats.soaks;
    t.revengeSoaks += p.stats.revengeSoaks;
    t.castles += p.stats.castles;
    t.biggestChain = Math.max(t.biggestChain, p.stats.biggestChain);
    t.survivedTicks += survivedTicks(state, p);
  }
}

/**
 * Placement entries for every participant, best first: round wins, then total soaks; forfeited
 * players always rank after everyone else; exact ties share a placement.
 */
export function buildPlacements(
  participants: readonly (MatchParticipant | null)[],
  totals: readonly SlotTotals[],
  scores: readonly number[],
  forfeited: ReadonlySet<number>,
): PlacementEntry[] {
  const seated = participants.filter((p): p is MatchParticipant => p !== null);
  const placements = computePlacements(
    seated.map((p) => ({ slot: p.slot, roundsWon: scores[p.slot], soaks: totals[p.slot].soaks, forfeited: forfeited.has(p.slot) })),
  );
  return seated
    .map((p): PlacementEntry => {
      const t = totals[p.slot];
      return {
        slot: p.slot,
        playerId: p.playerId,
        name: p.name,
        tag: p.tag,
        isBot: p.playerId === null,
        animal: p.animal,
        hat: p.hat,
        placement: placements.get(p.slot) ?? seated.length,
        roundsWon: scores[p.slot],
        soaks: t.soaks,
        revengeSoaks: t.revengeSoaks,
        castles: t.castles,
        biggestChain: t.biggestChain,
        survivedTicks: t.survivedTicks,
        forfeited: forfeited.has(p.slot),
      };
    })
    .sort((a, b) => a.placement - b.placement || a.slot - b.slot);
}

interface FunStatRule {
  id: FunStatId;
  label: string;
  value: (e: PlacementEntry) => number;
  /** Smallest value worth an award. */
  min: number;
}

const FUN_STAT_RULES: readonly FunStatRule[] = [
  { id: 'most_soaks', label: 'Most Soaks', value: (e) => e.soaks, min: 1 },
  { id: 'castle_crusher', label: 'Castle Crusher', value: (e) => e.castles, min: 1 },
  /** Value in whole seconds stayed dry over the whole match. */
  { id: 'longest_survivor', label: 'Longest Survivor', value: (e) => Math.round(e.survivedTicks / CONFIG.TICK_RATE), min: 1 },
  { id: 'biggest_chain', label: 'Biggest Chain', value: (e) => e.biggestChain, min: 2 },
];

/** One award per stat to the best player (ties go to the better placement); zero-value stats are omitted. */
export function buildFunStats(entries: readonly PlacementEntry[]): FunStat[] {
  const stats: FunStat[] = [];
  for (const rule of FUN_STAT_RULES) {
    let best: PlacementEntry | null = null;
    for (const e of entries) if (!best || rule.value(e) > rule.value(best)) best = e;
    if (best && rule.value(best) >= rule.min) stats.push({ id: rule.id, label: rule.label, slot: best.slot, value: rule.value(best) });
  }
  return stats;
}

export function persistInput(
  setup: MatchSetup,
  entries: readonly PlacementEntry[],
  startedAt: number,
  endedAt: number,
): MatchResultInput {
  return {
    matchId: setup.matchId,
    mode: setup.mode,
    ranked: setup.kind === 'ranked',
    practice: setup.kind === 'practice',
    startedAt: Math.round(startedAt),
    endedAt: Math.round(endedAt),
    players: entries.map((e) => ({
      slot: e.slot,
      playerId: e.playerId,
      isBot: e.isBot,
      placement: e.placement,
      roundsWon: e.roundsWon,
      soaks: e.soaks,
      castles: e.castles,
      forfeited: e.forfeited,
    })),
  };
}
