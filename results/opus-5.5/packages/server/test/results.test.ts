import { afterEach, describe, expect, it } from 'vitest';
import { computePlacements } from '@splash/shared';
import { loginOrCreate } from '../src/accounts';
import { getLeaderboard, getPlayer, getRating, getRecentMatches, openDb, type Db } from '../src/db';
import { persistMatchResults, type MatchResultInput, type MatchResultPlayer } from '../src/results';

const openDbs: Db[] = [];
function memoryDb(): Db {
  const db = openDb(':memory:');
  openDbs.push(db);
  return db;
}
afterEach(() => openDbs.splice(0).forEach((db) => db.close()));

function newPlayers(db: Db, n: number): string[] {
  return Array.from({ length: n }, () => loginOrCreate(db).player.id);
}

function human(slot: number, playerId: string, placement: number, extra: Partial<MatchResultPlayer> = {}): MatchResultPlayer {
  return { slot, playerId, isBot: false, placement, roundsWon: 0, soaks: 0, castles: 0, forfeited: false, ...extra };
}

function bot(slot: number, placement: number): MatchResultPlayer {
  return { slot, playerId: null, isBot: true, placement, roundsWon: 0, soaks: 0, castles: 0, forfeited: false };
}

let matchSeq = 0;
function match(players: MatchResultPlayer[], extra: Partial<MatchResultInput> = {}): MatchResultInput {
  matchSeq += 1;
  return {
    matchId: `match-${matchSeq}`,
    mode: players.length === 2 ? 'duel' : 'ffa',
    ranked: true,
    practice: false,
    startedAt: matchSeq * 1000,
    endedAt: matchSeq * 1000 + 500,
    players,
    ...extra,
  };
}

type MatchPlayerRow = { player_id: string; placement: number; rating_before: number | null; rating_after: number | null; xp_earned: number };
function matchPlayerRows(db: Db, matchId: string): MatchPlayerRow[] {
  return db
    .prepare<[string], MatchPlayerRow>(
      'SELECT player_id, placement, rating_before, rating_after, xp_earned FROM match_players WHERE match_id = ? ORDER BY placement',
    )
    .all(matchId);
}

