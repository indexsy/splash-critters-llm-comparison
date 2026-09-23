import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DB_FILE_NAME,
  MIGRATIONS,
  addUnlocks,
  getLeaderboard,
  getRating,
  getRecentMatches,
  getUnlocks,
  insertMatch,
  insertMatchPlayer,
  insertPlayer,
  isNicknameTagTaken,
  openDb,
  runMigrations,
  takenTagsForNickname,
  upsertRating,
  type Db,
} from '../src/db';

const tempDirs: string[] = [];
const openDbs: Db[] = [];

function memoryDb(): Db {
  const db = openDb(':memory:');
  openDbs.push(db);
  return db;
}

afterEach(() => {
  openDbs.splice(0).forEach((db) => db.open && db.close());
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

let seq = 0;
function addPlayer(db: Db, nickname = `Tester${++seq}`, tag = '0001', createdAt = 1_000 + seq): string {
  const id = `p-${++seq}`;
  insertPlayer(db, { id, tokenHash: `hash-${id}`, nickname, tag, createdAt, animal: 'duck', hat: 'none' });
  return id;
}

function tableNames(db: Db): string[] {
  return db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name);
}

function indexNames(db: Db): string[] {
  return db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
}

describe('openDb + migrations', () => {
  it('creates the full schema in memory and records every migration', () => {
    const db = memoryDb();
    expect(tableNames(db)).toEqual(['match_players', 'matches', 'players', 'ratings', 'schema_migrations', 'unlocks']);
    expect(indexNames(db).sort()).toEqual(['match_players_player', 'players_nickname_tag', 'ratings_leaderboard']);
    const versions = db.prepare<[], { version: number }>('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(versions.map((v) => v.version)).toEqual(MIGRATIONS.map((m) => m.version));
    const playerColumns = db.prepare<[], { name: string }>('PRAGMA table_info(players)').all().map((c) => c.name);
    expect(playerColumns).toEqual([
      'id', 'token_hash', 'nickname', 'tag', 'created_at', 'xp', 'level',
      'selected_animal', 'selected_hat', 'has_nickname', 'tutorial_done',
    ]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('is idempotent: re-running applies nothing and keeps data', () => {
    const db = memoryDb();
    const id = addPlayer(db);
    expect(runMigrations(db)).toEqual([]);
    expect(runMigrations(db)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: MIGRATIONS.length });
    expect(db.prepare<[string], { id: string }>('SELECT id FROM players WHERE id = ?').get(id)?.id).toBe(id);
  });

  it('creates DATA_DIR, uses WAL, and does not re-migrate on the next boot', () => {
    const root = mkdtempSync(join(tmpdir(), 'splash-db-'));
    tempDirs.push(root);
    const dataDir = join(root, 'nested', 'data');
    const first = openDb(dataDir);
    expect(existsSync(join(dataDir, DB_FILE_NAME))).toBe(true);
    expect(first.pragma('journal_mode', { simple: true })).toBe('wal');
    addPlayer(first, 'Persisted', '4242');
    first.close();

    const second = openDb(dataDir);
    openDbs.push(second);
    expect(runMigrations(second)).toEqual([]);
    expect(isNicknameTagTaken(second, 'persisted', '4242')).toBe(true);
  });

  it('rolls back a failing migration completely', () => {
    const db = memoryDb();
    const broken = [...MIGRATIONS, { version: MIGRATIONS.length + 1, name: 'broken', sql: 'CREATE TABLE half_done (x INTEGER); SELECT * FROM missing_table;' }];
    expect(() => runMigrations(db, broken)).toThrow();
    expect(tableNames(db)).not.toContain('half_done');
    expect(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()).toEqual({ v: MIGRATIONS.length });
  });

  it('rejects an out-of-order migration list', () => {
    const db = memoryDb();
    expect(() => runMigrations(db, [MIGRATIONS[1], MIGRATIONS[0]])).toThrow(/out of order/);
  });
});

describe('openDb on an unwritable data directory', () => {
  const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  it.skipIf(runningAsRoot)('fails fast with a clear message instead of opening read-only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'splash-ro-'));
    try {
      openDb(dir).close(); // create + migrate normally
      chmodSync(join(dir, DB_FILE_NAME), 0o444);
      expect(() => openDb(dir)).toThrow(/DATA_DIR .* is not writable/);
    } finally {
      chmodSync(join(dir, DB_FILE_NAME), 0o644);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('players', () => {
  it('enforces nickname#tag uniqueness ignoring case', () => {
    const db = memoryDb();
    addPlayer(db, 'Splashy', '1234');
    expect(isNicknameTagTaken(db, 'SPLASHY', '1234')).toBe(true);
    expect(isNicknameTagTaken(db, 'Splashy', '1235')).toBe(false);
    expect(() => addPlayer(db, 'splashy', '1234')).toThrow(/UNIQUE/);
    addPlayer(db, 'sPlAsHy', '9999');
    expect([...takenTagsForNickname(db, 'splashy')].sort()).toEqual(['1234', '9999']);
  });

  it('enforces foreign keys', () => {
    const db = memoryDb();
    insertMatch(db, { id: 'm1', mode: 'duel', ranked: false, startedAt: 1, endedAt: 2, playerCount: 2 });
    expect(() =>
      insertMatchPlayer(db, { matchId: 'm1', playerId: 'ghost', placement: 1, soaks: 0, roundsWon: 3, ratingBefore: null, ratingAfter: null, xpEarned: 10 }),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('ratings', () => {
  it('defaults to ELO_START with no games', () => {
    const db = memoryDb();
    const id = addPlayer(db);
    expect(getRating(db, id, 'duel')).toEqual({ playerId: id, mode: 'duel', rating: 1000, games: 0, wins: 0, peak: 1000 });
  });

  it('upserts and never lowers the peak', () => {
    const db = memoryDb();
    const id = addPlayer(db);
    upsertRating(db, { playerId: id, mode: 'ffa', rating: 1100, games: 1, wins: 1, peak: 1100 });
    upsertRating(db, { playerId: id, mode: 'ffa', rating: 1050, games: 2, wins: 1, peak: 900 });
    expect(getRating(db, id, 'ffa')).toEqual({ playerId: id, mode: 'ffa', rating: 1050, games: 2, wins: 1, peak: 1100 });
    expect(getRating(db, id, 'duel').games).toBe(0);
  });

  it('builds the leaderboard: games > 0, rating desc, shared ranks, winrate, limit', () => {
    const db = memoryDb();
    const [a, b, c, d, e] = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((n) => addPlayer(db, n, '0001'));
    upsertRating(db, { playerId: a, mode: 'duel', rating: 1100, games: 4, wins: 3, peak: 1100 });
    upsertRating(db, { playerId: b, mode: 'duel', rating: 1300, games: 10, wins: 8, peak: 1320 });
    upsertRating(db, { playerId: c, mode: 'duel', rating: 1100, games: 2, wins: 1, peak: 1100 });
    upsertRating(db, { playerId: d, mode: 'duel', rating: 2000, games: 0, wins: 0, peak: 2000 });
    upsertRating(db, { playerId: e, mode: 'ffa', rating: 1900, games: 5, wins: 5, peak: 1900 });

    const board = getLeaderboard(db, 'duel', 100);
    expect(board.map((r) => [r.rank, r.nickname, r.rating])).toEqual([
      [1, 'Bravo', 1300],
      [2, 'Alpha', 1100],
      [2, 'Charlie', 1100],
    ]);
    expect(board[0]).toMatchObject({ playerId: b, tag: '0001', tier: 'lake', games: 10, wins: 8, winrate: 0.8, animal: 'duck' });
    expect(getLeaderboard(db, 'duel', 1)).toHaveLength(1);
    expect(getLeaderboard(db, 'ffa', 100).map((r) => r.playerId)).toEqual([e]);
  });

  it('sanitises leaderboard limits from untrusted input instead of throwing', () => {
    const db = memoryDb();
    const [a, b] = ['Alpha', 'Bravo'].map((n) => addPlayer(db, n, '0001'));
    upsertRating(db, { playerId: a, mode: 'duel', rating: 1100, games: 1, wins: 1, peak: 1100 });
    upsertRating(db, { playerId: b, mode: 'duel', rating: 1050, games: 1, wins: 0, peak: 1050 });
    expect(getLeaderboard(db, 'duel', Number.NaN)).toEqual([]);
    expect(getLeaderboard(db, 'duel', -3)).toEqual([]);
    expect(getLeaderboard(db, 'duel', 1.9)).toHaveLength(1);
    expect(getLeaderboard(db, 'duel', Number.POSITIVE_INFINITY)).toHaveLength(2);
  });
});

describe('matches + unlocks', () => {
  it('returns recent matches newest first with a limit', () => {
    const db = memoryDb();
    const id = addPlayer(db);
    for (let i = 1; i <= 4; i++) {
      insertMatch(db, { id: `m${i}`, mode: i % 2 ? 'duel' : 'ffa', ranked: i === 4, startedAt: i * 100, endedAt: i * 100 + 50, playerCount: i % 2 ? 2 : 4 });
      insertMatchPlayer(db, { matchId: `m${i}`, playerId: id, placement: i, soaks: i, roundsWon: 1, ratingBefore: i === 4 ? 1000 : null, ratingAfter: i === 4 ? 980 : null, xpEarned: 40 + i });
    }
    const recent = getRecentMatches(db, id, 3);
    expect(recent.map((m) => m.matchId)).toEqual(['m4', 'm3', 'm2']);
    expect(recent[0]).toEqual({
      matchId: 'm4', mode: 'ffa', ranked: true, endedAt: 450, placement: 4, players: 4,
      soaks: 4, roundsWon: 1, ratingBefore: 1000, ratingAfter: 980, xpEarned: 44,
    });
    expect(recent[1]).toMatchObject({ ranked: false, ratingBefore: null, ratingAfter: null, players: 2 });
    expect(getRecentMatches(db, id, Number.NaN)).toEqual([]);
    expect(getRecentMatches(db, id, Number.POSITIVE_INFINITY)).toHaveLength(4);
  });

  it('adds unlocks idempotently and reports only new ones', () => {
    const db = memoryDb();
    const id = addPlayer(db);
    expect(addUnlocks(db, id, ['frog', 'duck', 'none'], 10)).toEqual(['frog', 'duck', 'none']);
    expect(addUnlocks(db, id, ['duck', 'bucket'], 20)).toEqual(['bucket']);
    expect(getUnlocks(db, id)).toEqual(['frog', 'duck', 'none', 'bucket']);
  });
});
