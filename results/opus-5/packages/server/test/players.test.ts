import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, levelFromXp, xpForLevel } from '@splash/shared';
import { openDatabase } from '../src/db/index.js';
import type { DB } from '../src/db/index.js';
import { PlayerService } from '../src/players.js';

let dir: string;
let db: DB;
let service: PlayerService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'splash-db-'));
  db = openDatabase(dir);
  service = new PlayerService(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Direct SQL is the only way to force a specific (nickname, tag) fixture. */
function forceName(id: string, nickname: string, tag: string): void {
  db.prepare('UPDATE players SET nickname = ?, tag = ? WHERE id = ?').run(nickname, tag, id);
}

describe('guest accounts', () => {
  it('is stable across authenticate calls with the same token', () => {
    const first = service.authenticate();
    expect(first.isNew).toBe(true);
    expect(first.token).toBeTruthy();

    const second = service.authenticate(first.token);
    expect(second.isNew).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.nickname).toBe(first.record.nickname);
    expect(second.record.tag).toBe(first.record.tag);
    expect(second.token).toBe(first.token);
  });

  it('mints a separate account for an unknown token', () => {
    const a = service.authenticate();
    const b = service.authenticate('not-a-real-token');
    expect(b.isNew).toBe(true);
    expect(b.record.id).not.toBe(a.record.id);
    expect(b.token).not.toBe('not-a-real-token');
  });

  it('starts at level 1 with the level 1 cosmetics already unlocked', () => {
    const { record } = service.authenticate();
    expect(record.level).toBe(1);
    expect(record.xp).toBe(0);
    expect(record.tutorialDone).toBe(false);

    const profile = service.getProfile(record.id);
    expect([...(profile?.unlocks ?? [])].sort()).toEqual([...service.unlockedItems(1)].sort());
    expect(profile?.unlocks).toContain('animal:frog');
    expect(profile?.unlocks).not.toContain('hat:bucket');
  });

  it('gives every profile a rating entry for both modes', () => {
    const { record } = service.authenticate();
    const profile = service.getProfile(record.id);
    expect(profile?.ratings.map((r) => r.mode)).toEqual(['duel', 'ffa']);
    expect(profile?.ratings.every((r) => r.rating === CONFIG.ELO_START && r.games === 0)).toBe(true);
  });
});

describe('nicknames', () => {
  it('rejects names the shared validator refuses', () => {
    const { record } = service.authenticate();

    const short = service.setNickname(record.id, 'ab');
    expect(short.ok).toBe(false);
    expect(short.code).toBe('nickname_invalid');
    expect(short.msg).toContain(String(CONFIG.NICKNAME_MIN));

    expect(service.setNickname(record.id, 'sh1thead').code).toBe('nickname_invalid');
    expect(service.setNickname(record.id, 'no*stars').code).toBe('nickname_invalid');
  });

  it('keeps the existing tag when the name is free', () => {
    const { record } = service.authenticate();
    const result = service.setNickname(record.id, '  Splashy Sam  ');
    expect(result.ok).toBe(true);
    expect(result.record?.nickname).toBe('Splashy Sam');
    expect(result.record?.tag).toBe(record.tag);
    expect(service.getById(record.id)?.nickname).toBe('Splashy Sam');
  });

  it('allocates a different tag when the pair is taken', () => {
    const a = service.authenticate().record;
    const b = service.authenticate().record;
    forceName(a.id, 'Twinsies', '0007');
    forceName(b.id, 'Solo', '0007');

    const result = service.setNickname(b.id, 'Twinsies');
    expect(result.ok).toBe(true);
    expect(result.record?.nickname).toBe('Twinsies');
    expect(result.record?.tag).not.toBe('0007');
    expect(service.getById(a.id)?.tag).toBe('0007');
  });

  it('reports nickname_taken only when every tag is used', () => {
    const insert = db.prepare<[string, string, string, string, number]>(
      'INSERT INTO players (id, token_hash, nickname, tag, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const fill = db.transaction(() => {
      for (let i = 1; i <= 9999; i++) {
        const tag = String(i).padStart(4, '0');
        insert.run(`full-${tag}`, `hash-${tag}`, 'Crowded', tag, 0);
      }
    });
    fill();

    const { record } = service.authenticate();
    const result = service.setNickname(record.id, 'Crowded');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('nickname_taken');
  });
});

