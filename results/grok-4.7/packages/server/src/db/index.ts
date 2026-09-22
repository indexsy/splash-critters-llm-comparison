import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  CONFIG,
  tierFor,
  unlocksForLevel,
  levelFromXp,
  type Mode,
  type Profile,
} from '@splash/shared';
import { guestNickname, randomTag } from '../names.js';

export interface RatingRow {
  player_id: string;
  mode: string;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

export class DB {
  readonly raw: Database.Database;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new Database(file);
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );
    const dir = path.resolve(process.cwd(), 'packages/server/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const applied = new Set(
      (this.raw.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id),
    );
    for (const file of files) {
      const id = Number(file.slice(0, 3));
      if (!Number.isFinite(id) || applied.has(id)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      this.raw.exec(sql);
      this.raw.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(id, Date.now());
    }
  }

  private uniqueTag(nickname: string): string {
    const stmt = this.raw.prepare('SELECT 1 FROM players WHERE nickname = ? AND tag = ?');
    for (let i = 0; i < 40; i++) {
      const tag = randomTag();
      if (!stmt.get(nickname, tag)) return tag;
    }
    return String(Date.now() % 9000 + 1000);
  }

  createGuest(tokenHash: string): Profile {
    const id = crypto.randomUUID();
    const nickname = guestNickname();
    const tag = this.uniqueTag(nickname);
    const now = Date.now();
    const tx = this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO players (id, token_hash, nickname, tag, created_at, xp, level, selected_animal, selected_hat, tutorial_done, nickname_set)
           VALUES (?, ?, ?, ?, ?, 0, 1, 'frog', 'none', 0, 0)`,
        )
        .run(id, tokenHash, nickname, tag, now);
      for (const mode of ['duel', 'ffa'] as const) {
        this.raw
          .prepare(
            'INSERT INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, ?, 0, 0, ?)',
          )
          .run(id, mode, CONFIG.ELO_START, CONFIG.ELO_START);
      }
      for (const item of unlocksForLevel(1)) {
        this.raw.prepare('INSERT INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)').run(id, item, now);
      }
    });
    tx();
    return this.profile(id)!;
  }

  playerIdByToken(tokenHash: string): string | null {
    const row = this.raw.prepare('SELECT id FROM players WHERE token_hash = ?').get(tokenHash) as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  }

  profile(id: string): Profile | null {
    const row = this.raw.prepare('SELECT * FROM players WHERE id = ?').get(id) as
      | {
          id: string;
          nickname: string;
          tag: string;
          xp: number;
          level: number;
          selected_animal: string;
          selected_hat: string;
          tutorial_done: number;
          nickname_set: number;
        }
      | undefined;
    if (!row) return null;
    const ratings = this.ratings(id);
    const unlocks = (
      this.raw.prepare('SELECT item_id FROM unlocks WHERE player_id = ?').all(id) as { item_id: string }[]
    ).map((u) => u.item_id);
    return {
      id: row.id,
      nickname: row.nickname,
      tag: row.tag,
      xp: row.xp,
      level: row.level,
      animal: row.selected_animal,
      hat: row.selected_hat,
      tutorialDone: row.tutorial_done === 1,
      nicknameSet: row.nickname_set === 1,
      ratings,
      unlocks,
    };
  }

  ratings(id: string): Profile['ratings'] {
    const rows = this.raw.prepare('SELECT * FROM ratings WHERE player_id = ?').all(id) as RatingRow[];
    const modes: Mode[] = ['duel', 'ffa'];
    return modes.map((mode) => {
      const row = rows.find((r) => r.mode === mode);
      const rating = row?.rating ?? CONFIG.ELO_START;
      return {
        mode,
        rating,
        games: row?.games ?? 0,
        wins: row?.wins ?? 0,
        peak: row?.peak ?? rating,
        tier: tierFor(rating).name,
      };
    });
  }

  rating(id: string, mode: Mode): RatingRow {
    const row = this.raw.prepare('SELECT * FROM ratings WHERE player_id = ? AND mode = ?').get(id, mode) as
      | RatingRow
      | undefined;
    return (
      row ?? {
        player_id: id,
        mode,
        rating: CONFIG.ELO_START,
        games: 0,
        wins: 0,
        peak: CONFIG.ELO_START,
      }
    );
  }

  setNickname(id: string, nickname: string): { ok: true; profile: Profile } | { ok: false; error: string } {
    const tag = this.uniqueTag(nickname);
    try {
      this.raw
        .prepare('UPDATE players SET nickname = ?, tag = ?, nickname_set = 1 WHERE id = ?')
        .run(nickname, tag, id);
    } catch {
      return { ok: false, error: 'That name is taken. Try another.' };
    }
    return { ok: true, profile: this.profile(id)! };
  }

  setCosmetic(id: string, animal?: string, hat?: string): Profile | null {
    const profile = this.profile(id);
    if (!profile) return null;
    if (animal && profile.unlocks.includes(animal)) {
      this.raw.prepare('UPDATE players SET selected_animal = ? WHERE id = ?').run(animal, id);
    }
    if (hat && profile.unlocks.includes(hat)) {
      this.raw.prepare('UPDATE players SET selected_hat = ? WHERE id = ?').run(hat, id);
    }
    return this.profile(id);
  }

  setTutorialDone(id: string): void {
    this.raw.prepare('UPDATE players SET tutorial_done = 1 WHERE id = ?').run(id);
  }

  grantXp(id: string, amount: number): Profile | null {
    const row = this.raw.prepare('SELECT xp FROM players WHERE id = ?').get(id) as { xp: number } | undefined;
    if (!row) return null;
    const xp = row.xp + Math.max(0, amount);
    const level = levelFromXp(xp);
    const now = Date.now();
    this.raw.prepare('UPDATE players SET xp = ?, level = ? WHERE id = ?').run(xp, level, id);
    for (const item of unlocksForLevel(level)) {
      this.raw
        .prepare('INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)')
        .run(id, item, now);
    }
    return this.profile(id);
  }

  applyRating(id: string, mode: Mode, after: number, won: boolean): void {
    const cur = this.rating(id, mode);
    const rating = Math.max(0, Math.round(after));
    const peak = Math.max(cur.peak, rating);
    this.raw
      .prepare(
        `INSERT INTO ratings (player_id, mode, rating, games, wins, peak)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(player_id, mode) DO UPDATE SET
           rating = excluded.rating,
           games = ratings.games + 1,
           wins = ratings.wins + excluded.wins,
           peak = MAX(ratings.peak, excluded.rating)`,
      )
      .run(id, mode, rating, won ? 1 : 0, peak);
  }

  insertMatch(id: string, mode: Mode, ranked: boolean): void {
    this.raw
      .prepare('INSERT INTO matches (id, mode, ranked, started_at, ended_at) VALUES (?, ?, ?, ?, NULL)')
      .run(id, mode, ranked ? 1 : 0, Date.now());
  }

  finishMatch(
    matchId: string,
    rows: {
      playerId: string;
      placement: number;
      soaks: number;
      roundsWon: number;
      ratingBefore: number | null;
      ratingAfter: number | null;
      xp: number;
    }[],
  ): void {
    this.raw.prepare('UPDATE matches SET ended_at = ? WHERE id = ?').run(Date.now(), matchId);
    const stmt = this.raw.prepare(
      `INSERT INTO match_players (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = this.raw.transaction(() => {
      for (const row of rows) {
        stmt.run(
          matchId,
          row.playerId,
          row.placement,
          row.soaks,
          row.roundsWon,
          row.ratingBefore,
          row.ratingAfter,
          row.xp,
        );
      }
    });
    tx();
  }

  leaderboard(mode: Mode): {
    rank: number;
    nickname: string;
    tag: string;
    rating: number;
    tier: string;
    games: number;
    winrate: number;
  }[] {
    const rows = this.raw
      .prepare(
        `SELECT p.nickname, p.tag, r.rating, r.games, r.wins
         FROM ratings r JOIN players p ON p.id = r.player_id
         WHERE r.mode = ? AND r.games > 0
         ORDER BY r.rating DESC, r.wins DESC
         LIMIT 100`,
      )
      .all(mode) as { nickname: string; tag: string; rating: number; games: number; wins: number }[];
    return rows.map((r, i) => ({
      rank: i + 1,
      nickname: r.nickname,
      tag: r.tag,
      rating: r.rating,
      tier: tierFor(r.rating).name,
      games: r.games,
      winrate: r.games ? r.wins / r.games : 0,
    }));
  }

  publicProfile(id: string): Record<string, unknown> | null {
    const profile = this.profile(id);
    if (!profile) return null;
    const recent = this.raw
      .prepare(
        `SELECT m.id, m.mode, m.ranked, m.ended_at, mp.placement, mp.soaks, mp.rounds_won,
                mp.rating_before, mp.rating_after, mp.xp_earned
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.player_id = ?
         ORDER BY m.started_at DESC
         LIMIT 10`,
      )
      .all(id);
    return {
      id: profile.id,
      nickname: profile.nickname,
      tag: profile.tag,
      xp: profile.xp,
      level: profile.level,
      animal: profile.animal,
      hat: profile.hat,
      ratings: profile.ratings,
      unlocks: profile.unlocks,
      recent,
    };
  }
}
