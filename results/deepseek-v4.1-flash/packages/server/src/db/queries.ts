import type { AnimalId, GameMode, HatId, LeaderboardEntry, PlayerProfile, RatingSummary } from "@splash/shared";
import { ANIMALS, HATS, levelFromXp, tierForRating } from "@splash/shared";
import type { SplashDb } from "./index.js";

export interface PlayerRow {
  id: string;
  token_hash: string;
  nickname: string;
  tag: string;
  created_at: number;
  xp: number;
  level: number;
  selected_animal: AnimalId;
  selected_hat: HatId;
  name_set: number;
  tutorial_done: number;
}

export interface RatingRow {
  player_id: string;
  mode: GameMode;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

interface LeaderboardRow {
  id: string;
  nickname: string;
  tag: string;
  rating: number;
  games: number;
  wins: number;
}

export interface CompletedMatchPlayer {
  playerId: string;
  placement: number;
  soaks: number;
  roundsWon: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
  castles: number;
  biggestChain: number;
  survivedTicks: number;
}

export interface CompletedMatch {
  mode: GameMode;
  ranked: boolean;
  startedAt: number;
  endedAt: number;
  roomCode: string;
  players: CompletedMatchPlayer[];
}

function rowToPlayer(row: PlayerRow | undefined): PlayerRow | null {
  return row ?? null;
}

export function findPlayerById(db: SplashDb, id: string): PlayerRow | null {
  return rowToPlayer(
    db.prepare("SELECT * FROM players WHERE id = ?").get(id) as PlayerRow | undefined,
  );
}

export function findPlayerByToken(db: SplashDb, tokenHash: string): PlayerRow | null {
  return rowToPlayer(
    db
      .prepare("SELECT * FROM players WHERE token_hash = ?")
      .get(tokenHash) as PlayerRow | undefined,
  );
}

export function displayName(row: Pick<PlayerRow, "nickname" | "tag">): string {
  return `${row.nickname}#${row.tag}`;
}

function unlockedItemsForLevel(level: number): string[] {
  return [
    ...ANIMALS.filter((animal) => animal.level <= level).map((animal) => animal.id),
    ...HATS.filter((hat) => hat.level <= level).map((hat) => hat.id),
  ];
}

export function createPlayer(
  db: SplashDb,
  tokenHash: string,
  nickname: string,
  tag: string,
): PlayerRow {
  const id = crypto.randomUUID();
  const now = Date.now();
  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO players
        (id, token_hash, nickname, tag, created_at, xp, level, selected_animal, selected_hat, name_set, tutorial_done)
       VALUES (?, ?, ?, ?, ?, 0, 1, 'frog', 'none', 0, 0)`,
    ).run(id, tokenHash, nickname, tag, now);
    for (const mode of ["duel", "ffa"] as const) {
      db.prepare(
        "INSERT INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, 1000, 0, 0, 1000)",
      ).run(id, mode);
    }
    const insertUnlock = db.prepare(
      "INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)",
    );
    for (const item of unlockedItemsForLevel(1)) insertUnlock.run(id, item, now);
  });
  transaction();
  const row = findPlayerById(db, id);
  if (!row) throw new Error("Failed to create player");
  return row;
}

export function playerNameExists(
  db: SplashDb,
  nickname: string,
  tag: string,
): boolean {
  const row = db
    .prepare("SELECT id FROM players WHERE lower(nickname) = lower(?) AND tag = ?")
    .get(nickname, tag);
  return Boolean(row);
}

export function updateNickname(
  db: SplashDb,
  playerId: string,
  nickname: string,
  tag: string,
): PlayerRow {
  db.prepare("UPDATE players SET nickname = ?, tag = ?, name_set = 1 WHERE id = ?").run(
    nickname,
    tag,
    playerId,
  );
  const row = findPlayerById(db, playerId);
  if (!row) throw new Error("Player not found");
  return row;
}

export function getRatings(
  db: SplashDb,
  playerId: string,
): Partial<Record<GameMode, RatingSummary>> {
  const rows = db
    .prepare("SELECT * FROM ratings WHERE player_id = ?")
    .all(playerId) as RatingRow[];
  const result: Partial<Record<GameMode, RatingSummary>> = {};
  for (const row of rows) {
    result[row.mode] = {
      rating: row.rating,
      games: row.games,
      wins: row.wins,
      peak: row.peak,
    };
  }
  return result;
}

export function getSingleRating(
  db: SplashDb,
  playerId: string,
  mode: GameMode,
): RatingSummary {
  const row = db
    .prepare("SELECT * FROM ratings WHERE player_id = ? AND mode = ?")
    .get(playerId, mode) as RatingRow | undefined;
  if (row) {
    return { rating: row.rating, games: row.games, wins: row.wins, peak: row.peak };
  }
  db.prepare(
    "INSERT OR IGNORE INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, 1000, 0, 0, 1000)",
  ).run(playerId, mode);
  return { rating: 1000, games: 0, wins: 0, peak: 1000 };
}

export function getUnlocks(db: SplashDb, playerId: string): string[] {
  const rows = db
    .prepare("SELECT item_id FROM unlocks WHERE player_id = ? ORDER BY unlocked_at, item_id")
    .all(playerId) as Array<{ item_id: string }>;
  return rows.map((row) => row.item_id);
}

export function getProfile(db: SplashDb, playerId: string): PlayerProfile {
  const row = findPlayerById(db, playerId);
  if (!row) throw new Error("Player not found");
  return {
    id: row.id,
    nickname: row.nickname,
    tag: row.tag,
    displayName: displayName(row),
    xp: row.xp,
    level: row.level,
    selectedAnimal: row.selected_animal,
    selectedHat: row.selected_hat,
    needsNickname: row.name_set === 0,
    tutorialDone: row.tutorial_done === 1,
    unlocks: getUnlocks(db, playerId),
    ratings: getRatings(db, playerId),
  };
}

export function setCosmetics(
  db: SplashDb,
  playerId: string,
  animal: AnimalId,
  hat: HatId,
): PlayerRow {
  const unlocked = new Set(getUnlocks(db, playerId));
  const animalDef = ANIMALS.find((entry) => entry.id === animal);
  const hatDef = HATS.find((entry) => entry.id === hat);
  if (!animalDef || !unlocked.has(animal)) throw new Error("Animal is locked");
  if (!hatDef || !unlocked.has(hat)) throw new Error("Hat is locked");
  db.prepare("UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?").run(
    animal,
    hat,
    playerId,
  );
  const row = findPlayerById(db, playerId);
  if (!row) throw new Error("Player not found");
  return row;
}

export function completeTutorial(
  db: SplashDb,
  playerId: string,
  bonusXp: number,
): { profile: PlayerProfile; awarded: number } {
  const player = findPlayerById(db, playerId);
  if (!player) throw new Error("Player not found");
  if (player.tutorial_done === 1) {
    return { profile: getProfile(db, playerId), awarded: 0 };
  }
  const transaction = db.transaction(() => {
    const totalXp = player.xp + bonusXp;
    const level = levelFromXp(totalXp);
    db.prepare(
      "UPDATE players SET xp = ?, level = ?, tutorial_done = 1 WHERE id = ?",
    ).run(totalXp, level, playerId);
    grantUnlocks(db, playerId, level);
  });
  transaction();
  return { profile: getProfile(db, playerId), awarded: bonusXp };
}

function grantUnlocks(db: SplashDb, playerId: string, level: number): string[] {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)",
  );
  const existing = new Set(getUnlocks(db, playerId));
  const unlockedNow: string[] = [];
  for (const item of unlockedItemsForLevel(level)) {
    if (existing.has(item)) continue;
    insert.run(playerId, item, Date.now());
    unlockedNow.push(item);
  }
  return unlockedNow;
}

export function leaderboard(
  db: SplashDb,
  mode: GameMode,
  limit = 100,
): LeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.nickname, p.tag, r.rating, r.games, r.wins
       FROM ratings r
       JOIN players p ON p.id = r.player_id
       WHERE r.mode = ? AND r.games > 0
       ORDER BY r.rating DESC, r.wins DESC, r.games ASC, p.created_at ASC
       LIMIT ?`,
    )
    .all(mode, limit) as LeaderboardRow[];
  return rows.map((row, index) => ({
    rank: index + 1,
    playerId: row.id,
    displayName: displayName(row),
    rating: row.rating,
    tier: tierForRating(row.rating),
    games: row.games,
    winrate: row.games > 0 ? row.wins / row.games : 0,
  }));
}

