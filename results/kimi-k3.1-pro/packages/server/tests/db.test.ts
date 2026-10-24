import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrations.js";
import { SplashQueries } from "../src/db/queries.js";

const databases: Database.Database[] = [];

function makeDb(): SplashQueries {
  const database = new Database(":memory:");
  databases.push(database);
  runMigrations(database);
  return new SplashQueries(database);
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("SQLite accounts and ratings", () => {
  it("stores only token hashes and creates default ratings/unlocks", () => {
    const db = makeDb();
    const { token, profile } = db.findOrCreateGuest();
    expect(profile.unlocks).toContain("animal:frog");
    expect(profile.unlocks).toContain("animal:duck");
    expect(db.getRating(profile.id, "duel").rating).toBe(1000);
    const row = (db as unknown as { database: Database.Database }).database.prepare("SELECT token_hash FROM players WHERE id = ?").get(profile.id) as { token_hash: string };
    expect(row.token_hash).toHaveLength(64);
    expect(row.token_hash).not.toBe(token);
    expect(db.findOrCreateGuest(token).profile.id).toBe(profile.id);
  });

  it("persists duel rating changes and leaderboard wins", () => {
    const db = makeDb();
    const first = db.findOrCreateGuest().profile;
    const second = db.findOrCreateGuest().profile;
    db.recordMatch({
      id: "match-1",
      mode: "duel",
      ranked: true,
      startedAt: 1,
      endedAt: 2,
      players: [
        { accountId: first.id, placement: 1, soaks: 3, roundsWon: 3, ratingBefore: 1000, ratingAfter: 1032, xpEarned: 200 },
        { accountId: second.id, placement: 2, soaks: 0, roundsWon: 0, ratingBefore: 1000, ratingAfter: 968, xpEarned: 100 }
      ]
    });
    expect(db.getRating(first.id, "duel")).toMatchObject({ rating: 1032, games: 1, wins: 1, peak: 1032 });
    expect(db.getRating(second.id, "duel")).toMatchObject({ rating: 968, games: 1, wins: 0, peak: 1000 });
    expect(db.leaderboard("duel")[0]).toMatchObject({ rating: 1032, winrate: 100 });
  });

  it("combines duplicate-account games and deltas without corrupting winrate", () => {
    const db = makeDb();
    const player = db.findOrCreateGuest().profile;
    db.recordMatch({
      id: "match-2",
      mode: "duel",
      ranked: true,
      startedAt: 1,
      endedAt: 2,
      players: [
        { accountId: player.id, placement: 1, soaks: 3, roundsWon: 3, ratingBefore: 1000, ratingAfter: 1032, xpEarned: 200 },
        { accountId: player.id, placement: 2, soaks: 0, roundsWon: 0, ratingBefore: 1000, ratingAfter: 968, xpEarned: 100 }
      ]
    });
    expect(db.getRating(player.id, "duel")).toMatchObject({ rating: 1000, games: 2, wins: 1, peak: 1032 });
    expect(db.leaderboard("duel")[0]).toMatchObject({ rating: 1000, games: 2, winrate: 50 });
    expect(db.profileRecord(player.id)?.recentMatches).toHaveLength(1);
    expect(db.getProfile(player.id)?.xp).toBe(300);
  });
});
