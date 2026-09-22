import { CONFIG, levelFromXp, matchXp, tierFor, xpProgress, type AnimalId, type HatId, type Mode, type Profile, type RatingView, type RecentMatch } from '@splash/shared';
import type Database from 'better-sqlite3';
import { itemIdAnimal, itemIdHat, unlockedItems } from '../names.js';

export interface PlayerRow {
  id: string;
  token_hash: string;
  nickname: string;
  tag: string;
  created_at: number;
  xp: number;
  level: number;
  selected_animal: string;
  selected_hat: string | null;
  tutorial_done: number;
  nick_set: number;
}

export function createQueries(db: Database.Database) {
  const insertPlayer = db.prepare(`
    INSERT INTO players(id, token_hash, nickname, tag, created_at, xp, level, selected_animal, selected_hat, tutorial_done, nick_set)
    VALUES (@id, @token_hash, @nickname, @tag, @created_at, 0, 1, 'frog', NULL, 0, 0)
  `);
  const insertRating = db.prepare(`
    INSERT INTO ratings(player_id, mode, rating, games, wins, peak) VALUES (?, ?, ?, 0, 0, ?)
  `);
  const insertUnlock = db.prepare(`
    INSERT OR IGNORE INTO unlocks(player_id, item_id, unlocked_at) VALUES (?, ?, ?)
  `);

  function syncUnlocks(playerId: string, level: number) {
    const now = Date.now();
    for (const item of unlockedItems(level)) insertUnlock.run(playerId, item, now);
  }

  function ratingView(playerId: string, mode: Mode): RatingView {
    const row = db.prepare(`SELECT rating, games, wins, peak FROM ratings WHERE player_id = ? AND mode = ?`).get(playerId, mode) as
      | { rating: number; games: number; wins: number; peak: number }
      | undefined;
    const rating = row?.rating ?? CONFIG.ELO_START;
    const games = row?.games ?? 0;
    const wins = row?.wins ?? 0;
    const peak = row?.peak ?? rating;
    const tier = tierFor(rating);
    return { rating, games, wins, peak, tier: tier.name, tierId: tier.id, next: tier.next };
  }

  function profile(id: string): Profile | null {
    const p = db.prepare(`SELECT * FROM players WHERE id = ?`).get(id) as PlayerRow | undefined;
    if (!p) return null;
    const unlocks = (db.prepare(`SELECT item_id FROM unlocks WHERE player_id = ?`).all(id) as { item_id: string }[]).map((r) => r.item_id);
    const recent = db.prepare(`
      SELECT m.id, m.mode, m.ranked, m.ended_at as endedAt, mp.placement, mp.soaks, mp.rounds_won as roundsWon,
             mp.rating_before as ratingBefore, mp.rating_after as ratingAfter, mp.xp_earned as xp
      FROM match_players mp JOIN matches m ON m.id = mp.match_id
      WHERE mp.player_id = ? AND m.ended_at IS NOT NULL
      ORDER BY m.ended_at DESC LIMIT 10
    `).all(id) as RecentMatch[];
    const prog = xpProgress(p.xp);
    return {
      id: p.id,
      nickname: p.nickname,
      tag: p.tag,
      xp: p.xp,
      level: prog.level,
      animal: p.selected_animal as AnimalId,
      hat: (p.selected_hat as HatId | null) ?? null,
      tutorialDone: !!p.tutorial_done,
      nickSet: !!p.nick_set,
      ratings: { duel: ratingView(id, 'duel'), ffa: ratingView(id, 'ffa') },
      unlocks,
      recent: recent.map((r) => ({ ...r, ranked: !!r.ranked })),
    };
  }

  return {
    profile,
    ratingView,
    byToken(hash: string): PlayerRow | undefined {
      return db.prepare(`SELECT * FROM players WHERE token_hash = ?`).get(hash) as PlayerRow | undefined;
    },
    byId(id: string): PlayerRow | undefined {
      return db.prepare(`SELECT * FROM players WHERE id = ?`).get(id) as PlayerRow | undefined;
    },
    nickTaken(nickname: string, tag: string, except?: string): boolean {
      const row = db.prepare(`SELECT id FROM players WHERE nickname = ? AND tag = ?`).get(nickname, tag) as { id: string } | undefined;
      return !!row && row.id !== except;
    },
    createPlayer(row: { id: string; token_hash: string; nickname: string; tag: string }) {
      const tx = db.transaction(() => {
        insertPlayer.run({ ...row, created_at: Date.now() });
        insertRating.run(row.id, 'duel', CONFIG.ELO_START, CONFIG.ELO_START);
        insertRating.run(row.id, 'ffa', CONFIG.ELO_START, CONFIG.ELO_START);
        syncUnlocks(row.id, 1);
      });
      tx();
      return profile(row.id)!;
    },
    setNickname(id: string, nickname: string, tag: string) {
      db.prepare(`UPDATE players SET nickname = ?, tag = ?, nick_set = 1 WHERE id = ?`).run(nickname, tag, id);
    },
    setCosmetic(id: string, animal: AnimalId, hat: HatId | null) {
      db.prepare(`UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?`).run(animal, hat, id);
    },
    setTutorial(id: string) {
      db.prepare(`UPDATE players SET tutorial_done = 1 WHERE id = ?`).run(id);
    },
    addXp(id: string, amount: number): { xp: number; level: number } {
      const row = db.prepare(`SELECT xp FROM players WHERE id = ?`).get(id) as { xp: number };
      const xp = row.xp + amount;
      const level = levelFromXp(xp);
      db.prepare(`UPDATE players SET xp = ?, level = ? WHERE id = ?`).run(xp, level, id);
      syncUnlocks(id, level);
      return { xp, level };
    },
    deletePlayer(id: string) {
      db.prepare(`DELETE FROM match_players WHERE player_id = ?`).run(id);
      db.prepare(`DELETE FROM ratings WHERE player_id = ?`).run(id);
      db.prepare(`DELETE FROM unlocks WHERE player_id = ?`).run(id);
      db.prepare(`DELETE FROM players WHERE id = ?`).run(id);
    },
    leaderboard(mode: Mode) {
      const rows = db.prepare(`
        SELECT p.nickname, p.tag, r.rating, r.games, r.wins
        FROM ratings r JOIN players p ON p.id = r.player_id
        WHERE r.mode = ? AND r.games > 0
        ORDER BY r.rating DESC, r.wins DESC
        LIMIT 100
      `).all(mode) as { nickname: string; tag: string; rating: number; games: number; wins: number }[];
      return rows.map((r, i) => ({
        rank: i + 1,
        name: `${r.nickname}#${r.tag}`,
        rating: Math.round(r.rating),
        tier: tierFor(r.rating).name,
        games: r.games,
        winrate: r.games ? Math.round((r.wins / r.games) * 1000) / 10 : 0,
      }));
    },
    recordMatch(opts: {
      id: string;
      mode: Mode;
      ranked: boolean;
      startedAt: number;
      players: {
        id: string;
        placement: number;
        soaks: number;
        roundsWon: number;
        ratingBefore: number | null;
        ratingAfter: number | null;
        xp: number;
        win: boolean;
      }[];
    }) {
      const tx = db.transaction(() => {
        db.prepare(`INSERT INTO matches(id, mode, ranked, started_at, ended_at) VALUES (?, ?, ?, ?, ?)`).run(
          opts.id,
          opts.mode,
          opts.ranked ? 1 : 0,
          opts.startedAt,
          Date.now(),
        );
        const ins = db.prepare(`
          INSERT INTO match_players(match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of opts.players) {
          if (!db.prepare(`SELECT id FROM players WHERE id = ?`).get(p.id)) continue;
          ins.run(opts.id, p.id, p.placement, p.soaks, p.roundsWon, p.ratingBefore, p.ratingAfter, p.xp);
          if (opts.ranked && p.ratingAfter != null) {
            const cur = db.prepare(`SELECT peak, games, wins FROM ratings WHERE player_id = ? AND mode = ?`).get(p.id, opts.mode) as {
              peak: number;
              games: number;
              wins: number;
            };
            const peak = Math.max(cur?.peak ?? p.ratingAfter, p.ratingAfter);
            db.prepare(`UPDATE ratings SET rating = ?, games = ?, wins = ?, peak = ? WHERE player_id = ? AND mode = ?`).run(
              p.ratingAfter,
              (cur?.games ?? 0) + 1,
              (cur?.wins ?? 0) + (p.win ? 1 : 0),
              peak,
              p.id,
              opts.mode,
            );
          }
          if (p.xp) {
            const row = db.prepare(`SELECT xp FROM players WHERE id = ?`).get(p.id) as { xp: number } | undefined;
            if (row) {
              const xp = row.xp + p.xp;
              const level = levelFromXp(xp);
              db.prepare(`UPDATE players SET xp = ?, level = ? WHERE id = ?`).run(xp, level, p.id);
              syncUnlocks(p.id, level);
            }
          }
        }
      });
      tx();
    },
    hasUnlock(playerId: string, item: string): boolean {
      return !!db.prepare(`SELECT 1 FROM unlocks WHERE player_id = ? AND item_id = ?`).get(playerId, item);
    },
    matchXp,
    itemIdAnimal,
    itemIdHat,
  };
}

export type Queries = ReturnType<typeof createQueries>;
