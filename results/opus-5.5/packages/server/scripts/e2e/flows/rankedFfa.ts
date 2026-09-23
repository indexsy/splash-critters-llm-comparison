// Flow 6: ranked Free-for-All. Four nicknamed players queue FFA and land in one hidden match;
// three of them throw every round, one survives, so the survivor wins 3-0. The pairwise Elo
// deltas (K' = 64 / 3 per pair for fresh accounts) must match an independent recomputation from
// the final placements, sum to about zero, and be persisted in SQLite.
// A second FFA covers the ranked leaver: one player's socket dies in round 1 and never returns;
// after the grace they are removed from the match, placed last, rated and given no XP, while the
// other three play on (later rounds have no seat for the leaver).
import { CONFIG } from '@splash/shared';
import type { PilotKind } from '../autopilot';
import { checkPersistedMatch, checkPlacements, checkXp, expectedEloDeltas, ratingRow } from '../checks';
import type { Msg, WsClient } from '../client';
import type { FlowContext, FlowSpec } from '../harness';

/** Rounding each player's delta separately can leave the sum a point or two off zero. */
const SUM_TOLERANCE = 2;
const MATCH_WALL_MS = 3 * 60_000;

interface FfaTable {
  clients: WsClient[];
  starts: Msg<'match_start'>[];
}

/** Four fresh nicknamed players with the given pilots queue FFA until they share one ranked match. */
async function queueFfa(ctx: FlowContext, players: readonly [string, PilotKind | null][]): Promise<FfaTable> {
  const clients: WsClient[] = [];
  for (const [name, kind] of players) {
    const client = await ctx.connectNamed(name, name);
    if (kind) ctx.pilot(client, kind);
    clients.push(client);
  }
  for (const c of clients) c.send({ type: 'queue_join', mode: 'ffa' });
  const statuses = await Promise.all(clients.map((c) => c.take('queue_status')));
  ctx.check(statuses.every((s) => s.mode === 'ffa'), 'every player got an FFA queue_status');
  const found = await Promise.all(clients.map((c) => c.take('match_found', undefined, CONFIG.MM_TICK_MS * 3)));
  ctx.check(
    found.every((f) => f.roomCode === found[0].roomCode && f.players.length === 4 && f.mode === 'ffa'),
    `match_found: all four in hidden room ${found[0].roomCode}`,
  );
  const starts = await Promise.all(clients.map((c) => c.take('match_start')));
  ctx.check(new Set(starts.map((s) => s.config.yourSlot)).size === 4 && starts.every((s) => s.config.ranked), 'match_start: ranked FFA, four distinct slots');
  return { clients, starts };
}

/** Deltas equal the independent pairwise recomputation, sum to ~0 and are stored (ratings + match_players). */
function checkFfaRatings(ctx: FlowContext, end: Msg<'match_end'>): void {
  const bySlot = [...end.placements].sort((a, b) => a.slot - b.slot);
  const expected = expectedEloDeltas(
    'ffa',
    bySlot.map((p) => ({ rating: CONFIG.ELO_START, games: 0, placement: p.placement })),
  );
  const actual = bySlot.map((p) => end.ratingDeltas?.find((d) => d.slot === p.slot)?.delta);
  ctx.equal(actual, expected, `pairwise FFA deltas by slot for placements ${bySlot.map((p) => p.placement).join(',')}`);
  const sum = expected.reduce((a, b) => a + b, 0);
  ctx.check(Math.abs(sum) <= SUM_TOLERANCE, `deltas sum to ${sum} (about zero)`);
  const stored = bySlot.map((p) => {
    const row = ratingRow(ctx, p.playerId!, 'ffa');
    return row && { rating: row.rating, games: row.games, wins: row.wins };
  });
  ctx.equal(
    stored,
    bySlot.map((p, i) => ({ rating: CONFIG.ELO_START + expected[i], games: 1, wins: p.placement === 1 ? 1 : 0 })),
    'SQLite ffa ratings rows (rating, games, wins)',
  );
  const rows = checkPersistedMatch(ctx, end, 4);
  const after = (playerId: string) => CONFIG.ELO_START + expected[bySlot.findIndex((p) => p.playerId === playerId)];
  ctx.check(
    rows.every((r) => r.rating_before === CONFIG.ELO_START && r.rating_after === after(r.player_id)),
    'SQLite match_players rating_before/after',
  );
}

