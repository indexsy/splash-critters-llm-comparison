// Numbered schema migrations, embedded as SQL strings so the esbuild bundle has no file-path
// dependency. Append new migrations with the next version number; never edit an applied one.
// Timestamps are integer milliseconds since the Unix epoch.

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE players (
        id              TEXT PRIMARY KEY,
        token_hash      TEXT NOT NULL UNIQUE,
        nickname        TEXT NOT NULL,
        tag             TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        xp              INTEGER NOT NULL DEFAULT 0,
        level           INTEGER NOT NULL DEFAULT 1,
        selected_animal TEXT NOT NULL DEFAULT 'frog',
        selected_hat    TEXT NOT NULL DEFAULT 'none',
        has_nickname    INTEGER NOT NULL DEFAULT 0,
        tutorial_done   INTEGER NOT NULL DEFAULT 0
      );
      -- nickname#tag is unique ignoring case.
      CREATE UNIQUE INDEX players_nickname_tag ON players (nickname COLLATE NOCASE, tag);

      CREATE TABLE ratings (
        player_id TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
        mode      TEXT NOT NULL CHECK (mode IN ('duel', 'ffa')),
        rating    INTEGER NOT NULL,
        games     INTEGER NOT NULL DEFAULT 0,
        wins      INTEGER NOT NULL DEFAULT 0,
        peak      INTEGER NOT NULL,
        PRIMARY KEY (player_id, mode)
      );
      -- Leaderboard: top N by rating within a mode.
      CREATE INDEX ratings_leaderboard ON ratings (mode, rating DESC);

      CREATE TABLE matches (
        id         TEXT PRIMARY KEY,
        mode       TEXT NOT NULL CHECK (mode IN ('duel', 'ffa')),
        ranked     INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at   INTEGER NOT NULL
      );

      CREATE TABLE match_players (
        match_id      TEXT NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
        player_id     TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
        placement     INTEGER NOT NULL,
        soaks         INTEGER NOT NULL,
        rounds_won    INTEGER NOT NULL,
        rating_before INTEGER,
        rating_after  INTEGER,
        xp_earned     INTEGER NOT NULL,
        PRIMARY KEY (match_id, player_id)
      );
      -- Recent matches: a player's match rows, joined to matches and sorted by end time.
      CREATE INDEX match_players_player ON match_players (player_id);

      CREATE TABLE unlocks (
        player_id   TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
        item_id     TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, item_id)
      );
    `,
  },
  {
    version: 2,
    name: 'match player count',
    // Bots are never persisted, so the number of participants (humans + bots) is stored on the
    // match itself for RecentMatch.players.
    sql: `
      ALTER TABLE matches ADD COLUMN player_count INTEGER NOT NULL DEFAULT 0;
    `,
  },
];