describe('persistMatchResults: ranked duel', () => {
  it('persists 1032 / 968 for two new players, with games, wins, peak and match rows', () => {
    const db = memoryDb();
    const [a, b] = newPlayers(db, 2);
    const input = match([human(0, a, 1, { roundsWon: 3, soaks: 3, castles: 12 }), human(1, b, 2, { roundsWon: 1, soaks: 1 })]);
    const result = persistMatchResults(db, input);

    expect(result.ratingDeltas).toEqual([
      { slot: 0, playerId: a, before: 1000, after: 1032, delta: 32, tierBefore: 'pond', tierAfter: 'pond' },
      { slot: 1, playerId: b, before: 1000, after: 968, delta: -32, tierBefore: 'pond', tierAfter: 'puddle' },
    ]);
    expect(getRating(db, a, 'duel')).toMatchObject({ rating: 1032, games: 1, wins: 1, peak: 1032 });
    expect(getRating(db, b, 'duel')).toMatchObject({ rating: 968, games: 1, wins: 0, peak: 1000 });
    expect(getRating(db, a, 'ffa')).toMatchObject({ rating: 1000, games: 0 });

    const header = db.prepare('SELECT id, mode, ranked, started_at, ended_at, player_count FROM matches').all();
    expect(header).toEqual([{ id: input.matchId, mode: 'duel', ranked: 1, started_at: input.startedAt, ended_at: input.endedAt, player_count: 2 }]);
    // winner: 40 + 100 + 3*15 + 3*12 + 12 = 233; loser (last of 2): 40 + 20 + 15 + 12 = 87
    expect(result.xp.map((x) => [x.slot, x.earned])).toEqual([[0, 233], [1, 87]]);
    expect(matchPlayerRows(db, input.matchId)).toEqual([
      { player_id: a, placement: 1, rating_before: 1000, rating_after: 1032, xp_earned: 233 },
      { player_id: b, placement: 2, rating_before: 1000, rating_after: 968, xp_earned: 87 },
    ]);
    expect(getPlayer(db, a)).toMatchObject({ xp: 233, level: 2 });
  });

  it('uses stored ratings for the next match and keeps the peak', () => {
    const db = memoryDb();
    const [a, b] = newPlayers(db, 2);
    persistMatchResults(db, match([human(0, a, 1), human(1, b, 2)]));
    // b (968) beats a (1032), both provisional: E(968 v 1032) = 0.40909 -> 64 * 0.59091 = 37.8 -> 38
    const result = persistMatchResults(db, match([human(0, a, 2), human(1, b, 1)]));
    expect(result.ratingDeltas?.map((d) => [d.before, d.after])).toEqual([[1032, 994], [968, 1006]]);
    expect(getRating(db, a, 'duel')).toMatchObject({ rating: 994, games: 2, wins: 1, peak: 1032 });
    expect(getRating(db, b, 'duel')).toMatchObject({ rating: 1006, games: 2, wins: 1, peak: 1006 });
  });

  it('a drawn duel (level at MAX_ROUNDS) moves no rating and credits no win', () => {
    const db = memoryDb();
    const [a, b] = newPlayers(db, 2);
    const stats = [
      { slot: 0, roundsWon: 7, soaks: 9, forfeited: false },
      { slot: 1, roundsWon: 7, soaks: 9, forfeited: false },
    ];
    const placements = computePlacements(stats);
    const result = persistMatchResults(db, match(stats.map((s, i) => human(s.slot, [a, b][i], placements.get(s.slot) ?? 2, s))));
    expect(result.ratingDeltas?.map((d) => d.delta)).toEqual([0, 0]);
    expect(getRating(db, a, 'duel')).toMatchObject({ rating: 1000, games: 1, wins: 0 });
    expect(getRating(db, b, 'duel')).toMatchObject({ rating: 1000, games: 1, wins: 0 });
    expect(getLeaderboard(db, 'duel', 10).map((e) => e.winrate)).toEqual([0, 0]);
  });

  it('writes nothing when the match id was already persisted', () => {
    const db = memoryDb();
    const [a, b] = newPlayers(db, 2);
    const input = match([human(0, a, 1), human(1, b, 2)]);
    persistMatchResults(db, input);
    const xpBefore = getPlayer(db, a)?.xp;
    expect(() => persistMatchResults(db, input)).toThrow(/UNIQUE/);
    expect(getRating(db, a, 'duel')).toMatchObject({ rating: 1032, games: 1 });
    expect(getPlayer(db, a)?.xp).toBe(xpBefore);
  });

  it('rolls back everything for an unknown human', () => {
    const db = memoryDb();
    const [a] = newPlayers(db, 1);
    const input = match([human(0, a, 1), human(1, 'ghost', 2)]);
    expect(() => persistMatchResults(db, input)).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM matches').get()).toEqual({ n: 0 });
    expect(getRating(db, a, 'duel').games).toBe(0);
    expect(getPlayer(db, a)?.xp).toBe(0);
  });
});

describe('persistMatchResults: ranked FFA', () => {
  it('applies pairwise deltas +32 / +11 / -11 / -32 and credits a win only to 1st', () => {
    const db = memoryDb();
    const ids = newPlayers(db, 4);
    const result = persistMatchResults(db, match(ids.map((id, i) => human(i, id, i + 1))));
    expect(result.ratingDeltas?.map((d) => d.delta)).toEqual([32, 11, -11, -32]);
    expect(ids.map((id) => getRating(db, id, 'ffa').rating)).toEqual([1032, 1011, 989, 968]);
    expect(ids.map((id) => getRating(db, id, 'ffa').wins)).toEqual([1, 0, 0, 0]);
    expect(getRating(db, ids[0], 'duel').games).toBe(0);
  });

  it('places a forfeiter last: rating loss and zero XP, opponents credited', () => {
    const db = memoryDb();
    const ids = newPlayers(db, 4);
    const stats = [
      { slot: 0, roundsWon: 2, soaks: 5, forfeited: true },
      { slot: 1, roundsWon: 1, soaks: 1, forfeited: false },
      { slot: 2, roundsWon: 1, soaks: 1, forfeited: false },
      { slot: 3, roundsWon: 0, soaks: 0, forfeited: false },
    ];
    const placements = computePlacements(stats);
    const result = persistMatchResults(
      db,
      match(stats.map((s) => human(s.slot, ids[s.slot], placements.get(s.slot) ?? 4, { roundsWon: s.roundsWon, soaks: s.soaks, forfeited: s.forfeited }))),
    );
    expect(stats.map((s) => placements.get(s.slot))).toEqual([4, 1, 1, 3]);
    // placements 4,1,1,3 among four new 1000s: (-1.5, +1, +1, -0.5) * 64/3
    expect(result.ratingDeltas?.map((d) => d.delta)).toEqual([-32, 21, 21, -11]);
    expect(result.xp[0]).toMatchObject({ earned: 0, breakdown: [{ label: 'Forfeited', xp: 0 }] });
    expect(ids.map((id) => getRating(db, id, 'ffa').wins)).toEqual([0, 1, 1, 0]);
  });
});