async function survivor(ctx: FlowContext): Promise<void> {
  const { clients, starts } = await queueFfa(ctx, [
    ['E2eSurvivor', 'medium'],
    ['E2eThrowerA', 'suicide'],
    ['E2eThrowerB', 'suicide'],
    ['E2eThrowerC', 'suicide'],
  ]);
  const survivorSlot = starts[0].config.yourSlot;
  const ends = await Promise.all(clients.map((c) => c.take('match_end', undefined, MATCH_WALL_MS)));
  const end = ends[0];
  const rounds = clients[0].all('round_end');
  ctx.equal(rounds.map((r) => r.winner), [survivorSlot, survivorSlot, survivorSlot], 'every round won by the survivor');
  ctx.check(end.ranked && ends.every((e) => e.matchId === end.matchId), 'all four got the same ranked match_end');
  checkPlacements(ctx, end, rounds.at(-1)!.scores);
  checkXp(ctx, end);
  checkFfaRatings(ctx, end);
}

async function leaver(ctx: FlowContext): Promise<void> {
  const { clients, starts } = await queueFfa(ctx, [
    ['E2eStaysOn', 'medium'],
    ['E2eThrowsD', 'suicide'],
    ['E2eThrowsE', 'suicide'],
    ['E2eLeaver', null],
  ]);
  const [stays, , , gone] = clients;
  const goneSlot = starts[3].config.yourSlot;
  await stays.take('round_start');
  await stays.take('snapshot', (m) => m.tick >= CONFIG.TICK_RATE, 10_000);
  const droppedAt = ctx.env.now();
  gone.terminate();
  const status = await stays.take('player_status', (m) => m.slot === goneSlot && m.forfeited, CONFIG.RECONNECT_GRACE_MS + 5000);
  const waited = ctx.env.now() - droppedAt;
  ctx.check(
    waited >= CONFIG.RECONNECT_GRACE_MS - 50 && waited < CONFIG.RECONNECT_GRACE_MS + 2000 && !status.replacedByBot,
    `leaver forfeited ${(waited / 1000).toFixed(2)} s after the drop, no bot substitute`,
  );
  // A round that started during the grace period still seats the (not yet forfeited) leaver;
  // only rounds starting after the forfeit must leave the seat out.
  const roundAtForfeit = Math.max(0, ...stays.all('round_start').map((m) => m.roundNo));
  const next = await stays.take('round_start', (m) => m.roundNo > roundAtForfeit, 30_000);
  ctx.check(!next.spawns.some((s) => s.slot === goneSlot), `round ${next.roundNo} (after the forfeit) has no seat for the leaver`);
  const snap = await stays.take('snapshot', undefined, 10_000);
  ctx.check(snap.players.length === 3 && !snap.players.some((p) => p.slot === goneSlot), 'snapshots list the three remaining players');

  const ends = await Promise.all(clients.slice(0, 3).map((c) => c.take('match_end', undefined, MATCH_WALL_MS)));
  const end = ends[0];
  ctx.check(ends.every((e) => e.matchId === end.matchId), 'the three remaining players got the same match_end');
  const last = end.placements.find((p) => p.slot === goneSlot)!;
  ctx.check(last.forfeited && last.placement === 4, 'the leaver is placed last (4th) and marked forfeited');
  checkPlacements(ctx, end, clients[0].all('round_end').at(-1)!.scores);
  checkXp(ctx, end);
  checkFfaRatings(ctx, end);
}

export const rankedFfaFlow: FlowSpec = { name: 'ranked-ffa', timeoutMs: 4 * 60_000, run: survivor };
export const rankedFfaLeaverFlow: FlowSpec = { name: 'ranked-ffa-leaver', timeoutMs: 4 * 60_000, run: leaver };
