// Persists a finished match in one transaction: the match row, one row per human participant,
// ranked rating changes and XP (with unlocks) for every human. Bots are never persisted.
import { computeMatchXp } from '@splash/shared';
import type { Mode, RatingDelta, XpAward } from '@splash/shared';
import { insertMatch, insertMatchPlayer, type Db } from './db';
import { applyRankedRatings } from './elo';
import { awardXp } from './progression';

export interface MatchResultPlayer {
  slot: number;
  /** Null for bots. */
  playerId: string | null;
  isBot: boolean;
  /** 1-based final placement (see computePlacements); ties share a placement. */
  placement: number;
  roundsWon: number;
  soaks: number;
  castles: number;
  forfeited: boolean;
}

export interface MatchResultInput {
  matchId: string;
  mode: Mode;
  ranked: boolean;
  practice: boolean;
  startedAt: number;
  endedAt: number;
  /** Every participant, humans and bots. */
  players: MatchResultPlayer[];
}

export interface PersistedMatchResults {
  /** Ranked only (null for casual/practice). */
  ratingDeltas: RatingDelta[] | null;
  /** One award per human, in input order. */
  xp: XpAward[];
}

type HumanResult = MatchResultPlayer & { playerId: string };

function humansOf(players: MatchResultPlayer[]): HumanResult[] {
  return players.filter((p): p is HumanResult => !p.isBot && p.playerId !== null);
}

/** Ranked rating changes for the humans, or null when the match is unranked or has fewer than 2 humans. */
function applyRatingsIfRanked(db: Db, input: MatchResultInput, humans: HumanResult[]): RatingDelta[] | null {
  if (!input.ranked || humans.length < 2) return null;
  return applyRankedRatings(db, {
    mode: input.mode,
    rows: humans.map((h) => ({ playerId: h.playerId, slot: h.slot, placement: h.placement })),
  });
}

function awardMatchXp(db: Db, input: MatchResultInput, human: HumanResult): XpAward {
  const { earned, breakdown } = computeMatchXp({
    placement: human.placement,
    playerCount: input.players.length,
    roundsWon: human.roundsWon,
    soaks: human.soaks,
    castles: human.castles,
    practice: input.practice,
    forfeited: human.forfeited,
  });
  return awardXp(db, human.playerId, earned, breakdown, human.slot);
}

/**
 * Persists a finished match atomically and returns what the match_end message needs.
 * Throws (and writes nothing) if the match id was already persisted or a human id is unknown.
 */
export function persistMatchResults(db: Db, input: MatchResultInput): PersistedMatchResults {
  return db.transaction((): PersistedMatchResults => {
    const humans = humansOf(input.players);
    insertMatch(db, {
      id: input.matchId,
      mode: input.mode,
      ranked: input.ranked,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      playerCount: input.players.length,
    });
    const ratingDeltas = applyRatingsIfRanked(db, input, humans);
    const xp = humans.map((human) => awardMatchXp(db, input, human));
    humans.forEach((human, i) => {
      const rating = ratingDeltas?.find((d) => d.playerId === human.playerId);
      insertMatchPlayer(db, {
        matchId: input.matchId,
        playerId: human.playerId,
        placement: human.placement,
        soaks: human.soaks,
        roundsWon: human.roundsWon,
        ratingBefore: rating?.before ?? null,
        ratingAfter: rating?.after ?? null,
        xpEarned: xp[i].earned,
      });
    });
    return { ratingDeltas, xp };
  })();
}
