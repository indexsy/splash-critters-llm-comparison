/**
 * Typed persistence API — prepared statements bound to a DB handle.
 * All match/account state flows through here.
 */

import {
  CONFIG,
  levelFromXp,
  tierForRating,
  type AnimalId,
  type HatId,
  type LeaderboardEntry,
  type Mode,
  type ProfileDTO,
  type RatingDTO,
  type RecentMatchDTO,
} from '@splash/shared';
import {
  levelForXp,
  newUnlocks,
  unlocksForLevel,
} from '../progression';
import type { DB } from './index';

export interface PlayerRow {
  id: string;
  token_hash: string;
  nickname: string | null;
  tag: string | null;
  created_at: number;
  xp: number;
  level: number;
  selected_animal: string;
  selected_hat: string;
}

export interface RatingRow {
  player_id: string;
  mode: string;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

export interface MatchPlayerInsert {
  matchId: number;
  playerId: string;
  placement: number;
  soaks: number;
  roundsWon: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
}

export interface Queries {
  createGuest(id: string, tokenHash: string, nickname: string, tag: string): PlayerRow;
  getByToken(tokenHash: string): PlayerRow | undefined;
  getById(id: string): PlayerRow | undefined;
  setNickname(id: string, nickname: string, tag: string): void;
  nicknameTaken(nickname: string, tag: string, exceptId: string): boolean;
  setLoadout(id: string, animal: AnimalId, hat: HatId): void;
  addXp(id: string, amount: number): { xp: number; level: number; leveledUp: boolean; unlocked: string[] };
  getRating(playerId: string, mode: Mode): RatingRow;
  saveRating(row: RatingRow): void;
  insertMatch(mode: Mode, ranked: boolean, startedAt: number): number;
  endMatch(matchId: number, endedAt: number): void;
  insertMatchPlayer(mp: MatchPlayerInsert): void;
  addUnlock(playerId: string, itemId: string): void;
  getUnlocks(playerId: string): string[];
  leaderboard(mode: Mode, limit: number): LeaderboardEntry[];
  recentMatches(playerId: string, limit: number): RecentMatchDTO[];
  buildProfile(id: string): ProfileDTO | undefined;
}

export function makeQueries(db: DB): Queries {
  const st = {
    insPlayer: db.prepare(
      `INSERT INTO players(id, token_hash, nickname, tag, created_at, xp, level, selected_animal, selected_hat)
       VALUES (@id, @token_hash, @nickname, @tag, @created_at, 0, 1, 'frog', 'none')`,
    ),
    byToken: db.prepare('SELECT * FROM players WHERE token_hash = ?'),
    byId: db.prepare('SELECT * FROM players WHERE id = ?'),
    setNick: db.prepare('UPDATE players SET nickname = ?, tag = ? WHERE id = ?'),
    nickTaken: db.prepare(
      'SELECT COUNT(*) AS n FROM players WHERE nickname = ? AND tag = ? AND id != ?',
    ),
    setLoad: db.prepare('UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?'),
    setXp: db.prepare('UPDATE players SET xp = ?, level = ? WHERE id = ?'),
    getRating: db.prepare('SELECT * FROM ratings WHERE player_id = ? AND mode = ?'),
    insRating: db.prepare(
      `INSERT INTO ratings(player_id, mode, rating, games, wins, peak)
       VALUES (@player_id, @mode, @rating, @games, @wins, @peak)
       ON CONFLICT(player_id, mode) DO UPDATE SET
         rating = excluded.rating, games = excluded.games, wins = excluded.wins, peak = excluded.peak`,
    ),
    allRatings: db.prepare('SELECT * FROM ratings WHERE player_id = ?'),
    insMatch: db.prepare('INSERT INTO matches(mode, ranked, started_at) VALUES (?, ?, ?)'),
    endMatch: db.prepare('UPDATE matches SET ended_at = ? WHERE id = ?'),
    insMp: db.prepare(
      `INSERT INTO match_players(match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
       VALUES (@matchId, @playerId, @placement, @soaks, @roundsWon, @ratingBefore, @ratingAfter, @xpEarned)`,
    ),
    insUnlock: db.prepare(
      'INSERT OR IGNORE INTO unlocks(player_id, item_id, unlocked_at) VALUES (?, ?, ?)',
    ),
    getUnlocks: db.prepare('SELECT item_id FROM unlocks WHERE player_id = ?'),
    leaderboard: db.prepare(
      `SELECT r.rating, r.games, r.wins, p.nickname, p.tag
       FROM ratings r JOIN players p ON p.id = r.player_id
       WHERE r.mode = ? AND r.games > 0
       ORDER BY r.rating DESC, r.wins DESC LIMIT ?`,
    ),
    recent: db.prepare(
      `SELECT m.id AS matchId, m.mode, m.ranked, m.ended_at AS endedAt,
              mp.placement, mp.soaks, mp.rating_before AS ratingBefore, mp.rating_after AS ratingAfter, mp.xp_earned AS xpEarned
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
       WHERE mp.player_id = ? ORDER BY m.id DESC LIMIT ?`,
    ),
  };

  const q: Queries = {
    createGuest(id, tokenHash, nickname, tag) {
      st.insPlayer.run({ id, token_hash: tokenHash, nickname, tag, created_at: Date.now() });
      return st.byId.get(id) as PlayerRow;
    },
    getByToken: (tokenHash) => st.byToken.get(tokenHash) as PlayerRow | undefined,
    getById: (id) => st.byId.get(id) as PlayerRow | undefined,
    setNickname: (id, nickname, tag) => void st.setNick.run(nickname, tag, id),
    nicknameTaken: (nickname, tag, exceptId) =>
      (st.nickTaken.get(nickname, tag, exceptId) as { n: number }).n > 0,
    setLoadout: (id, animal, hat) => void st.setLoad.run(animal, hat, id),

    addXp(id, amount) {
      const row = st.byId.get(id) as PlayerRow | undefined;
      if (!row) return { xp: 0, level: 1, leveledUp: false, unlocked: [] };
      const before = row.xp;
      const beforeLevel = row.level;
      const after = before + Math.max(0, Math.round(amount));
      const afterLevel = levelForXp(after);
      st.setXp.run(after, afterLevel, id);
      const unlocked = newUnlocks(beforeLevel, afterLevel);
      for (const item of unlocked) st.insUnlock.run(id, item, Date.now());
      return { xp: after, level: afterLevel, leveledUp: afterLevel > beforeLevel, unlocked };
    },

    getRating(playerId, mode) {
      const existing = st.getRating.get(playerId, mode) as RatingRow | undefined;
      if (existing) return existing;
      return {
        player_id: playerId,
        mode,
        rating: CONFIG.ELO_START,
        games: 0,
        wins: 0,
        peak: CONFIG.ELO_START,
      };
    },
    saveRating: (row) => void st.insRating.run(row),

    insertMatch: (mode, ranked, startedAt) =>
      Number(st.insMatch.run(mode, ranked ? 1 : 0, startedAt).lastInsertRowid),
    endMatch: (matchId, endedAt) => void st.endMatch.run(endedAt, matchId),
    insertMatchPlayer: (mp) => void st.insMp.run(mp),

    addUnlock: (playerId, itemId) => void st.insUnlock.run(playerId, itemId, Date.now()),
    getUnlocks: (playerId) =>
      (st.getUnlocks.all(playerId) as { item_id: string }[]).map((r) => r.item_id),

    leaderboard(mode, limit) {
      const rows = st.leaderboard.all(mode, limit) as (RatingRow & {
        nickname: string | null;
        tag: string | null;
      })[];
      return rows.map((r, i) => {
        const tier = tierForRating(r.rating);
        return {
          rank: i + 1,
          displayName: r.nickname ? `${r.nickname}#${r.tag}` : 'Anonymous',
          rating: r.rating,
          tier: tier.id,
          tierName: tier.name,
          games: r.games,
          wins: r.wins,
          winrate: r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0,
        } satisfies LeaderboardEntry;
      });
    },

    recentMatches(playerId, limit) {
      const rows = st.recent.all(playerId, limit) as Array<{
        matchId: number;
        mode: string;
        ranked: number;
        endedAt: number;
        placement: number;
        soaks: number;
        ratingBefore: number | null;
        ratingAfter: number | null;
        xpEarned: number;
      }>;
      return rows.map((r) => ({
        matchId: r.matchId,
        mode: r.mode as Mode,
        ranked: !!r.ranked,
        placement: r.placement,
        soaks: r.soaks,
        ratingBefore: r.ratingBefore,
        ratingAfter: r.ratingAfter,
        xpEarned: r.xpEarned,
        endedAt: r.endedAt,
      }));
    },

    buildProfile(id) {
      const row = st.byId.get(id) as PlayerRow | undefined;
      if (!row) return undefined;
      const ratingRows = st.allRatings.all(id) as RatingRow[];
      const ratings: RatingDTO[] = ratingRows.map((r) => {
        const tier = tierForRating(r.rating);
        return {
          mode: r.mode as Mode,
          rating: r.rating,
          tier: tier.id,
          tierName: tier.name,
          games: r.games,
          wins: r.wins,
          peak: r.peak,
        };
      });
      const explicit = (st.getUnlocks.all(id) as { item_id: string }[]).map((u) => u.item_id);
      const unlocks = [...new Set([...unlocksForLevel(row.level), ...explicit])];
      const lv = levelFromXp(row.xp);
      return {
        id: row.id,
        nickname: row.nickname,
        tag: row.tag,
        displayName: row.nickname ? `${row.nickname}#${row.tag}` : 'Guest',
        level: row.level,
        xp: row.xp,
        xpInto: lv.into,
        xpNeed: lv.need,
        selectedAnimal: row.selected_animal as AnimalId,
        selectedHat: row.selected_hat as HatId,
        unlocks,
        ratings,
      };
    },
  };

  return q;
}