describe('cosmetics and tutorial', () => {
  it('stores the selected animal and hat', () => {
    const { record } = service.authenticate();
    const updated = service.setCosmetics(record.id, 'otter', 'bucket');
    expect(updated?.selectedAnimal).toBe('otter');
    expect(updated?.selectedHat).toBe('bucket');
    expect(service.getProfile(record.id)?.selectedAnimal).toBe('otter');
    expect(service.setCosmetics('nobody', 'duck', 'none')).toBeNull();
  });

  it('grants the tutorial bonus exactly once', () => {
    const { record } = service.authenticate();

    const first = service.setTutorialDone(record.id);
    expect(first.record.tutorialDone).toBe(true);
    expect(first.record.xp).toBe(CONFIG.XP_TUTORIAL);

    const second = service.setTutorialDone(record.id);
    expect(second.record.xp).toBe(CONFIG.XP_TUTORIAL);
    expect(second.unlocked).toEqual([]);
  });
});

describe('xp and unlocks', () => {
  it('grants exactly the new items when a level boundary is crossed, and only once', () => {
    const { record } = service.authenticate();
    const toLevel2 = xpForLevel(1);

    const below = service.awardXp(record.id, toLevel2 - 1);
    expect(below.levelBefore).toBe(1);
    expect(below.levelAfter).toBe(1);
    expect(below.unlocked).toEqual([]);

    const crossed = service.awardXp(record.id, 1);
    expect(crossed.levelBefore).toBe(1);
    expect(crossed.levelAfter).toBe(2);
    expect(crossed.record.xp).toBe(toLevel2);
    expect(crossed.unlocked).toEqual(['hat:bucket']);

    // Re-crossing the same boundary must not re-award anything.
    expect(service.awardXp(record.id, 0).unlocked).toEqual([]);

    const toLevel3 = service.awardXp(record.id, xpForLevel(2));
    expect(toLevel3.levelAfter).toBe(3);
    expect(toLevel3.unlocked).toEqual(['animal:otter']);

    const unlocks = service.getProfile(record.id)?.unlocks ?? [];
    expect(unlocks).toEqual(expect.arrayContaining(['hat:bucket', 'animal:otter']));
    expect(unlocks).toHaveLength(service.unlockedItems(3).length);
    expect(new Set(unlocks).size).toBe(unlocks.length);
  });

  it('can jump several levels in one award', () => {
    const { record } = service.authenticate();
    const bigJump = service.awardXp(record.id, xpForLevel(1) + xpForLevel(2) + xpForLevel(3));
    expect(bigJump.levelAfter).toBe(4);
    expect(bigJump.unlocked).toEqual(['animal:otter', 'hat:bucket', 'hat:snorkel']);
    expect(levelFromXp(bigJump.record.xp).level).toBe(4);
  });

  it('throws for an unknown player', () => {
    expect(() => service.awardXp('nobody', 10)).toThrow(/unknown player/);
  });
});

describe('ratings', () => {
  it('bumps games, wins and peak', () => {
    const { record } = service.authenticate();

    service.applyRating(record.id, 'duel', 1120, true);
    service.applyRating(record.id, 'duel', 1040, false);
    service.applyRating(record.id, 'duel', 1075, true);

    const duel = service.getRating(record.id, 'duel');
    expect(duel).toEqual({ mode: 'duel', rating: 1075, games: 3, wins: 2, peak: 1120 });

    // Modes are tracked independently.
    expect(service.getRating(record.id, 'ffa').games).toBe(0);
    expect(service.getRating(record.id, 'ffa').rating).toBe(CONFIG.ELO_START);
  });
});

