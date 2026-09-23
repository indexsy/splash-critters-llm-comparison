// Independent expectations the flows compare the server's results against: placements from
// round wins and soaks, Elo deltas recomputed from the spec formulas, and the SQLite rows a
// finished match must have left behind.
import { ANIMALS, CONFIG, HATS, levelFromXp } from '@splash/shared';
import type { MatchEndMsg, Mode, PlacementEntry, XpAward } from '@splash/shared';
import type { FlowContext } from './harness';

interface MatchRow {
  id: string;
  mode: Mode;
  ranked: number;
  player_count: number;
  started_at: number;
  ended_at: number;
}

export interface MatchPlayerRow {
  player_id: string;
  placement: number;
  soaks: number;
  rounds_won: number;
  rating_before: number | null;
  rating_after: number | null;
  xp_earned: number;
}

interface RatingRow {
  player_id: string;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

/**
 * SPEC placement: round wins desc, then total soaks desc; forfeits last; exact ties share
 * (competition ranking: 1 + number of strictly better players).
 */
function expectedPlacement(entry: PlacementEntry, all: readonly PlacementEntry[]): number {
  const better = (a: PlacementEntry, b: PlacementEntry): boolean =>
    a.forfeited !== b.forfeited ? !a.forfeited : a.roundsWon !== b.roundsWon ? a.roundsWon > b.roundsWon : a.soaks > b.soaks;
  return 1 + all.filter((other) => other !== entry && better(other, entry)).length;
}

/** Elo from the spec, written out independently of the shared implementation. */
export function expectedEloDeltas(mode: Mode, players: readonly { rating: number; games: number; placement: number }[]): number[] {
  const expected = (ra: number, rb: number) => 1 / (1 + 10 ** ((rb - ra) / 400));
  const k = (games: number) => (games < CONFIG.ELO_PROVISIONAL_GAMES ? CONFIG.ELO_K_PROVISIONAL : CONFIG.ELO_K);
  return players.map((me, i) => {
    let sum = 0;
    players.forEach((other, j) => {
      if (i === j) return;
      const score = me.placement < other.placement ? 1 : me.placement === other.placement ? 0.5 : 0;
      sum += score - expected(me.rating, other.rating);
    });
    return Math.round((mode === 'duel' ? k(me.games) : k(me.games) / 3) * sum);
  });
}

/**
 * Match XP from CONFIG rates, written out independently: participation + placement (last place
 * gets the table's consolation entry) + round wins + soaks + castles (capped); forfeits earn 0.
 */
function expectedXp(entry: PlacementEntry, playerCount: number, practice: boolean): number {
  if (entry.forfeited) return 0;
  const { XP } = CONFIG;
  const last = entry.placement >= playerCount;
  const placement = XP.PLACEMENT[last ? XP.PLACEMENT.length - 1 : Math.min(entry.placement, XP.PLACEMENT.length) - 1];
  const lines = [XP.PARTICIPATION, placement, entry.roundsWon * XP.ROUND_WIN, entry.soaks * XP.PER_SOAK, Math.min(XP.CASTLE_CAP, entry.castles * XP.PER_CASTLE)];
  return lines.reduce((sum, xp) => sum + Math.round(xp * (practice ? XP.PRACTICE_MULT : 1)), 0);
}

/**
 * A level-up unlocks exactly the catalogue items whose unlock level it crossed, and they are stored
 * in SQLite (unlocks table) for the player.
 */
export function checkUnlocks(ctx: FlowContext, award: XpAward): void {
  const crossed = [...ANIMALS, ...HATS]
    .filter((item) => item.unlockLevel > award.levelBefore && item.unlockLevel <= award.levelAfter)
    .map((item) => item.id as string)
    .sort();
  const stored = new Set(ctx.env.query<{ item_id: string }>('SELECT item_id FROM unlocks WHERE player_id = ?', award.playerId).map((r) => r.item_id));
  ctx.equal(
    { unlocked: [...award.unlocked].sort(), stored: crossed.filter((id) => stored.has(id)) },
    { unlocked: crossed, stored: crossed },
    `slot ${award.slot} level ${award.levelBefore} -> ${award.levelAfter}: unlocks (award, SQLite)`,
  );
}

/** Every human's XP award matches the formula, its breakdown adds up and the level follows the curve. */
export function checkXp(ctx: FlowContext, end: MatchEndMsg): void {
  const humans = end.placements.filter((p) => !p.isBot);
  ctx.equal(end.xp.map((x) => x.playerId).sort(), humans.map((h) => h.playerId).sort(), 'XP awarded to exactly the humans');
  const problems = end.xp.flatMap((award) => {
    const entry = humans.find((h) => h.playerId === award.playerId)!;
    const want = expectedXp(entry, end.placements.length, end.practice);
    const sum = award.breakdown.reduce((total, line) => total + line.xp, 0);
    const level = levelFromXp(award.xpAfter).level;
    const ok = award.earned === want && sum === award.earned && award.xpAfter === award.xpBefore + award.earned && award.levelAfter === level;
    return ok ? [] : [`slot ${award.slot} XP ${award.earned} (breakdown ${sum}, level ${award.levelAfter}), expected ${want} (level ${level})`];
  });
  const shown = end.xp.map((x) => `slot ${x.slot} +${x.earned} (${x.breakdown.map((l) => `${l.label} ${l.xp}`).join(', ')})`);
  ctx.check(problems.length === 0, problems.length > 0 ? problems.join('; ') : `XP matches the formula: ${shown.join('; ')}`);
  for (const award of end.xp) checkUnlocks(ctx, award);
}

/** Placements agree with the final round_end scores and with the SPEC ordering. */
export function checkPlacements(ctx: FlowContext, end: MatchEndMsg, finalScores: readonly number[]): void {
  const problems = end.placements.flatMap((p) => {
    const want = expectedPlacement(p, end.placements);
    return [
      ...(p.roundsWon === finalScores[p.slot] ? [] : [`slot ${p.slot} roundsWon ${p.roundsWon} != round_end score ${finalScores[p.slot]}`]),
      ...(p.placement === want ? [] : [`slot ${p.slot} placed ${p.placement}, expected ${want}`]),
    ];
  });
  ctx.check(problems.length === 0, problems.length > 0 ? problems.join('; ') : 'placements follow round wins, then soaks, forfeits last (ties shared)');
  const best = Math.max(...end.placements.filter((p) => !p.forfeited).map((p) => p.roundsWon));
  const firsts = end.placements.filter((p) => p.placement === 1);
  ctx.check(firsts.length > 0 && firsts.every((p) => p.roundsWon === best), `placement 1 has the most round wins (${best})`);
  ctx.note(
    `placements: ${end.placements.map((p) => `#${p.placement} slot${p.slot}${p.isBot ? '(bot)' : ''} wins ${p.roundsWon} soaks ${p.soaks}${p.forfeited ? ' forfeited' : ''}`).join(' | ')}`,
  );
}

/** The match row plus one match_players row per human, holding the placements and XP of match_end. */
export function checkPersistedMatch(ctx: FlowContext, end: MatchEndMsg, seats: number): MatchPlayerRow[] {
  const [match] = ctx.env.query<MatchRow>('SELECT id, mode, ranked, player_count, started_at, ended_at FROM matches WHERE id = ?', end.matchId);
  ctx.check(match !== undefined, `SQLite matches row for ${end.matchId}`);
  ctx.equal(
    { mode: match.mode, ranked: match.ranked, players: match.player_count, ended: match.ended_at >= match.started_at },
    { mode: end.mode, ranked: end.ranked ? 1 : 0, players: seats, ended: true },
    'SQLite matches row (mode, ranked, player_count)',
  );
  const rows = ctx.env.query<MatchPlayerRow>(
    'SELECT player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned FROM match_players WHERE match_id = ? ORDER BY player_id',
    end.matchId,
  );
  const humans = end.placements.filter((p) => !p.isBot).sort((a, b) => (a.playerId! < b.playerId! ? -1 : 1));
  ctx.equal(
    rows.map((r) => ({ player: r.player_id, placement: r.placement, roundsWon: r.rounds_won, xp: r.xp_earned })),
    humans.map((h) => ({ player: h.playerId, placement: h.placement, roundsWon: h.roundsWon, xp: end.xp.find((x) => x.playerId === h.playerId)?.earned })),
    'SQLite match_players rows = the humans of match_end (placement, rounds won, XP)',
  );
  return rows;
}

export function ratingRow(ctx: FlowContext, playerId: string, mode: Mode): RatingRow | undefined {
  return ctx.env.query<RatingRow>('SELECT player_id, rating, games, wins, peak FROM ratings WHERE player_id = ? AND mode = ?', playerId, mode)[0];
}
