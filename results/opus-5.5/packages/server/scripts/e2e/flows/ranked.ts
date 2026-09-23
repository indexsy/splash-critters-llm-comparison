// Flows 3 and 4: ranked Duel. Two nicknamed players queue, get matched and play; B throws every
// round so A wins 3-0 and both ratings move by K=64 * 0.5 = 32, visible in SQLite, the
// leaderboard and the profile API. Then a second duel where B's socket dies mid-round, B comes
// back once, then leaves for good: after the reconnect grace A wins by forfeit and the ratings are
// persisted the same way.
import { CONFIG, tierFor, type LeaderboardEntry, type PublicProfile } from '@splash/shared';
import { checkPersistedMatch, checkPlacements, checkXp, expectedEloDeltas, ratingRow } from '../checks';
import type { Msg, WsClient } from '../client';
import type { FlowContext, FlowSpec } from '../harness';

/** Queue until matched: the matchmaker runs every 2 s. */
const MATCH_FOUND_MS = CONFIG.MM_TICK_MS * 3;

/** Both players queue for a duel; returns their match_start configs once matched. */
async function queueDuel(ctx: FlowContext, a: WsClient, b: WsClient): Promise<[Msg<'match_start'>, Msg<'match_start'>]> {
  a.send({ type: 'queue_join', mode: 'duel' });
  b.send({ type: 'queue_join', mode: 'duel' });
  const status = await a.take('queue_status');
  ctx.check(status.mode === 'duel' && status.searchRange === CONFIG.MM_BASE_RANGE, `queue_status: duel, search range ±${status.searchRange}`);
  const [foundA, foundB] = await Promise.all([a.take('match_found', undefined, MATCH_FOUND_MS), b.take('match_found', undefined, MATCH_FOUND_MS)]);
  ctx.check(
    foundA.roomCode === foundB.roomCode && foundA.players.length === 2 && foundA.players.every((p) => !p.isBot && p.rating === CONFIG.ELO_START),
    `match_found: both in hidden room ${foundA.roomCode}, 2 humans rated ${CONFIG.ELO_START}`,
  );
  const starts = await Promise.all([a.take('match_start'), b.take('match_start')]);
  ctx.check(starts.every((s) => s.config.ranked && s.config.mode === 'duel'), 'match_start: ranked duel');
  return starts;
}

/** Fresh accounts in a duel: +32 / -32 (K = 64 while provisional, equal ratings). */
function checkDuelRatings(ctx: FlowContext, end: Msg<'match_end'>, winner: string, loser: string): void {
  const [up, down] = expectedEloDeltas('duel', [
    { rating: CONFIG.ELO_START, games: 0, placement: 1 },
    { rating: CONFIG.ELO_START, games: 0, placement: 2 },
  ]);
  const deltas = end.ratingDeltas ?? [];
  const delta = (id: string) => deltas.find((d) => d.playerId === id);
  ctx.equal(
    [delta(winner)?.delta, delta(loser)?.delta, delta(winner)?.before, delta(loser)?.before],
    [up, down, CONFIG.ELO_START, CONFIG.ELO_START],
    'match_end ratingDeltas (winner, loser, before)',
  );
  const winnerAfter = CONFIG.ELO_START + up;
  const loserAfter = CONFIG.ELO_START + down;
  const strip = (id: string) => {
    const row = ratingRow(ctx, id, 'duel');
    return row && { rating: row.rating, games: row.games, wins: row.wins, peak: row.peak };
  };
  ctx.equal(
    [strip(winner), strip(loser)],
    [
      { rating: winnerAfter, games: 1, wins: 1, peak: winnerAfter },
      { rating: loserAfter, games: 1, wins: 0, peak: CONFIG.ELO_START },
    ],
    'SQLite ratings rows (rating, games, wins, peak)',
  );
  const rows = checkPersistedMatch(ctx, end, 2);
  const before = (id: string) => rows.find((r) => r.player_id === id);
  ctx.equal(
    [before(winner)?.rating_after, before(loser)?.rating_after],
    [winnerAfter, loserAfter],
    'SQLite match_players rating_after',
  );
}