describe('persistMatchResults: casual + practice', () => {
  it('casual with bots: no rating change, XP for the human only, bots not persisted', () => {
    const db = memoryDb();
    const [a] = newPlayers(db, 1);
    const input = match([human(0, a, 2, { roundsWon: 2, soaks: 2, castles: 30 }), bot(1, 1), bot(2, 3), bot(3, 4)], { ranked: false });
    const result = persistMatchResults(db, input);
    expect(result.ratingDeltas).toBeNull();
    // 40 + 60 + 2*15 + 2*12 + 30
    expect(result.xp).toHaveLength(1);
    expect(result.xp[0]).toMatchObject({ slot: 0, playerId: a, earned: 184, xpBefore: 0, xpAfter: 184, levelAfter: 2 });
    expect(getRating(db, a, 'ffa')).toMatchObject({ rating: 1000, games: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ratings').get()).toEqual({ n: 0 });
    expect(matchPlayerRows(db, input.matchId)).toEqual([
      { player_id: a, placement: 2, rating_before: null, rating_after: null, xp_earned: 184 },
    ]);
    expect(db.prepare('SELECT ranked, player_count FROM matches').get()).toEqual({ ranked: 0, player_count: 4 });
  });

  it('practice halves XP', () => {
    const db = memoryDb();
    const [a] = newPlayers(db, 1);
    const result = persistMatchResults(db, match([human(0, a, 1, { roundsWon: 3 }), bot(1, 2)], { ranked: false, practice: true }));
    // (40 + 100 + 45) * 0.5, per line: 20 + 50 + round(22.5) = 93
    expect(result.xp[0].earned).toBe(93);
  });

  it('grants level-up unlocks through match XP', () => {
    const db = memoryDb();
    const [a] = newPlayers(db, 1);
    const result = persistMatchResults(
      db,
      match([human(0, a, 1, { roundsWon: 5, soaks: 10, castles: 60 }), bot(1, 2)], { ranked: false }),
    );
    // 40 + 100 + 75 + 120 + 60 = 395 -> level 3 (275) with 120 into level 3
    expect(result.xp[0]).toMatchObject({ earned: 395, levelBefore: 1, levelAfter: 3, unlocked: ['otter', 'bucket'] });
  });
});

describe('leaderboard + recent matches after real results', () => {
  it('orders the leaderboard by rating and lists recent matches newest first', () => {
    const db = memoryDb();
    const [a, b, c] = newPlayers(db, 3);
    persistMatchResults(db, match([human(0, a, 1), human(1, b, 2)]));
    persistMatchResults(db, match([human(0, a, 1), human(1, c, 2)]));
    persistMatchResults(db, match([human(0, b, 1), human(1, c, 2)]));

    const board = getLeaderboard(db, 'duel', 100);
    expect(board.map((e) => e.playerId)).toEqual([a, b, c]);
    expect(board[0]).toMatchObject({ rank: 1, games: 2, wins: 2, winrate: 1 });
    expect(board.map((e) => e.rating)).toEqual([...board.map((e) => e.rating)].sort((x, y) => y - x));

    const recent = getRecentMatches(db, c, 10);
    expect(recent.map((m) => m.matchId)).toEqual([`match-${matchSeq}`, `match-${matchSeq - 1}`]);
    expect(recent[0]).toMatchObject({ mode: 'duel', ranked: true, placement: 2, players: 2 });
    expect(recent[0].ratingAfter).toBeLessThan(recent[0].ratingBefore ?? 0);
  });
});