export function recentMatches(db: SplashDb, playerId: string) {
  return db
    .prepare(
      `SELECT m.id AS matchId, m.mode, m.ranked, m.ended_at AS endedAt,
              mp.placement, mp.soaks, mp.rounds_won AS roundsWon,
              mp.rating_before AS ratingBefore, mp.rating_after AS ratingAfter
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
       WHERE mp.player_id = ?
       ORDER BY m.ended_at DESC
       LIMIT 10`,
    )
    .all(playerId) as Array<{
    matchId: number;
    mode: GameMode;
    ranked: number;
    endedAt: number;
    placement: number;
    soaks: number;
    roundsWon: number;
    ratingBefore: number | null;
    ratingAfter: number | null;
  }>;
}

export function recordCompletedMatch(
  db: SplashDb,
  match: CompletedMatch,
): number {
  const transaction = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO matches (mode, ranked, started_at, ended_at, room_code)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(match.mode, match.ranked ? 1 : 0, match.startedAt, match.endedAt, match.roomCode);
    const matchId = Number(result.lastInsertRowid);
    const insertPlayer = db.prepare(
      `INSERT INTO match_players
        (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after,
         xp_earned, castles, biggest_chain, survived_ticks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updatePlayer = db.prepare("UPDATE players SET xp = ?, level = ? WHERE id = ?");
    const upsertRating = db.prepare(
      `INSERT INTO ratings (player_id, mode, rating, games, wins, peak)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(player_id, mode) DO UPDATE SET
         rating = excluded.rating,
         games = ratings.games + 1,
         wins = ratings.wins + excluded.wins,
         peak = MAX(ratings.peak, excluded.peak)`,
    );
    for (const entry of match.players) {
      const player = findPlayerById(db, entry.playerId);
      if (!player) continue;
      const totalXp = player.xp + entry.xpEarned;
      const level = levelFromXp(totalXp);
      updatePlayer.run(totalXp, level, entry.playerId);
      grantUnlocks(db, entry.playerId, level);
      if (match.ranked && entry.ratingAfter !== null) {
        upsertRating.run(
          entry.playerId,
          match.mode,
          entry.ratingAfter,
          entry.placement === 1 ? 1 : 0,
          Math.max(entry.ratingAfter, entry.ratingBefore ?? 0),
        );
      }
      insertPlayer.run(
        matchId,
        entry.playerId,
        entry.placement,
        entry.soaks,
        entry.roundsWon,
        entry.ratingBefore,
        entry.ratingAfter,
        entry.xpEarned,
        entry.castles,
        entry.biggestChain,
        entry.survivedTicks,
      );
    }
    return matchId;
  });
  return transaction();
}

export function profileForId(db: SplashDb, playerId: string): PlayerProfile | null {
  try {
    return getProfile(db, playerId);
  } catch {
    return null;
  }
}