describe('leaderboard', () => {
  it('orders by rating, ranks from one and excludes players with no games', () => {
    const top = service.authenticate().record;
    const mid = service.authenticate().record;
    const low = service.authenticate().record;
    const idle = service.authenticate().record;

    service.applyRating(top.id, 'duel', 1500, true);
    service.applyRating(top.id, 'duel', 1520, true);
    service.applyRating(mid.id, 'duel', 1210, true);
    service.applyRating(mid.id, 'duel', 1180, false);
    service.applyRating(low.id, 'duel', 900, false);
    service.applyRating(idle.id, 'ffa', 1400, true);

    const board = service.getLeaderboard('duel', 10);
    expect(board.map((row) => row.playerId)).toEqual([top.id, mid.id, low.id]);
    expect(board.map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(board[0].rating).toBe(1520);
    expect(board[0].winrate).toBe(1);
    expect(board[1].winrate).toBe(0.5);
    expect(board[2].winrate).toBe(0);
    expect(board[0].tier).toBe('ocean');
    expect(board[2].tier).toBe('puddle');
    expect(board[0].nickname).toBe(top.nickname);

    expect(service.getLeaderboard('duel', 2)).toHaveLength(2);
    expect(service.getLeaderboard('ffa', 10).map((row) => row.playerId)).toEqual([idle.id]);
  });
});

describe('match history', () => {
  it('round-trips a recorded match, newest first', () => {
    const winner = service.authenticate().record;
    const loser = service.authenticate().record;

    const older = service.recordMatch({
      mode: 'duel',
      ranked: true,
      startedAt: 1_000,
      endedAt: 2_000,
      rows: [
        {
          playerId: winner.id,
          placement: 1,
          soaks: 3,
          roundsWon: 3,
          ratingBefore: 1000,
          ratingAfter: 1016,
          xpEarned: 195,
        },
        {
          playerId: loser.id,
          placement: 2,
          soaks: 1,
          roundsWon: 1,
          ratingBefore: 1000,
          ratingAfter: 984,
          xpEarned: 110,
        },
      ],
    });

    const newer = service.recordMatch({
      mode: 'ffa',
      ranked: false,
      startedAt: 3_000,
      endedAt: 4_000,
      rows: [
        {
          playerId: winner.id,
          placement: 2,
          soaks: 2,
          roundsWon: 1,
          ratingBefore: null,
          ratingAfter: null,
          xpEarned: 85,
        },
      ],
    });

    expect(older).not.toBe(newer);

    const history = service.getRecentMatches(winner.id, 10);
    expect(history.map((row) => row.matchId)).toEqual([newer, older]);
    expect(history[0]).toEqual({
      matchId: newer,
      mode: 'ffa',
      ranked: false,
      endedAt: 4_000,
      placement: 2,
      soaks: 2,
      roundsWon: 1,
      ratingBefore: null,
      ratingAfter: null,
      xpEarned: 85,
    });
    expect(history[1]).toEqual({
      matchId: older,
      mode: 'duel',
      ranked: true,
      endedAt: 2_000,
      placement: 1,
      soaks: 3,
      roundsWon: 3,
      ratingBefore: 1000,
      ratingAfter: 1016,
      xpEarned: 195,
    });

    expect(service.getRecentMatches(loser.id, 10).map((row) => row.matchId)).toEqual([older]);
    expect(service.getRecentMatches(winner.id, 1)).toHaveLength(1);
  });

  it('refuses a match row for a player that does not exist', () => {
    expect(() =>
      service.recordMatch({
        mode: 'duel',
        ranked: false,
        startedAt: 0,
        endedAt: 1,
        rows: [
          {
            playerId: 'ghost',
            placement: 1,
            soaks: 0,
            roundsWon: 0,
            ratingBefore: null,
            ratingAfter: null,
            xpEarned: 0,
          },
        ],
      }),
    ).toThrow();
  });
});

describe('migrations', () => {
  it('are idempotent across reopens and keep the data', () => {
    const { record, token } = service.authenticate();
    db.close();

    // afterEach closes whatever handle is current, so hand it the new one.
    const reopened = openDatabase(dir);
    db = reopened;
    const versions = reopened
      .prepare<[], { version: number }>('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => row.version);
    expect(versions).toEqual([1]);

    const again = new PlayerService(reopened).authenticate(token);
    expect(again.isNew).toBe(false);
    expect(again.record.id).toBe(record.id);
  });
});