async function duel(ctx: FlowContext): Promise<void> {
  const a = await ctx.connectNamed('A', 'E2eDuelist');
  const b = await ctx.connectNamed('B', 'E2eDuelMate');
  ctx.pilot(a, 'medium');
  ctx.pilot(b, 'suicide');
  const [startA] = await queueDuel(ctx, a, b);
  const slotA = startA.config.yourSlot;
  const slotB = 1 - slotA;

  const [endA, endB] = await Promise.all([a.take('match_end', undefined, 3 * 60_000), b.take('match_end', undefined, 3 * 60_000)]);
  const rounds = a.all('round_end');
  const final = rounds.at(-1)!;
  ctx.equal(
    { winners: rounds.map((r) => r.winner), a: final.scores[slotA], b: final.scores[slotB] },
    { winners: [slotA, slotA, slotA], a: 3, b: 0 },
    'rounds: A wins 3-0 (B throws each round)',
  );
  ctx.check(endA.ranked && endB.matchId === endA.matchId && !endA.canRematch, 'match_end: ranked, same match for both, no rematch');
  checkPlacements(ctx, endA, final.scores);
  checkXp(ctx, endA);
  checkDuelRatings(ctx, endA, a.playerId, b.playerId);
  const left = await a.take('left_room');
  ctx.equal(left.reason, 'match_over', 'hidden ranked room closed after the match');
  const profileMsg = await a.take('profile', (m) => m.profile.ratings.duel.games === 1);
  ctx.equal(profileMsg.profile.ratings.duel.rating, CONFIG.ELO_START + 32, 'pushed profile shows the new duel rating');

  const board = await ctx.env.getJson<LeaderboardEntry[]>('/api/leaderboard?mode=duel');
  const entry = (id: string) => board.body.find((e) => e.playerId === id);
  const view = (id: string) => {
    const e = entry(id);
    return e && { name: e.nickname, rating: e.rating, tier: e.tier, games: e.games, winrate: e.winrate };
  };
  ctx.equal(
    [view(a.playerId), view(b.playerId)],
    [
      { name: 'E2eDuelist', rating: 1032, tier: tierFor(1032), games: 1, winrate: 1 },
      { name: 'E2eDuelMate', rating: 968, tier: tierFor(968), games: 1, winrate: 0 },
    ],
    `GET /api/leaderboard?mode=duel (HTTP ${board.status})`,
  );
  ctx.check(entry(a.playerId)!.rank < entry(b.playerId)!.rank, `leaderboard ranks A #${entry(a.playerId)!.rank} above B #${entry(b.playerId)!.rank}`);

  const profile = await ctx.env.getJson<PublicProfile>(`/api/profile/${a.playerId}`);
  const recent = profile.body.recentMatches[0];
  ctx.equal(
    { status: profile.status, match: recent?.matchId, ranked: recent?.ranked, placement: recent?.placement, before: recent?.ratingBefore, after: recent?.ratingAfter, rating: profile.body.ratings.duel.rating },
    { status: 200, match: endA.matchId, ranked: true, placement: 1, before: 1000, after: 1032, rating: 1032 },
    `GET /api/profile/${a.playerId.slice(0, 8)}... recent match`,
  );
}

/**
 * B drops mid-round, comes back inside the grace (re-attached: no forfeit), then drops again for
 * good: the forfeit must come RECONNECT_GRACE_MS after the SECOND drop, not the first.
 */
async function forfeit(ctx: FlowContext): Promise<void> {
  const a = await ctx.connectNamed('A', 'E2eStayer');
  const b = await ctx.connectNamed('B', 'E2eQuitter');
  const [startA] = await queueDuel(ctx, a, b);
  const slotB = 1 - startA.config.yourSlot;
  await a.take('round_start');
  const live = await a.take('snapshot', (m) => m.tick >= CONFIG.TICK_RATE, 10_000);
  const { token } = b.welcome!;
  b.terminate();
  await a.take('player_status', (m) => m.slot === slotB && !m.connected && !m.forfeited);
  await ctx.env.sleep(3000);
  const back = await ctx.open('B-again');
  await back.hello(token);
  const resumed = await back.take('round_start');
  ctx.check(resumed.resumeTick !== undefined && resumed.resumeTick > live.tick, `ranked re-attach inside the grace: round_start resumeTick ${resumed.resumeTick}`);
  await a.take('player_status', (m) => m.slot === slotB && m.connected);
  const later = await back.take('snapshot', (m) => m.tick >= resumed.resumeTick! + CONFIG.TICK_RATE * 2);

  const droppedAt = ctx.env.now();
  back.terminate();
  ctx.note(`B dropped at tick ${live.tick}, came back at tick ${resumed.resumeTick}, dropped for good at tick ${later.tick}`);
  await a.take('player_status', (m) => m.slot === slotB && !m.connected && !m.forfeited);
  const gone = await a.take('player_status', (m) => m.slot === slotB && m.forfeited, CONFIG.RECONNECT_GRACE_MS + 5000);
  const waited = ctx.env.now() - droppedAt;
  ctx.check(
    waited >= CONFIG.RECONNECT_GRACE_MS - 50 && waited < CONFIG.RECONNECT_GRACE_MS + 2000,
    `player_status forfeited broadcast ${(waited / 1000).toFixed(2)} s after the final drop (grace ${CONFIG.RECONNECT_GRACE_MS / 1000} s, restarted)`,
  );
  ctx.check(gone.connected === false && gone.replacedByBot === false, 'no bot substitution in ranked');
  const end = await a.take('match_end');
  const quitter = end.placements.find((p) => p.slot === slotB)!;
  ctx.check(end.ranked && quitter.forfeited && quitter.placement === 2, 'match_end: the quitter forfeited and placed last');
  checkXp(ctx, end);
  checkDuelRatings(ctx, end, a.playerId, b.playerId);
}

export const rankedDuelFlow: FlowSpec = { name: 'ranked-duel', timeoutMs: 4 * 60_000, run: duel };
export const rankedForfeitFlow: FlowSpec = { name: 'ranked-forfeit', timeoutMs: 2 * 60_000, run: forfeit };
